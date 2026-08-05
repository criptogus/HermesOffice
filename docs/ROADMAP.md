# Roadmap HermesOffice — o office do futuro, colaborativo entre humanos e agentes

Este documento propõe uma direção de evolução para a comunidade. Ele parte de
uma leitura honesta do código de hoje: o que já é forte, o que falta, e em que
ordem atacar. Nada aqui é promessa — é um convite a contribuir. Discussões e
ajustes: abra uma issue com o label `roadmap`.

## Onde estamos (diagnóstico)

**Forças reais do código atual**

- Engines de formato maduros e muito bem testados (docx round-trip byte-preserving,
  pptx engine própria, xlsx via sidecar Rust). Essa é a fundação que quase nenhum
  projeto open-source tem.
- `packages/agent-core` enxuto e sólido: loop ReAct genérico com compactação de
  contexto, retry de tool-input, cancelamento, snapshots e sessão persistente
  (`X-Hermes-Session-Id` por documento já entregue).
- IA nativa local via gateway Hermes (OpenAI-compatible, sem conta, sem nuvem).

**Lacunas estruturais**

1. **UX de confiança da IA é inconsistente entre apps.** Sheets tem o melhor
   modelo (`propose_operations` → preview de diff → aplicação atômica); docs e
   slides usam snapshot + rollback pós-fato; **pdf não tem nenhum dos dois** e
   nem sequer força o provider `hermes` como os outros três apps.
2. **Colaboração é inexistente.** Zero CRDT/OT/sync/presence. Comentários e
   track-changes existem, mas são features OOXML single-user. O
   `project-store` local já espelha um modelo de projeto "de nuvem" — o gancho
   existe, a nuvem não.
3. **Extensibilidade não formalizada.** `AgentSkill` + `composeSkills()` é um
   sistema de plugins de facto, mas só em compile-time. Sem MCP host, sem
   scripting de usuário (fora a DSL interna de slides), sem API de automação.
4. **Integração Hermes inacabada** (ver `docs/hermes-integration.md`):
   health-check do gateway, launcher, e tools de documento expostas ao agente.
5. **Cobertura de testes desbalanceada:** engines com 50–76 arquivos de teste
   cada; `agent-core` (o coração da IA) com 2; `slides-skill.ts` (3.325 linhas,
   33 tools) proporcionalmente pouco coberto; só 3 specs E2E.

## Visão

> Um office onde humanos e agentes editam os **mesmos documentos, pelo mesmo
> protocolo, com o mesmo modelo de permissão e revisão** — local-first,
> privado por padrão, e colaborativo por design. O agente não é um chat ao
> lado do documento: é um participante do documento, com presença, autoria,
> propostas revisáveis e histórico.

Três princípios que decorrem do que o código já faz bem:

- **Local-first**: o arquivo é a fonte da verdade; sync é uma camada, não um
  requisito. Nada de conta obrigatória.
- **Propor antes de mutar**: toda edição de agente deve ser um *diff revisável*
  (o modelo do sheets), com aceitar/rejeitar granular e rollback.
- **Um protocolo para todos os autores**: humano na UI, Hermes no painel, e
  agentes externos via MCP falam com o documento pela mesma superfície de
  tools/ops — autoria e auditoria idênticas.

## Fase 1 — Consolidar a fundação de IA (curto prazo, ~1 release)

Objetivo: paridade e confiança. Tudo aqui é incremental sobre código existente.

- **Contrato unificado de "proposed change" no `agent-core`.** Generalizar o
  `ChangePlan` do sheets: `ToolExecution` ganha um modo `proposed`, o loop
  ganha ciclo propose → review → apply/reject, e cada app implementa o render
  do diff. Docs e slides migram; pdf adota.
- **Nivelar o app PDF**: forçar provider `hermes` como os demais, adicionar
  `files-skill`/`web_search`, snapshots + rollback, e primeiras tools de
  edição de conteúdo (texto de anotações, stamps, montagem de páginas).
- **Fechar o roadmap Hermes pendente**: health-check `/health` antes do stream
  com erro amigável "gateway offline"; launcher opcional que sobe o gateway;
  documentar setup em 1 comando.
- **Dívida de teste crítica**: suíte dedicada para `agent-core` (compactação,
  retry, cancelamento, snapshot) e testes de contrato para as 33 tools de
  slides; +E2E cobrindo um fluxo de IA por app.
- Quick wins de formato já mapeados nos TODOs: persistência OOXML de slicers,
  pivot com fontes externas, z-order em picture edit, IME sobre seleção.

## Fase 2 — Documento como superfície de agentes (médio prazo)

Objetivo: transformar a integração "arquivo + file-watcher" de hoje num
protocolo de primeira classe.

- **MCP server embutido por app** (`hermesoffice-docs-mcp` etc.): expor as
  mesmas tools do painel de IA (`read_blocks`, `replace_blocks`,
  `propose_operations`, tools de slides/pdf) a qualquer agente MCP — Hermes,
  Claude Code, ou o que a comunidade plugar. Toda mutação externa entra pelo
  mesmo pipeline de proposed-change/track-changes.
- **Skills de documento no lado do Hermes**: pacote de skills publicado para o
  gateway consumir, fechando o item aberto do `hermes-integration.md`.
- **Autoria de agente**: comentários e revisions OOXML assinados com a
  identidade do agente ("Hermes propôs, Gustavo aceitou") — a base de
  auditoria antes de qualquer colaboração em rede.
- **API de automação/headless**: CLI sobre os engines (converter, aplicar
  patch, extrair) — os engines já são TS puro sem Electron; é empacotamento,
  não pesquisa.
- **Sistema de plugins runtime**: evoluir `AgentSkill` de compile-time para
  carregamento dinâmico com manifest e permissões declaradas (quais tools,
  quais escopos), reutilizando a validação Zod já existente no IPC.

## Fase 3 — Colaboração humano + agente (longo prazo)

Objetivo: multi-usuário local-first, com agentes como participantes.

- **Camada CRDT opcional** (Yjs ou Automerge) por cima do modelo de blocos:
  o docx segue sendo a verdade em disco; o CRDT é o transporte de sessão.
  Começar por docs (modelo de blocos com âncoras `docxIndex` já é
  patch-friendly); sheets pode avaliar o ecossistema Univer.
- **Presence & awareness**: cursores, seleções — e o agente aparece como um
  participante com cursor próprio enquanto trabalha.
- **Sync server open-source de referência** (candidato natural ao diretório
  `ee/` para variantes enterprise: SSO, retenção, deploy privado), mantendo o
  produto 100% funcional offline e peer-to-peer em rede local.
- **Sessões de trabalho compartilhadas com agentes**: vários humanos + um
  Hermes na mesma sessão, com fila de propostas e permissões por participante.

## Fase 4 — O office do futuro (exploratório)

- **Documentos vivos**: blocos ligados a fontes (uma tabela do sheets embutida
  no docs, um range que alimenta um gráfico no slides) com recomputação
  reativa.
- **Agente proativo com consentimento**: Hermes observa o documento (opt-in) e
  sugere — "esses números não batem com a planilha anexa" — sempre como
  proposta, nunca como mutação.
- **Geração cruzada**: "transforme este relatório em deck" como pipeline entre
  engines, não como prompt gigante.
- **Voz e reunião**: ditar edições, transcrever reunião direto num docs com o
  agente estruturando em tempo real.

## Como a comunidade pode ajudar agora

| Perfil | Por onde começar |
|---|---|
| Primeiro PR | TODOs mapeados (slicers, pivot, z-order, IME), testes de `agent-core` |
| TypeScript/React | Unificação do proposed-change (Fase 1), paridade do app PDF |
| Interessado em agentes | MCP server embutido, skills Hermes, plugins runtime |
| Rust | Sidecar xlsx (pivot externo, performance) |
| Distributed systems | RFC da camada CRDT (Fase 3) — abra uma issue de design antes de codar |
| Docs/i18n | Guias de setup do gateway Hermes, traduções em `packages/i18n` |

Regras de contribuição em [CONTRIBUTING.md](../CONTRIBUTING.md). Para
mudanças arquiteturais (Fases 2–3), abra primeiro uma issue `rfc` descrevendo
o design — merge de código estrutural sem RFC prévia tende a ser devolvido.
