# Hermes integration (native AI)

HermesOffice uses the **Hermes Agent** (Nous Research) as its native AI: the
AI panel in every app talks to the local Hermes gateway, which runs the full
agent — memory, skills, tools and MCP — instead of a generic LLM with the
document pasted into the prompt.

## How it works

```
HermesOffice (docs/sheets/slides/pdf)
   └─ ai:stream (provider "hermes", OpenAI-compatible)
        └─ POST http://127.0.0.1:8642/v1/chat/completions   (stream: true)
             └─ Hermes gateway (API server, port 8642)
                  └─ full Hermes agent (memory, skills, tools, MCP)
```

- **Provider**: `hermes` — a native provider in `packages/ai-provider`
  (OpenAI-compatible, same protocol as Genspark, no account login).
- **Default base URL**: `http://127.0.0.1:8642/v1` (constant
  `HERMES_LLM_BASE_URL` in `packages/ai-provider/src/providers.ts`).
- **Model**: `hermes-agent` (the name advertised by the API server in `/v1/models`).
- **Auth**: `Authorization: Bearer *** — the same key as the gateway. The key
lives in `ai-settings.json` in the app's userData, like other provider keys.

## Host prerequisites

The Hermes gateway must be running with the API server enabled:

```bash
# .env (Hermes)
API_SERVER_KEY=<key>

# config.yaml (Hermes)
gateway:
  platforms:
    api_server:
      enabled: true

hermes gateway restart
curl http://127.0.0.1:8642/health   # {"status":"ok",...}
```

HermesOffice does not start the gateway by itself — it assumes a local gateway
is available (same machine, loopback). If the gateway is offline, the AI panel
reports a connection error; start the gateway and try again. An optional
launcher that ensures the gateway is running when the app opens is on the
roadmap (see [ROADMAP.md](../ROADMAP.md)).

## Changes vs upstream (fork layer)

| File                                                                 | Change                                                           |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `packages/ai-provider/src/types.ts`                                  | `AiProviderId` gains `'hermes'`; `AiProviderMeta.defaultBaseUrl` |
| `packages/ai-provider/src/providers.ts`                              | `hermes` provider (default); `HERMES_LLM_BASE_URL`               |
| `packages/ai-provider/src/stream.ts`                                 | `streamForProvider` case `hermes` (OpenAI-compatible)            |
| `packages/ai-provider/src/chat.ts`                                   | `chatForProvider` case `hermes` (one-shot)                       |
| `apps/{docs,sheets}/src/main/*.ts`, `apps/slides/src/main/ai-ipc.ts` | Provider forced `genspark` → `hermes`                            |
| `apps/docs/src/renderer/ai/AiPanel.tsx`                              | Genspark sign-in only for `genspark` provider                    |

When syncing with upstream, these are the only areas that can conflict — the
`tools/rebrand-hermesoffice.py --check` script flags any "genoffice"
reintroduced into the code.

## Status (roadmap)

- [x] `hermes` provider default + stream/chat routing
- [x] Provider forced in all four apps (docs/sheets/slides/pdf)
- [x] Genspark sign-in hidden for the Hermes provider
- [x] Gateway health check before streaming with a friendly "gateway offline" error
- [x] Per-document session continuity (`X-Hermes-Session-Id` header, stable sha256 of filePath)
- [x] Document tools exposed to the agent — skills published in `hermes/skills/` (see `hermes/README.md`)
- [x] Optional launcher that offers to start the gateway on app launch (consent-gated)
