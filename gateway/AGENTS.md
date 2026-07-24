# Gateway Guide

## Scope

Gateway is the ESM Elysia BFF on port `48730`. Desktop calls this process only.
It preserves `/api/v1/*` JSON and SSE syntax, forwards Core requests to
`TINADEC_CORE_URL`, and owns no durable application state.

The Core is `core/`, a Pi SDK harness. It owns Tinadec metadata while Pi owns
model credentials, model selection, sessions, tool execution, extensions,
skills, retries, compaction, and subagent orchestration.

## Keep These Boundaries

- Use `proxyJson` and `proxySse` for Core routes and preserve status codes and
  snake_case payloads.
- Do not add model credentials, agent state, package installation, or extension
  execution to Gateway.
- Pi-specific routes are additive under `/api/v1/sessions/:sessionId/pi/*`.
  Proxy them without translation.
- `modelAgentCenter.ts` is a stateless, secret-stripping presentation adapter.
  Pi-managed provider configuration remains read-only in legacy CRUD routes.
- Code-tool HTTP routes remain local and must verify Core approval state before
  executing a risky tool.
- `TinadecTools` is a separate C# tool host. Keep
  `toolLayerBridge.ts` lifecycle and workspace isolation behavior intact.
- Keep manual CORS because the Node adapter rejected preflight with the CORS
  plugin.

## Commands

```bash
npm run build -w @tinadec/gateway
npm run test -w @tinadec/gateway
node --test --import tsx src/coreClient.test.ts
```
