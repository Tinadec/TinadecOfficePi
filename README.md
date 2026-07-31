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
dispatch. Artifacts are uploaded per OS. Windows produces
`TinadecOffice-*-win-x64-setup.exe` (NSIS) and
`TinadecOffice-*-win-x64.zip` (extract, then run `TinadecOffice.exe`). The ZIP
replaces the self-extracting portable executable, which was too slow with the
bundled runtime. Each package runs the compiled Core and Gateway services with
its bundled fixed Node runtime and includes a platform-specific self-contained
`TinadecTools` publish; users do not need Bun or .NET installed. A non-default
Gateway URL keeps the bundled services disabled and routes model config through
that Gateway instead of the local package agent dir.

## Compatibility

- Gateway routes and snake_case request/response fields are preserved.
- Desktop continues to call Gateway on port `48730`.
- Code-tool endpoints and `TinadecTools` keep their approval checks.
- Pi-specific state, steering, follow-up, and cancellation routes are additive
  under `/api/v1/sessions/:sessionId/pi/*`.
- Packages, credentials, and agents are managed by Pi (`pi install`,
  `pi /login`, and `.pi/agents`), not arbitrary HTTP uploads.
