# Desktop Guide

## Scope

Electron and Vue desktop UI. Vite listens on `127.0.0.1:5173`; the renderer
calls Gateway only. Do not call Core directly or expose filesystem, shell, or
model credentials to the renderer.

## Backend Contract

- Gateway remains `http://127.0.0.1:48730` and owns the public `/api/v1/*`
  contract.
- Core is a Pi SDK harness. Existing DTOs in `src/api.ts` remain the
  compatibility boundary.
- Pi model credentials, model selection, skills, extensions, tool calls,
  session trees, compaction, and multi-agent delegation are backend-owned.
  UI may display readiness and manifests but must not reproduce their logic.
- Pi-specific controls use additive `/api/v1/sessions/:sessionId/pi/*` routes
  for state, steering, follow-up work, and cancellation.
- Code-tool and Git execution remain Gateway/Core approval-controlled.
  Renderer code must never mint approvals or execute Git directly.

## Structure

- `src/pages/`: route pages.
- `src/components/`: feature components and UI primitives.
- `src/debug/`: Agent Debug Studio.
- `src/api.ts`: Gateway DTO mirror and client.
- `electron/`: hardened Electron processes and terminal management.

## Commands

```bash
npm run build -w @tinadec/desktop
npm run test -w @tinadec/desktop
npm run dev -w @tinadec/desktop
```
