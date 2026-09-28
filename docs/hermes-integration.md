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
reports a connection error; start the gateway and try again. On launch, the
app offers to start the gateway when it is offline (consent-gated).

## Getting started (from zero)

A complete first run, from a machine without Hermes to an agent-assisted edit.

1. **Install Hermes Agent.** Follow the official install guide at
   <https://hermes-agent.nousresearch.com/docs> (any install method works —
   the only requirement is the `hermes` CLI on your PATH).
2. **Enable the local API server** (this is what the apps talk to):

   ```bash
   hermes config set gateway.platforms.api_server.enabled true
   ```

3. **Set the API key.** The key must live in `~/.hermes/.env`:

   ```bash
   # wrong: `hermes config set API_SERVER_KEY <key>` writes to config.yaml,
   # which the API server does NOT read (bridged config)
   # right:
   hermes config unset API_SERVER_KEY   # only if you ran the wrong command
   echo "API_SERVER_KEY=<key>" >> ~/.hermes/.env
   ```

   Pick any long random string — it is the bearer token the apps send.

4. **Restart the gateway and check health:**

   ```bash
   hermes gateway restart
   curl http://127.0.0.1:8642/health   # → {"status":"ok",...}
   ```

5. **Launch HermesOffice.** The app fills the key in itself: on startup the
   shell reads `API_SERVER_KEY` from `~/.hermes/.env` and writes it to the
   `hermes` provider slot in the app's `ai-settings.json` (0600, never in the
   repo). Nothing to paste on a machine that already has the gateway key. If
   the key is missing or differs, open **Settings → AI model → Hermes**, paste
   the `API_SERVER_KEY` value and save — the provider slot is only seeded while
   its key is empty, so an explicitly configured key is never overwritten. If
   you skip both, the panel replies with `Nenhuma chave de API configurada` —
   that is the app's way of saying "no API key set", not a Hermes error.
6. **First agent edit.** Open a `.docx`, open the AI panel and ask something
   concrete, e.g. _"rewrite the first paragraph more concisely"_. The agent
   streams a response; accepted edits go through the app's block-patch
   pipeline (propose → preview → apply) and the document keeps its
   byte-preserving round-trip. In Sheets, edits preview as operations before
   you apply them.

The gateway must be running while you use the AI panel. If it is offline, the
panel shows a connection error — and on app launch HermesOffice offers to
start the gateway for you (consent-gated).

## Changes vs upstream (fork layer)

| File                                                                 | Change                                                           |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `packages/ai-provider/src/types.ts`                                  | `AiProviderId` gains `'hermes'`; `AiProviderMeta.defaultBaseUrl` |
| `packages/ai-provider/src/providers.ts`                              | `hermes` provider (default); `HERMES_LLM_BASE_URL`               |
| `packages/ai-provider/src/stream.ts`                                 | `streamForProvider` case `hermes` (OpenAI-compatible)            |
| `packages/ai-provider/src/chat.ts`                                   | `chatForProvider` case `hermes` (one-shot)                       |
| `apps/{docs,sheets}/src/main/*.ts`, `apps/slides/src/main/ai-ipc.ts` | Provider forced `genspark` → `hermes`                            |
| `apps/shell/src/main/hermes-ai-settings.ts`                          | Startup seed of the hermes key from `~/.hermes/.env`             |
| `apps/docs/src/renderer/ai/AiPanel.tsx`                              | Genspark sign-in only for `genspark` provider                    |

When syncing with upstream, these are the only areas that can conflict — the
`tools/rebrand-hermesoffice.py --check` script flags any "hermesoffice"
reintroduced into the code.

## Status (roadmap)

- [x] `hermes` provider default + stream/chat routing
- [x] Provider forced in all four apps (docs/sheets/slides/pdf)
- [x] Genspark sign-in hidden for the Hermes provider
- [x] Gateway health check before streaming with a friendly "gateway offline" error
- [x] Per-document session continuity (`X-Hermes-Session-Id` header, stable sha256 of filePath)
- [x] Document tools exposed to the agent — skills published in `hermes/skills/` (see `hermes/README.md`)
- [x] Optional launcher that offers to start the gateway on app launch (consent-gated)
- [x] Startup seed of the gateway key from `~/.hermes/.env` (no manual paste on a fresh install)
