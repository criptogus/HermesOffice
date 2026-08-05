# HermesOffice Roadmap — the office of the future, collaborative between humans and agents

This document proposes a direction of evolution for the community. It starts
from an honest reading of today's code: what is already strong, what is
missing, and in what order to attack it. Nothing here is a promise — it is an
invitation to contribute. Discussion and adjustments: open an issue with the
`roadmap` label.

## Where we are (diagnosis)

**Real strengths of the current code**

- Mature, very well tested format engines (byte-preserving docx round-trip,
  in-house pptx engine, xlsx via Rust sidecar). This is a foundation almost no
  open-source project has.
- A lean, solid `packages/agent-core`: a generic ReAct loop with context
  compaction, tool-input retry, cancellation, snapshots and persistent
  sessions (per-document `X-Hermes-Session-Id` already shipped).
- Native local AI via the Hermes gateway (OpenAI-compatible, no account, no
  cloud).

**Structural gaps**

1. **AI trust UX is inconsistent across apps.** Sheets has the best model
   (`propose_operations` → diff preview → atomic apply); docs and slides use
   after-the-fact snapshot + rollback; **pdf has neither** and does not even
   force the `hermes` provider like the other three apps.
2. **Collaboration is nonexistent.** Zero CRDT/OT/sync/presence. Comments and
   track-changes exist, but they are single-user OOXML features. The local
   `project-store` already mirrors a "cloud" project model — the hook exists,
   the cloud does not.
3. **Extensibility is not formalized.** `AgentSkill` + `composeSkills()` is a
   de facto plugin system, but compile-time only. No MCP host, no user
   scripting (beyond the internal slides DSL), no automation API.
4. **Hermes integration is unfinished** (see `docs/hermes-integration.md`):
   gateway health check, launcher, and document tools exposed to the agent.
5. **Unbalanced test coverage:** engines have 50–76 test files each;
   `agent-core` (the heart of the AI) has 2; `slides-skill.ts` (3,325 lines,
   33 tools) is proportionally under-covered; only 3 E2E specs.

## Vision

> An office where humans and agents edit the **same documents, through the
> same protocol, with the same permission and review model** — local-first,
> private by default, and collaborative by design. The agent is not a chat
> next to the document: it is a participant in the document, with presence,
> authorship, reviewable proposals and history.

Three principles that follow from what the code already does well:

- **Local-first**: the file is the source of truth; sync is a layer, not a
  requirement. No mandatory account.
- **Propose before mutating**: every agent edit should be a _reviewable diff_
  (the sheets model), with granular accept/reject and rollback.
- **One protocol for all authors**: a human in the UI, Hermes in the panel,
  and external agents via MCP all talk to the document through the same
  tools/ops surface — identical authorship and auditability.

## Phase 1 — Consolidate the AI foundation (short term, ~1 release)

Goal: parity and trust. Everything here is incremental over existing code.

- **Unified "proposed change" contract in `agent-core`.** Generalize the
  sheets `ChangePlan`: `ToolExecution` gains a `proposed` mode, the loop gains
  a propose → review → apply/reject cycle, and each app implements the diff
  rendering. Docs and slides migrate; pdf adopts.
- **Bring the PDF app up to par**: force the `hermes` provider like the
  others, add `files-skill`/`web_search`, snapshots + rollback, and first
  content-editing tools (annotation text, stamps, page assembly).
- **Close the pending Hermes roadmap**: `/health` check before streaming with
  a friendly "gateway offline" error; optional launcher that starts the
  gateway; document one-command setup.
- **Critical test debt**: a dedicated suite for `agent-core` (compaction,
  retry, cancellation, snapshot) and contract tests for the 33 slides tools;
  plus one AI-flow E2E per app.
- Format quick wins already mapped in TODOs: OOXML slicer persistence, pivots
  with external sources, z-order in picture edit, IME over selection.

## Phase 2 — The document as an agent surface (mid term)

Goal: turn today's "file + file-watcher" integration into a first-class
protocol.

- **Embedded MCP server per app** (`hermesoffice-docs-mcp` etc.): expose the
  same tools as the AI panel (`read_blocks`, `replace_blocks`,
  `propose_operations`, slides/pdf tools) to any MCP agent — Hermes, Claude
  Code, or whatever the community plugs in. Every external mutation goes
  through the same proposed-change/track-changes pipeline.
- **Document skills on the Hermes side**: a published skills package for the
  gateway to consume, closing the open item in `hermes-integration.md`.
- **Agent authorship**: OOXML comments and revisions signed with the agent's
  identity ("Hermes proposed, you accepted") — the audit base before any
  networked collaboration.
- **Automation/headless API**: a CLI over the engines (convert, apply patch,
  extract) — the engines are already pure TS with no Electron; this is
  packaging, not research.
- **Runtime plugin system**: evolve `AgentSkill` from compile-time to dynamic
  loading with a manifest and declared permissions (which tools, which
  scopes), reusing the Zod validation already present in the IPC layer.

## Phase 3 — Human + agent collaboration (long term)

Goal: local-first multi-user, with agents as participants.

- **Optional CRDT layer** (Yjs or Automerge) on top of the block model: the
  docx remains the truth on disk; the CRDT is the session transport. Start
  with docs (the block model with `docxIndex` anchors is already
  patch-friendly); sheets can evaluate the Univer ecosystem.
- **Presence & awareness**: cursors, selections — and the agent shows up as a
  participant with its own cursor while it works.
- **Open-source reference sync server** (natural candidate for the `ee/`
  directory for enterprise variants: SSO, retention, private deploy), keeping
  the product 100% functional offline and peer-to-peer on a local network.
- **Shared working sessions with agents**: multiple humans + one Hermes in the
  same session, with a proposal queue and per-participant permissions.

## Phase 4 — The office of the future (exploratory)

- **Living documents**: blocks linked to sources (a sheets table embedded in
  docs, a range feeding a chart in slides) with reactive recomputation.
- **Proactive agent with consent**: Hermes watches the document (opt-in) and
  suggests — "these numbers don't match the attached spreadsheet" — always as
  a proposal, never as a mutation.
- **Cross-generation**: "turn this report into a deck" as a pipeline between
  engines, not one giant prompt.
- **Voice and meetings**: dictate edits, transcribe a meeting straight into
  docs with the agent structuring it in real time.

## How the community can help now

| Profile             | Where to start                                                     |
| ------------------- | ------------------------------------------------------------------ |
| First PR            | Mapped TODOs (slicers, pivot, z-order, IME), `agent-core` tests    |
| TypeScript/React    | Proposed-change unification (Phase 1), PDF app parity              |
| Agent enthusiasts   | Embedded MCP server, Hermes skills, runtime plugins                |
| Rust                | xlsx sidecar (external pivots, performance)                        |
| Distributed systems | CRDT layer RFC (Phase 3) — open a design issue before writing code |
| Docs/i18n           | Hermes gateway setup guides, translations in `packages/i18n`       |

Contribution rules in [CONTRIBUTING.md](../CONTRIBUTING.md). For architectural
changes (Phases 2–3), open an `rfc` issue describing the design first —
structural code merged without a prior RFC tends to be sent back.
