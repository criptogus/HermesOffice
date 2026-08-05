# Integração Hermes (IA nativa)

O HermesOffice usa o **Hermes Agent** (Nous Research) como IA nativa: o
painel de IA dos apps conversa com o gateway local do Hermes, que roda o
agente completo — memória, skills, tools e MCP — em vez de um LLM genérico
com o documento colado no prompt.

## Como funciona

```
HermesOffice (docs/sheets/slides/pdf)
   └─ ai:stream (provider "hermes", OpenAI-compatible)
        └─ POST http://127.0.0.1:8642/v1/chat/completions   (stream: true)
             └─ gateway do Hermes (API server, porta 8642)
                  └─ agente Hermes completo (memória, skills, tools, MCP)
```

- **Provider**: `hermes` — novo provider nativo em `packages/ai-provider`
  (OpenAI-compatible, mesmo protocolo do Genspark, sem login de conta).
- **Base URL default**: `http://127.0.0.1:8642/v1` (constante
  `HERMES_LLM_BASE_URL` em `packages/ai-provider/src/providers.ts`).
- **Model**: `hermes-agent` (o nome anunciado pelo API server em `/v1/models`).
- **Auth**: `Authorization: Bearer <API_SERVER_KEY>` — a mesma chave do
  gateway. A chave fica em `ai-settings.json` no userData do app, como as
  demais chaves de provider.

## Pré-requisitos no host

O gateway do Hermes precisa estar rodando com o API server habilitado:

```bash
# .env (Hermes)
API_SERVER_KEY=<chave>

# config.yaml (Hermes)
gateway:
  platforms:
    api_server:
      enabled: true

hermes gateway restart
curl http://127.0.0.1:8642/health   # {"status":"ok",...}
```

O HermesOffice não sobe o gateway sozinho — ele assume o gateway local
disponível (mesma máquina, loopback). Se o gateway estiver offline, o painel
de IA reporta erro de conexão; suba o gateway e tente de novo.

## Mudanças em relação ao upstream (camada de fork)

| Arquivo                                                              | Mudança                                                          |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `packages/ai-provider/src/types.ts`                                  | `AiProviderId` ganha `'hermes'`; `AiProviderMeta.defaultBaseUrl` |
| `packages/ai-provider/src/providers.ts`                              | Provider `hermes` (default); `HERMES_LLM_BASE_URL`               |
| `packages/ai-provider/src/stream.ts`                                 | `streamForProvider` case `hermes` (OpenAI-compatible)            |
| `packages/ai-provider/src/chat.ts`                                   | `chatForProvider` case `hermes` (one-shot)                       |
| `apps/{docs,sheets}/src/main/*.ts`, `apps/slides/src/main/ai-ipc.ts` | Provider forçado `genspark` → `hermes`                           |
| `apps/docs/src/renderer/ai/AiPanel.tsx`                              | Sign-in Genspark só p/ provider `genspark`                       |

Ao sincronizar com o upstream, essas são as únicas áreas que podem conflitar
— o script `tools/rebrand-hermesoffice.py --check` acusa qualquer
"genoffice" reintroduzido no código.

## Estado (roadmap)

- [x] Provider `hermes` default + roteamento de stream/chat
- [x] Força do provider nos 3 apps (docs/sheets/slides)
- [x] Sign-in Genspark não aparece para provider Hermes
- [x] Auto-detect de saúde do gateway (`/health` antes do stream, erro amigável)
- [x] Continuidade de sessão por documento (`X-Hermes-Session-Id` header)
- [x] Ferramentas de documento expostas ao agente — skills publicadas em `hermes/skills/` (ver `hermes/README.md`)
- [x] Launcher opcional que oferece subir o gateway ao abrir o app (com consentimento)
