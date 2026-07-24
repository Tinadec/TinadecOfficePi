# TinadecPi Project Guide

## Architecture

TinadecPi is a Windows-first agent desktop workbench with three layers:

- `apps/desktop/`: Electron/Vue UI on port `5173`. It calls Gateway only.
- `gateway/`: Elysia BFF on port `48730`. It preserves the public REST/SSE
  contract and owns no durable agent state.
- `core/`: Elysia service on port `48731`. It embeds
  `@earendil-works/pi-coding-agent` in-process and owns Tinadec metadata.

`TinadecTools/` remains for the Gateway Code-tool bridge. It is independent
from the removed C# Core and model-routing shell.

## Pi Runtime Rules

- Use the Pi SDK directly in `core/src/harness.ts`; do not spawn Pi RPC
  subprocesses from Node.
- `ModelRuntime`, credentials, custom models, session trees, compaction,
  retries, skills, extensions, and tool execution remain Pi-owned.
- `pi-subagents` provides chains, parallel delegation, reviews, worktrees,
  and child-agent lifecycle. Do not rebuild an orchestrator in `core/`.
- Pi resources can execute code. Do not add HTTP routes that install packages,
  upload extensions, or accept provider secrets. Use `pi install`,
  `pi /login`, Pi settings, and trusted project `.pi` resources instead.
- Keep Pi-specific endpoints additive under
  `/api/v1/sessions/:sessionId/pi/*`. Existing Gateway naming remains
  `snake_case`.
- `TINADEC_PI_AGENT_DIR` optionally isolates Pi configuration. Tinadec
  metadata is in `.tinadec-pi/state.json`, which is ignored by Git.

## Boundaries

- Desktop never calls Core directly.
- Gateway stays a thin proxy/BFF. It may validate Code-tool approval proof,
  but must not persist state or reimplement Pi behavior.
- Core emits legacy-compatible metadata and SSE envelopes. Pi remains the
  source of truth for agent conversations and tools.
- Keep `TinadecTools` approval semantics unchanged until its Gateway bridge is
  intentionally replaced.

## Commands

```bash
npm install
npm run dev
npm run build
npm test
npm run build:tools
npm run test -w @tinadec/pi-core
npm run test -w @tinadec/gateway
npm run test -w @tinadec/desktop
```

## Validation

For Core changes, run its TypeScript build and tests. For Gateway contract
changes, run Gateway tests too. A missing Pi login must appear in readiness
without exposing credentials or preventing Core startup.
