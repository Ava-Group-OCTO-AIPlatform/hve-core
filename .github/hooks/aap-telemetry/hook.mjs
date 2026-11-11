#!/usr/bin/env node
// Copyright (c) 2026 Microsoft Corporation. All rights reserved.
// SPDX-License-Identifier: MIT
// HVE Core → Intelligence Hub telemetry hook (hve.telemetry.contract = 1).
//
//   node hook.mjs <sessionStart|postToolUse|sessionEnd>   (event JSON on stdin)
//
// Runs as a GitHub Copilot hook (Copilot CLI and VS Code agent hooks,
// .github/hooks/aap-telemetry.json) or a Claude Code hook (hooks/hooks.json).
// It never blocks the agent: no output, always exit 0, 3 s network timeout.
//
// Sends OTLP/HTTP JSON logs to {OTEL_EXPORTER_OTLP_ENDPOINT}/v1/logs with the
// Authorization header of OTEL_EXPORTER_OTLP_HEADERS, which the Intelligence
// Hub IDE setup script already sets for Copilot and Claude Code (the dtl_
// token). Without them it does nothing. Opt out with AAP_HVE_TELEMETRY=off.
//
// Privacy: no prompt, path, file name, slug or text leaves the machine. Tasks
// and sessions are SHA-256 hashes (with the repository) cut to 32 hex; agents
// and skills only when they match the HVE catalog; the rest are enums/counts.

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const HOOK_VERSION = '0.3.0';
const CLOUD_RELAY = 'http://127.0.0.1:4318';
const CONTRACT = 1;
const TIMEOUT_MS = 3000;
const OUTBOX_MAX = 1000;
const HOME = process.env.AAP_HVE_HOME || path.join(homedir(), '.aap-hve');

const PHASES = ['Research', 'Plan', 'Implement', 'Review', 'Follow-up'];
const FOLDER_KINDS = {
  research: 'research',
  plans: 'plan',
  changes: 'changes',
  reviews: 'review',
  'rpi-sessions': 'rpi-state',
  'adr-plans': 'adr',
  'prd-sessions': 'prd',
  'brd-sessions': 'brd',
  'security-plans': 'security-plan',
  security: 'security-plan',
  'rai-plans': 'rai-plan',
  'rai-reviews': 'rai-plan',
  'sssc-plans': 'sssc-plan',
  accessibility: 'accessibility',
  dt: 'design-thinking',
  'ux-artifacts': 'design-thinking',
  workitems: 'workitems',
  'github-issues': 'workitems',
  'jira-issues': 'workitems',
  pr: 'pr',
};
// Agents and skills the receiver accepts (it checks again); anything else is never sent.
const CATALOG = new Set([
  'rpi', 'rpi-agent', 'rpi-research', 'rpi-plan', 'rpi-plan-critique', 'rpi-implement', 'rpi-review', 'rpi-challenger',
  'rpi-walkthrough', 'rpi-researcher', 'rpi-plan-critic', 'rpi-reviewer', 'prd-builder', 'brd-builder', 'adr-creation',
  'functional-planner', 'security-planner', 'rai-planner', 'sssc-planner', 'privacy-planner', 'accessibility-planner',
  'hve-builder', 'hve-builder-review', 'hve-core-installer', 'code-review', 'security-reviewer', 'privacy-reviewer',
  'rai-reviewer', 'accessibility-reviewer', 'git-commit', 'git-merge', 'pull-request', 'documentation', 'backlog-manager',
]);

// ---------------------------------------------------------------------------

function quietly(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function sha(...parts) {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);
}

function readJson(file, fallback) {
  return quietly(() => JSON.parse(readFileSync(file, 'utf8')), fallback);
}

function writeJson(file, value) {
  quietly(() => {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value));
    renameSync(tmp, file);
  });
}

async function readStdin() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return quietly(() => JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'), {});
}

/** `export KEY='value'` lines of the Copilot env file the setup script writes on macOS and Linux. */
function shellEnv(file) {
  const out = {};
  const text = quietly(() => readFileSync(file, 'utf8'), '') ?? '';
  for (const line of text.split('\n')) {
    const m = /^\s*export\s+([A-Z_][A-Z0-9_]*)=(?:'([^']*)'|"([^"]*)"|(\S*))\s*$/.exec(line);
    if (m) out[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

/**
 * Endpoint and headers, from where the Intelligence Hub setup script puts them:
 * the environment (Windows user variables, a shell that sourced the profile),
 * ~/.claude/settings.json (Claude Code) and ~/.claude/aap-copilot-env.sh
 * (Copilot on macOS/Linux, which a VS Code opened from the Dock never sources).
 */
/**
 * Claude Code on the web hides the OTEL_* variables from hooks, so a cloud
 * session falls back to the relay the Intelligence Hub cloud setup script
 * starts. Without that relay the send fails and the event waits in the outbox.
 */
function cloudRelay() {
  return process.env.CLAUDE_CODE_REMOTE === 'true' ? CLOUD_RELAY : '';
}

function isLoopback(endpoint) {
  const host = quietly(() => new URL(endpoint).hostname, '');
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

function exporterConfig() {
  const claudeDir = path.join(homedir(), '.claude');
  const settingsEnv = readJson(path.join(claudeDir, 'settings.json'), {})?.env ?? {};
  const copilotEnv = shellEnv(path.join(claudeDir, 'aap-copilot-env.sh'));
  const pick = (key) => process.env[key] || settingsEnv[key] || copilotEnv[key] || '';
  const endpoint = (pick('AAP_HVE_ENDPOINT') || pick('OTEL_EXPORTER_OTLP_ENDPOINT') || pick('COPILOT_OTEL_ENDPOINT') || cloudRelay()).replace(/\/+$/, '');
  const headers = {};
  for (const pair of pick('OTEL_EXPORTER_OTLP_HEADERS').split(',')) {
    const at = pair.indexOf('=');
    if (at > 0) headers[decodeURIComponent(pair.slice(0, at).trim())] = decodeURIComponent(pair.slice(at + 1).trim());
  }
  const auth = Object.entries(headers).find(([k]) => k.toLowerCase() === 'authorization')?.[1] ?? '';
  if (!endpoint) return null;
  if (/^Bearer\s+dtl_/i.test(auth)) return { url: `${endpoint}/v1/logs`, auth };
  // Claude Code on the web: the Intelligence Hub cloud setup script starts a
  // relay on 127.0.0.1:4318 and the session proxy adds the token, so the
  // container holds none. Only a loopback endpoint goes without one.
  return isLoopback(endpoint) ? { url: `${endpoint}/v1/logs`, auth: '' } : null;
}

function repositoryOf(cwd) {
  const url = quietly(() => execFileSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(), '');
  const m = /[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(url ?? '');
  return m ? `${m[1]}/${m[2]}` : null;
}

function hostOf(input) {
  if (process.env.AAP_HVE_HOST) return process.env.AAP_HVE_HOST;
  if ('hook_event_name' in input || 'tool_name' in input || 'session_id' in input) {
    return process.env.VSCODE_PID || process.env.TERM_PROGRAM === 'vscode' ? 'vscode' : 'claude-code';
  }
  return 'copilot-cli';
}

function hveVersion() {
  const here = path.dirname(new URL(import.meta.url).pathname);
  for (const dir of [here, path.join(here, '..'), path.join(here, '..', '..'), path.join(here, '..', '..', '..')]) {
    const v = readJson(path.join(dir, 'plugin.json'), null)?.version;
    if (typeof v === 'string') return v;
  }
  return null;
}

// ---------------------------------------------------------------------------
// OTLP

function attr(key, value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  if (typeof value === 'number') return { key, value: { intValue: Math.max(0, Math.trunc(value)) } };
  return { key, value: { stringValue: String(value) } };
}

function record(eventName, sessionId, attrs) {
  return {
    timeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
    eventName,
    attributes: Object.entries({ 'hve.event.id': randomUUID(), 'hve.session.id': sessionId, ...attrs })
      .map(([k, v]) => attr(k, v))
      .filter(Boolean),
  };
}

function requestOf(records, resource) {
  return {
    resourceLogs: [
      {
        resource: { attributes: Object.entries(resource).map(([k, v]) => attr(k, v)).filter(Boolean) },
        scopeLogs: [{ scope: { name: 'avanade.hve', version: '1' }, logRecords: records }],
      },
    ],
  };
}

async function send(config, body) {
  const res = await fetch(config.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(config.auth ? { authorization: config.auth } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // 4xx other than 429 will not get better on a retry: drop.
  return res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429);
}

const EVENT_NAME = /^hve\.[a-z_.]{1,60}$/;
const ATTR_KEY = /^[a-z0-9_.]{1,80}$/;
const NANOS = /^\d{1,20}$/;

/**
 * Rebuilds one queued outbox line as a fresh log record, keeping only the shape
 * this hook writes. The outbox is a local file anyone on the machine can edit,
 * so a line that is not our own record is dropped rather than sent.
 */
function fromOutbox(line) {
  const raw = quietly(() => JSON.parse(line), null);
  if (!raw || typeof raw !== 'object') return null;
  const eventName = typeof raw.eventName === 'string' && EVENT_NAME.test(raw.eventName) ? raw.eventName : null;
  const timeUnixNano = typeof raw.timeUnixNano === 'string' && NANOS.test(raw.timeUnixNano) ? raw.timeUnixNano : null;
  if (!eventName || !timeUnixNano || !Array.isArray(raw.attributes)) return null;
  const attributes = [];
  for (const a of raw.attributes.slice(0, 40)) {
    const key = typeof a?.key === 'string' && ATTR_KEY.test(a.key) ? a.key : null;
    const v = a?.value ?? {};
    if (!key) continue;
    if (typeof v.boolValue === 'boolean') attributes.push({ key, value: { boolValue: v.boolValue === true } });
    else if (Number.isFinite(v.intValue)) attributes.push({ key, value: { intValue: Math.max(0, Math.trunc(Number(v.intValue))) } });
    else if (typeof v.stringValue === 'string') attributes.push({ key, value: { stringValue: v.stringValue.replace(/[\r\n]/g, ' ').slice(0, 512) } });
  }
  return { timeUnixNano, eventName, attributes };
}

/** Sends the new records plus whatever is queued; on failure everything goes back to the outbox. */
async function flush(config, resource, records) {
  const outbox = path.join(HOME, 'outbox.jsonl');
  const queued = quietly(() => readFileSync(outbox, 'utf8').split('\n').filter(Boolean).map(fromOutbox).filter(Boolean), []);
  const all = [...queued, ...records].slice(-OUTBOX_MAX);
  if (all.length === 0) return;
  const ok = await send(config, requestOf(all, resource)).catch(() => false);
  quietly(() => {
    mkdirSync(HOME, { recursive: true });
    writeFileSync(outbox, ok ? '' : all.map((r) => JSON.stringify(r)).join('\n') + '\n');
  });
}

// ---------------------------------------------------------------------------
// Sessions (Copilot CLI sends no session id: one is kept per working folder)

function sessionFile(cwd) {
  return path.join(HOME, 'sessions', `${sha(cwd)}.json`);
}

function sessionOf(input, cwd, repository, start) {
  if (typeof input.session_id === 'string' && input.session_id) return { id: sha(repository ?? cwd, input.session_id), startedAt: null };
  const file = sessionFile(cwd);
  const known = readJson(file, null);
  if (!start && known?.id) return known;
  const fresh = { id: sha(repository ?? cwd, randomUUID()), startedAt: Date.now() };
  writeJson(file, fresh);
  return fresh;
}

// ---------------------------------------------------------------------------
// Artifacts and RPI state

function toolArgs(input) {
  const raw = input.toolArgs ?? input.tool_input ?? {};
  return typeof raw === 'string' ? quietly(() => JSON.parse(raw), {}) : raw;
}

function writtenPath(args) {
  for (const key of ['path', 'filePath', 'file_path', 'target_file', 'filename']) {
    if (typeof args?.[key] === 'string') return args[key];
  }
  return null;
}

function artifactKindOf(file) {
  const parts = file.replaceAll('\\', '/').split('/');
  const at = parts.lastIndexOf('.copilot-tracking');
  if (at < 0 || at + 1 >= parts.length) return null;
  if (/critique/i.test(parts[parts.length - 1] ?? '')) return 'critique';
  return FOLDER_KINDS[parts[at + 1]] ?? 'other';
}

function gateOf(state, docKind, word) {
  if ((state.documents?.[docKind] ?? []).length > 0) return 'run';
  const skipped = (state.confirmed_decisions ?? []).some(
    (d) => new RegExp(word, 'i').test(d?.decision ?? '') && /skip/i.test(`${d?.status ?? ''} ${d?.evidence ?? ''}`),
  );
  return skipped ? 'skipped' : 'pending';
}

function transitionOf(state, repository, cwd) {
  if (!state || typeof state !== 'object' || !state.task_id) return null;
  const taskId = sha(repository ?? cwd, String(state.task_id));
  const phase = PHASES.includes(state.active_phase) ? state.active_phase : null;
  const status = ['active', 'blocked', 'completed'].includes(state.status) ? state.status : null;
  const tasksFile = path.join(HOME, 'tasks.json');
  const tasks = readJson(tasksFile, {});
  const before = tasks[taskId] ?? null;
  if (before && before.phase === phase && before.status === status) return null;
  tasks[taskId] = { phase, status, at: Date.now() };
  // Keep the newest 2000 tasks.
  const kept = Object.fromEntries(Object.entries(tasks).sort((a, b) => b[1].at - a[1].at).slice(0, 2000));
  writeJson(tasksFile, kept);
  const docs = state.documents ?? {};
  const count = (v) => (Array.isArray(v) ? v.length : null);
  return {
    'hve.task.id': taskId,
    'hve.rpi.phase.from': before?.phase ?? null,
    'hve.rpi.phase.to': phase,
    'hve.rpi.mode': ['manual', 'automatic'].includes(state.mode) ? state.mode : null,
    'hve.rpi.status': status,
    'hve.rpi.child': state.parent_task ? true : false,
    'hve.rpi.blockers': count(state.blockers),
    'hve.rpi.decisions': count(state.confirmed_decisions),
    'hve.rpi.follow_ups': count(state.prioritized_follow_ups),
    'hve.rpi.documents.research': count(docs.research),
    'hve.rpi.documents.plan': count(docs.plan),
    'hve.rpi.documents.critique': count(docs.critique),
    'hve.rpi.documents.changes': count(docs.changes),
    'hve.rpi.documents.review': count(docs.review),
    'hve.rpi.critique': gateOf(state, 'critique', 'critique'),
    'hve.rpi.review': gateOf(state, 'review', '\\breview'),
  };
}

function agentOf(input, args) {
  const tool = String(input.toolName ?? input.tool_name ?? '').toLowerCase();
  let name = null;
  let kind = null;
  if (tool === 'skill') [name, kind] = [args.skill ?? args.name, 'hve.skill.name'];
  else if (tool === 'task' || tool === 'agent' || tool === 'runsubagent') [name, kind] = [args.subagent_type ?? args.agent_type ?? args.agentName ?? args.agent, 'hve.agent.name'];
  if (typeof name !== 'string') return null;
  const item = name.trim().toLowerCase().replace(/^\/+/, '').replace(/^.*:/, '').replaceAll(/[.:_\s]+/g, '-');
  return CATALOG.has(item) || /^(rpi|hve)-[a-z0-9-]{1,60}$/.test(item) ? { [kind]: item } : null;
}

// ---------------------------------------------------------------------------

async function main() {
  if ((process.env.AAP_HVE_TELEMETRY ?? '').toLowerCase() === 'off') return;
  const event = String(process.argv[2] ?? '').toLowerCase();
  const input = await readStdin();
  const config = exporterConfig();
  if (!config) return;

  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  const repository = repositoryOf(cwd);
  const resource = {
    'service.name': 'hve-core-telemetry',
    'service.version': HOOK_VERSION,
    'hve.telemetry.contract': CONTRACT,
    'hve.version': hveVersion(),
    'hve.host': hostOf(input),
    'vcs.repository.name': repository,
  };
  const records = [];

  if (event === 'sessionstart') {
    const session = sessionOf(input, cwd, repository, true);
    records.push(record('hve.session.start', session.id, {}));
  } else if (event === 'sessionend' || event === 'stop') {
    const session = sessionOf(input, cwd, repository, false);
    const duration = session.startedAt ? Math.round((Date.now() - session.startedAt) / 1000) : null;
    const reason = ['complete', 'error', 'abort', 'timeout', 'user_exit'].includes(input.reason) ? input.reason : 'other';
    records.push(record('hve.session.end', session.id, { 'hve.session.duration_s': duration, 'hve.session.end_reason': reason }));
  } else if (event === 'posttooluse') {
    const session = sessionOf(input, cwd, repository, false);
    const args = toolArgs(input);
    const agent = agentOf(input, args);
    if (agent) records.push(record('hve.agent.invoke', session.id, agent));
    const file = writtenPath(args);
    const kind = file ? artifactKindOf(file) : null;
    if (kind) {
      let taskAttrs = null;
      if (kind === 'rpi-state') {
        const state = readJson(path.resolve(cwd, file), null);
        taskAttrs = transitionOf(state, repository, cwd);
        if (taskAttrs) records.push(record('hve.rpi.transition', session.id, taskAttrs));
      }
      records.push(record('hve.artifact.write', session.id, { 'hve.artifact.kind': kind, 'hve.task.id': taskAttrs?.['hve.task.id'] ?? null }));
    }
  }

  if (records.length > 0 || existsSync(path.join(HOME, 'outbox.jsonl'))) await flush(config, resource, records);
}

main()
  .catch((err) => quietly(() => appendFileSync(path.join(HOME, 'errors.log'), `${new Date().toISOString()} ${String(err?.message ?? err)}\n`)))
  .finally(() => process.exit(0));
