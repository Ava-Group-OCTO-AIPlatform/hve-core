// Copyright (c) 2026 Microsoft Corporation. All rights reserved.
// SPDX-License-Identifier: MIT
// The hook resends its offline outbox to the configured endpoint. CodeQL
// cannot follow the validation in fromOutbox, so hook.mjs is excluded from
// source analysis; these tests pin that only the hook's own record shape
// leaves the machine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hook.mjs');

const VALID = {
  timeUnixNano: '1762860000000000000',
  eventName: 'hve.session.start',
  attributes: [{ key: 'hve.session.id', value: { stringValue: 'abc' } }],
};

async function receiver(status) {
  const bodies = [];
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      bodies.push(JSON.parse(data));
      res.writeHead(status).end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { bodies, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

function runHook(home, endpoint) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, AAP_HVE_HOME: path.join(home, '.aap-hve'), AAP_HVE_ENDPOINT: endpoint };
  delete env.AAP_HVE_TELEMETRY;
  delete env.OTEL_EXPORTER_OTLP_HEADERS;
  const child = spawn(process.execPath, [HOOK, 'flush-only'], { cwd: home, env, stdio: ['pipe', 'ignore', 'ignore'] });
  child.stdin.end('{}');
  return new Promise((resolve) => child.on('exit', resolve));
}

function withOutbox(lines) {
  const home = mkdtempSync(path.join(tmpdir(), 'aap-hve-'));
  mkdirSync(path.join(home, '.aap-hve'), { recursive: true });
  writeFileSync(path.join(home, '.aap-hve', 'outbox.jsonl'), `${lines.join('\n')}\n`);
  return home;
}

const sentRecords = (body) => body.resourceLogs[0].scopeLogs[0].logRecords;

test('sends only well-formed hve records from the outbox and empties it', async (t) => {
  const server = await receiver(200);
  const home = withOutbox([
    JSON.stringify(VALID),
    JSON.stringify({ ...VALID, eventName: 'other.event' }),
    JSON.stringify({ ...VALID, timeUnixNano: 'not-a-time' }),
    'not json',
    JSON.stringify({ ...VALID, body: { stringValue: 'secret' }, severityText: 'x' }),
  ]);
  t.after(() => { server.close(); rmSync(home, { recursive: true, force: true }); });

  await runHook(home, server.url);

  assert.equal(server.bodies.length, 1);
  const records = sentRecords(server.bodies[0]);
  assert.equal(records.length, 2);
  for (const r of records) assert.deepEqual(Object.keys(r).sort(), ['attributes', 'eventName', 'timeUnixNano']);
  assert.equal(readFileSync(path.join(home, '.aap-hve', 'outbox.jsonl'), 'utf8'), '');
});

test('rebuilds attributes: drops bad keys and unknown value types, caps and flattens strings', async (t) => {
  const server = await receiver(200);
  const attributes = [
    { key: 'hve.ok', value: { stringValue: `a\nb${'x'.repeat(600)}` } },
    { key: 'Bad Key', value: { stringValue: 'dropped' } },
    { key: 'hve.count', value: { intValue: -5.7 } },
    { key: 'hve.flag', value: { boolValue: true } },
    { key: 'hve.blob', value: { bytesValue: 'AAAA' } },
    ...Array.from({ length: 50 }, (_, i) => ({ key: `hve.n${i}`, value: { intValue: i } })),
  ];
  const home = withOutbox([JSON.stringify({ ...VALID, attributes })]);
  t.after(() => { server.close(); rmSync(home, { recursive: true, force: true }); });

  await runHook(home, server.url);

  const [record] = sentRecords(server.bodies[0]);
  const byKey = Object.fromEntries(record.attributes.map((a) => [a.key, a.value]));
  assert.equal(byKey['hve.ok'].stringValue.length, 512);
  assert.ok(!byKey['hve.ok'].stringValue.includes('\n'));
  assert.equal(byKey['Bad Key'], undefined);
  assert.deepEqual(byKey['hve.count'], { intValue: 0 });
  assert.deepEqual(byKey['hve.flag'], { boolValue: true });
  assert.equal(byKey['hve.blob'], undefined);
  assert.ok(record.attributes.length <= 40);
});

test('keeps only sanitized records in the outbox when the send fails', async (t) => {
  const server = await receiver(503);
  const home = withOutbox([JSON.stringify(VALID), JSON.stringify({ ...VALID, eventName: 'other.event' }), 'not json']);
  t.after(() => { server.close(); rmSync(home, { recursive: true, force: true }); });

  await runHook(home, server.url);

  const kept = readFileSync(path.join(home, '.aap-hve', 'outbox.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(kept, [VALID]);
});
