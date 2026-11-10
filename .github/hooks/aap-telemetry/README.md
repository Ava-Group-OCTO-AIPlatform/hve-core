# Intelligence Hub telemetry hooks (Avanade fork)

These hooks send Microsoft HVE Core usage to the Intelligence Hub collector
(Governança › SDLC › Developers › Microsoft HVE Core), under the contract
`hve.telemetry.contract = 1`. They are the only change of this fork against
`microsoft/hve-core`, kept in their own files so upstream syncs merge cleanly.

| File | Host |
|---|---|
| `.github/hooks/aap-telemetry.json` | GitHub Copilot CLI and VS Code agent hooks (repository install) |
| `hooks/hooks.json` | Claude Code plugin install |
| `.github/hooks/aap-telemetry/hook.mjs` | the hook itself (Node 18+, no dependencies) |
| `.github/hooks/aap-telemetry/install.mjs` | the one-command installer (`npx`) |

## Setup

1. Run the IDE setup script from the project's link page in the Intelligence Hub. It sets
   `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` (the `dtl_` token) that the
   hook reads. Without them the hook does nothing.
2. Install the hooks with one command, from the repository root (Node 18+):

   ```bash
   npx -y github:Ava-Group-OCTO-AIPlatform/hve-core            # this repository + Claude Code (user)
   npx -y github:Ava-Group-OCTO-AIPlatform/hve-core --repo     # this repository only (commit .github/hooks)
   npx -y github:Ava-Group-OCTO-AIPlatform/hve-core --user     # Claude Code, every repository
   npx -y github:Ava-Group-OCTO-AIPlatform/hve-core --uninstall
   ```

   Or install HVE Core from this fork (plugin marketplace pointing at the fork), or copy
   `.github/hooks/aap-telemetry.json` and `.github/hooks/aap-telemetry/` into the repository.
   The VS Code Marketplace extension cannot carry hooks.
3. Restart the IDE so the hooks and the environment are picked up.

Opt out at any time with `AAP_HVE_TELEMETRY=off`. Failed sends wait in `~/.aap-hve/outbox.jsonl`
(at most 1000 events) and go with the next hook.

## Claude Code (desktop or on the web)

This fork is also a Claude Code plugin marketplace: the RPI skills (`hve-core:rpi`,
`hve-core:rpi-research`, ...) plus the shared, HVE Core, coding standards, security and
project planning skills, with these hooks already wired.

```bash
claude plugin marketplace add Ava-Group-OCTO-AIPlatform/hve-core
claude plugin install hve-core@hve-core-avanade
```

For a whole team, commit it in the repository's `.claude/settings.json` instead:

```json
{
  "extraKnownMarketplaces": {
    "hve-core-avanade": { "source": { "source": "github", "repo": "Ava-Group-OCTO-AIPlatform/hve-core" } }
  },
  "enabledPlugins": { "hve-core@hve-core-avanade": true }
}
```

Use the plugin or `npx ... --user`, not both, or each event is sent twice.

On Claude Code on the web, run the Intelligence Hub cloud setup script in the environment
first. Claude Code hides the `OTEL_*` variables from hooks, so in a cloud session
(`CLAUDE_CODE_REMOTE=true`) the hook sends to the setup script's relay on
`127.0.0.1:4318`, without a token: the session proxy adds it.

## What is sent

Only hashes, enums and counts: session and task ids are SHA-256 of the repository and the id,
cut to 32 hex; artifact kinds come from the `.copilot-tracking/<folder>`; agent and skill names
only when they are HVE Core catalog names. No prompt, path, file name, slug or text.

| Event | When |
|---|---|
| `hve.session.start` / `hve.session.end` | the session starts / ends (duration, end reason) |
| `hve.artifact.write` | a file is written under `.copilot-tracking/` (kind only) |
| `hve.rpi.transition` | an RPI state file changes phase or status (mode, blockers, decisions, follow-ups, document counts, plan critique and review run/skipped/pending) |
| `hve.agent.invoke` | an HVE agent or skill is called |

The full contract is in the Intelligence Hub repository, `src/features/dev-telemetry/hve/contract.ts`.
