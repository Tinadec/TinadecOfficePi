# TinadecPi

TinadecPi is the Pi Agent-based successor to TinadecOffice. It retains the
Electron desktop client and Gateway HTTP/SSE contract, while replacing the
incomplete `TinadecCore` and model-routing shell with an in-process Pi SDK
harness.

## Architecture

- **Desktop**: Electron and Vue on port `5173`. It calls Gateway only.
- **Gateway**: Elysia and Node on port `48730`. It keeps the existing BFF,
  API contract, CORS, and Code-tool bridge.
- **Core**: Pi SDK and Elysia on port `48731`. It manages Pi sessions,
  streaming, model runtime access, and durable Tinadec metadata.

The Core embeds `@earendil-works/pi-coding-agent`. Pi remains responsible for
credentials, configured models, session trees, compaction, retries, skills,
extensions, and tool execution. `pi-subagents` is loaded as the multi-agent
extension, providing planner, worker, reviewer, chains, parallel work, and
isolated worktrees without a second orchestration implementation.

## Start

```powershell
pi /login
npm install
npm run dev
```

OpenAPI remains available from the unchanged Gateway endpoint:
`http://127.0.0.1:48730/docs`.

Pi credentials and custom models use the standard Pi agent directory by
default. Set `TINADEC_PI_AGENT_DIR` to isolate TinadecPi from a global Pi
configuration. Tinadec metadata is stored in `.tinadec-pi/state.json`; no API
key is stored by TinadecPi.

## Commands

```bash
npm run dev
npm run build
npm test
npm run build:tools
```

`build:tools` is optional for ordinary development, but required when using or
testing Gateway Code-tool endpoints backed by `TinadecTools`.

Desktop installers can be built on their native platform with:

```bash
npm run dist:win -w @tinadec/desktop
npm run dist:mac -w @tinadec/desktop
npm run dist:linux -w @tinadec/desktop
```

The `Desktop builds` GitHub Actions workflow runs these builds for Windows,
macOS, and Linux on pull requests, pushes to `main`, version tags, and manual
dispatch. CI packages x64 only. Artifacts are uploaded per OS. Windows produces both
`TinadecOffice-*-win-x64-setup.exe` (NSIS) and
`TinadecOffice-*-win-x64-portable.exe`. Each package bundles Node and npm, the compiled
Core and Gateway services, and a platform-specific self-contained
`TinadecTools` publish; users do not need Node or .NET installed. A non-default
Gateway URL keeps the bundled services disabled and routes model config through
that Gateway instead of the local package agent dir.

Tags must use `vX.Y.Z`; the workflow synchronizes that version into all
workspace package metadata before building. Tag builds require
`WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` for Windows, plus `CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and
`APPLE_TEAM_ID` for macOS signing and notarization. Successful tag builds
publish all x64 artifacts and `SHA256SUMS` to a GitHub Release. Pull request
and other non-tag builds remain unsigned.

## Compatibility

- Gateway routes and snake_case request/response fields are preserved.
- Desktop continues to call Gateway on port `48730`.
- Code-tool endpoints and `TinadecTools` keep their approval checks.
- Pi-specific state, steering, follow-up, and cancellation routes are additive
  under `/api/v1/sessions/:sessionId/pi/*`.
- Packages, credentials, and agents are managed by Pi (`pi install`,
  `pi /login`, and `.pi/agents`), not arbitrary HTTP uploads.
