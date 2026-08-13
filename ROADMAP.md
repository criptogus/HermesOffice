# HermesOffice — Public Roadmap

> Status: **living document** — updated by maintainers as the product evolves.
> Contributions welcome: open an issue to discuss a direction, or jump into the
> [How to help](#how-the-community-can-help) section.

## Vision

**The office where humans and agents work as one team.**

HermesOffice is an AI-native office suite (Docs, Sheets, Slides, PDF) built on
open standards — `.docx`, `.xlsx`, `.pptx` — where the **Hermes Agent**
(Nous Research, open source) is the native brain: memory, skills, tools, MCP,
running 100% locally by default. We are not adding a chat box to documents;
we are turning every document into a shared workspace where people and agents
plan, draft, verify and polish together.

## Why this exists

- Office files are where knowledge work happens. Today, AI-office tools bolt a
  chat panel onto a document. We invert the model: **the document is the
  interface, and the agent is a collaborator** with real context and the
  ability to act.
- **Local-first, open standards, no lock-in.** Files round-trip byte-preserving
  (opening and saving never breaks layout in Word/Excel/PowerPoint). No cloud
  account is required; collaboration is additive and self-hosted.
- **Hermes is the backbone.** Identity, memory, sessions and agents come from
  Hermes — an open, local, extensible agent platform — not from a proprietary
  cloud. The office is one surface of that platform.

## Why now

- **Value is migrating to the agent-tooling layer.** Office suites are
  commoditizing; MCP (Model Context Protocol) has become the de facto standard
  for agent-tool interoperability across major agent platforms. The category
  being defined today is "the office where *any* agent works" — and the first
  MCP-native office gets to shape it.
- **Incumbents are bolting copilots onto proprietary walls.** That leaves the
  open-standards lane open: `.docx`/`.xlsx`/`.pptx` on disk, any agent in,
  audit trail out. The moat is not the app — it is the protocol + trust layer.
- **The assets are mature; the window is open.** Byte-preserving OOXML
  round-trip (the hardest part) is done. MCP adoption is at its inflection
  point. Local-first AI is being pulled by privacy regulation (LGPD, EU AI
  Act) and by buyers who cannot put board material into a cloud copilot.

## State of the code (honest diagnosis)

**Real strengths**

- Mature, very well tested format engines (byte-preserving docx round-trip,
  in-house pptx engine, xlsx via Rust sidecar) — a foundation almost no
  open-source project has.
- A lean, solid `packages/agent-core`: a generic ReAct loop with context
  compaction, tool-input retry, cancellation, snapshots and persistent
  per-document sessions (`X-Hermes-Session-Id` shipped).
- Native local AI via the Hermes gateway (OpenAI-compatible, no account, no
  cloud) in all four apps.

**Structural gaps**

1. **AI trust UX is inconsistent across apps.** Sheets has the best model
   (`propose_operations` → diff preview → atomic apply); docs and slides use
   after-the-fact snapshot + rollback; PDF is catching up (content-editing
   tools landed, trust UX pending).
2. **Collaboration is nonexistent.** Zero CRDT/OT/sync/presence. Comments and
   track-changes exist but are single-user OOXML features. The local
   `project-store` already mirrors a "cloud" project model — the hook exists,
   the cloud does not.
3. **Extensibility is not formalized.** `AgentSkill` + `composeSkills()` is a
   de facto plugin system, but compile-time only. No MCP host, no user
   scripting, no automation API.
4. **The agent is still a guest, not a participant.** Health checks, the
   gateway launcher and per-document session continuity shipped; what remains
   open is the agent-native surface: document tools exposed via MCP, a unified
   approval model, and agent authorship (Trusted Agent Actions track below).
5. **Unbalanced test coverage:** engines have 50–76 test files each;
   `agent-core` (the heart of the AI) is under-covered; `slides-skill.ts`
   (3,325 lines, 33 tools) is proportionally under-covered; only a handful of
   E2E specs.

## Relationship with upstream

HermesOffice is a **thin fork** of [genspark-ai/genoffice](https://github.com/genspark-ai/genoffice)
(Apache-2.0). Engines and app shells follow upstream; our own layer is the
Hermes integration, product identity and collaboration features. That keeps
upstream sync cheap and lets us focus community energy on the agent-native
layer instead of re-engineering engines.

## Principles

1. **Open standards first** — files stay `.docx`/`.xlsx`/`.pptx`; byte-preserving round-trip is sacred.
2. **Agent-native** — the agent is a first-class participant: context, memory, actions, accountability.
3. **Local-first, collab-on-top** — privacy by default; collaboration is an additive layer, never a requirement.
4. **Hermes is the backbone** — sessions, memory, identity and agents come from Hermes.
5. **Outcome-driven** — every phase ships measurable outcomes, not feature checklists.

---

## Now — Phase 1 · Trusted Foundation

> **Outcome:** *Enable anyone to install and evaluate HermesOffice in minutes —
> signed releases, a green codebase, clear docs — so the community can adopt,
> test and contribute with confidence.*

| Initiative | Why (outcome) | Status |
|---|---|---|
| Signed releases (macOS + Windows) | Install without "unknown developer" friction | 🔜 in progress |
| CI as a real gate (format, lint, typecheck, tests, licenses, OSV) | Every PR lands on a green, verified main | ✅ restored (Aug 2026) |
| Public issue templates + labels (`good-first-issue`, `help-wanted`, `agent-integration`, `collaboration`, `quality`) | Community can find where to help | 🔜 planned |
| Contribution guide matching the real merge flow | First PR is a 10-minute experience, not a mystery | 🔜 planned |
| Hermes integration hardening (provider config, health checks, session continuity, error UX) | The agent brain "just works" on every machine | 🔄 health checks + session continuity shipped; error UX pending |
| Security posture documentation + dependency scanning in CI | Users and companies can trust the install | 🔜 planned |

**Exit criteria:** a new user goes from download to first agent-assisted
document in under 10 minutes; CI stays green ≥95% of days; ≥5 external
contributions merged.

### Track — Trusted Agent Actions

> **Outcome:** *The agent stops being a chat guest and becomes an auditable,
> approvable collaborator in every app — before any networked collaboration
> exists.*

| Initiative | Why (outcome) | Status |
|---|---|---|
| Unified trust model across apps | Every mutation becomes a visible, reversible proposal — the Sheets `propose_operations` gold standard extended to Docs, Slides and PDF through one `Proposed Change` contract (RFC #8) | 💡 design |
| Agent authorship | Accepted changes are signed in the OOXML (comment or revision) with agent identity + timestamp + reasoning — the audit base for Phase 3 | 💡 ideas |

**Exit criteria:** "rewrite section 3 with the data from the attached sheet"
produces a clean diff, the user accepts, and the change is recorded as
agent-authored — in Docs, Slides and PDF, not just Sheets.

---

## Next — Phase 2 · Value Loops

> **Outcome:** *A user goes from raw material (meeting audio, a report, a
> brief) to a complete deliverable (minutes, proposal, deck) in one session —
> with every agent change visible and reversible.*

Phase 2 reorders the original "Agent-Native Office" plan around **complete
vertical loops** instead of horizontal agent infrastructure. The test for
every initiative: *does the user close the loop in a single session?* If not,
it waits. Loop-first is also the business case: each loop is a retention
story the user feels daily.

| Initiative | Why (outcome) | Status |
|---|---|---|
| **Templates: "New from template…"** | Instant value on first open — board minutes, proposal, report, invoice; attacks the Phase 1 ten-minute exit criterion | 🔄 in progress (invoice generator, PR #48) |
| **Live meeting minutes** | The killer app for privacy-sensitive work: board-level, CISO-grade conversations never leave the machine; output is a real `.docx` (see spotlight below) | 💡 design — **keystone demo of the phase** |
| **Report → Deck (cross-generation)** | The highest-frequency professional task: numbers/report in, board-ready deck out — one pipeline across engines, not one giant prompt | 💡 design (pulled forward from Phase 4) |
| **Embedded MCP server per app — P0 keystone** | Expose the same tools as the AI panel (`read_blocks`, `replace_blocks`, `propose_operations`, slides/pdf tools) to any MCP agent — Hermes, Claude Code, whatever the community plugs in; every external mutation goes through the same proposed-change pipeline, gated by an approval policy for headless agents (approval-model RFC) | 💡 design — **the spine, built in parallel with the loops** |
| Unified Proposed Change (RFC #8) | Every mutation in Docs, Slides and PDF becomes a visible, reversible proposal — the Sheets gold standard, extended (spike validated on Slides) | 💡 design |
| **Document health check** | The agent cross-checks the document against its sources — *"these numbers don't match the attached sheet"* — always as a proposal, never a mutation; the trust win that sells the suite | 💡 ideas (new) |
| **Deliverable pack** | Export the finished artifact (minutes, deck, report) to PDF or zip with attachments, ready to send — the loop's closing step | 💡 ideas (new) |
| **Side-effect actions (light)** | The loop closes *after* the deliverable: create task, send follow-up, file to KB — with an explicit permission model | 💡 ideas |
| Full-document context | The agent reads the whole project (document + related files) via Hermes memory/RAG, not just the visible page | 💡 design — enablement for the loops |
| Project memory | Per-document conversation, decisions and state stored in Hermes sessions; resume from any machine | 🔄 in progress (session continuity shipped) |
| Project document graph | `project-store` becomes the agent-native typed layer: document properties, cross-document references, status — never inside the OOXML (byte-preserving); value compounds as templates grow | 💡 design |
| Artifact generation | The agent produces real files (tables, slides, briefs) into the project, editable by humans | 💡 ideas (subsumed by the loops) |
| Role-based agents per document | `@writer`, `@researcher`, `@reviewer`, `@data` — Hermes skills as office roles, invoked like teammates | 💡 ideas (late in phase) |
| Runtime plugin system | Evolve `AgentSkill` from compile-time to dynamic loading with a manifest and declared permissions (which tools, which scopes) | 💡 ideas (deferred) |

**Sequencing:** the phase opens with the cheapest loop (templates, already in
flight), then the keystone demo — *a 45-minute meeting ends with a complete,
local minutes document, decisions and action items with owners, captured
without note-taking* — then Report → Deck. The MCP server builds in parallel
as the spine: everything the agent does through the AI panel becomes doable
by any external agent, through the same trust pipeline. One demo that changes
minds beats nine features in parallel.

**Exit criteria:** a user can say *"prepare the Q3 board deck from these
numbers"* and review an agent-produced, fully editable deck; a 45-minute
meeting ends with complete local minutes; ≥70% of agent mutations accepted
vs reverted.

### Spotlight — Live meeting minutes (Granola-style, local-first)

> **Outcome:** *Enable users to turn any meeting running on their machine into
> a live, structured `.docx` minutes document — decisions, action items and
> owners captured as they happen — so nobody takes notes manually and
> follow-ups are never lost.*

The defining difference vs. cloud note-takers (Granola, Otter, Fireflies):
**nothing leaves your machine.** Board-level, CISO-grade conversations stay
local, and the output is a real `.docx` — not a proprietary format.

| Block | How |
|---|---|
| **System audio capture** | macOS: ScreenCaptureKit (macOS 13+, captures the meeting app's audio — Zoom/Meet/Teams — no loopback driver). Windows later: WASAPI loopback |
| **STT** | Hermes native STT (faster-whisper, `local` provider — already the Hermes default, no API key); `small`/`medium` model for meeting quality |
| **Streaming summarizer** | The Hermes agent ingests transcript chunks, holds meeting context (per-session memory), and emits incremental structured notes: participants, topics, **decisions, action items, owners, deadlines** — Granola-style template |
| **Live rendering** | The minutes docx is open in HermesOffice Docs; the existing byte-preserving paragraph-patch engine updates each section (Decisions, Action Items) incrementally — no full rewrites, no layout breakage |
| **Post-meeting** | The agent finalizes the minutes, then *acts*: creates follow-up tasks, files the summary into a knowledge base, drafts the follow-up email |

**Exit criteria:** a 45-minute meeting ends with a complete minutes document in
`.docx` — decisions and action items with owners — captured without manual
note-taking; summary sections land within ~30s of each topic.

---

## Later — Phase 3 · Human + Agent Collaboration (online)

> **Outcome:** *Enable teams of people and agents to work in the same project
> in real time, with Hermes as the collaboration server — so mixed human-agent
> teams ship documents faster without losing human control.*

This is the defining bet: collaboration without a proprietary cloud. **Hermes
runs the server** (identity, sessions, agents); HermesOffice clients sync.

| Initiative | Why (outcome) | Status |
|---|---|---|
| Shared projects | Invite people **and agents** to a project; Hermes gateway provides identity and sessions | 💡 design |
| Presence & activity | See who — human or agent — is working where, with auditable actions | 💡 ideas |
| Collaborative editing (staged) | (a) shared workspace with per-block locks, then (b) real-time co-editing (CRDT) layered on byte-preserving engines | 🔬 exploration |
| Agents as participants | `@agent` in a shared doc: the agent observes state and acts (edit, summarize, answer) — visible and auditable | 💡 ideas |
| Live meetings as collaborative projects | A meeting is the first shared project: humans *and* agents co-participate, the minutes docx is the shared artifact (Phase 2 spotlight) | 💡 design |
| Office as MCP tools | Hermes can work on documents from any channel (Telegram, CLI, web) — the office exposed as tools the agent already knows | 💡 ideas |

**Exit criteria:** two humans + two agents co-edit the same deck live, with a
full audit trail of who changed what.

---

## Future — Phase 4 · Open Platform

> **Outcome:** *Enable the community to extend the office with their own
> agents, engines and integrations — so the platform grows beyond what the
> core team ships.*

- Plugin/SDK surface for custom agents and document tools.
- Agent marketplace: skills and personas for office roles.
- RFC process for the collaboration protocol.
- **Living documents**: blocks linked to sources (a sheets table embedded in
  docs, a range feeding a chart in slides) with reactive recomputation.
- **Proactive agent with consent**: Hermes watches the document (opt-in) and
  suggests — "these numbers don't match the attached spreadsheet" — always as
  a proposal, never as a mutation. (Light version — *Document health check* —
  already scheduled in Phase 2.)
- Localization, accessibility, ecosystem integrations.

---

## Success metrics

Operational metrics that complement the per-phase exit criteria (all telemetry
is local-first, opt-in and aggregate-only):

| Phase | Metric |
|---|---|
| 1 | download → first agent-assisted document < 10 min; CI green ≥95% of days; ≥5 external PRs merged |
| Trusted Agent Actions | share of agent mutations accepted vs reverted (target ≥70% after the first iteration); time from opening a document to the first agent action |
| 2 | keystone demo ships (45-min meeting → complete local minutes docx); report → deck pipeline; time from raw material to deliverable < 30 min; loops completed per week; external MCP clients acting on real documents |
| 3 | two humans + two agents co-edit a deck live with a full audit trail |
| 4 | features shipped by the community, outside the core team |

---

## What we are deliberately NOT doing (yet)

- **Cloud lock-in** — no mandatory accounts; collaboration is self-hosted via Hermes.
- **Proprietary formats** — OOXML round-trip fidelity is non-negotiable.
- **Replacing Hermes** — the office is a surface; Hermes remains the open, local brain.

---

## How the community can help

### Areas & labels

| Label | Best for |
|---|---|
| `good-first-issue` | Small, well-scoped: engine/UI bugs, tests, fixtures |
| `help-wanted` | Bigger features, owner welcome |
| `agent-integration` | Hermes ↔ office plumbing (providers, sessions, MCP, actions) |
| `collaboration` | Collab protocol design — **design discussions are welcome early** |
| `quality` | Tests, fuzzing, docs, tooling |

### Ways to contribute

1. **Fix an issue** — pick a `good-first-issue` and open a PR (see [CONTRIBUTING.md](CONTRIBUTING.md)).
2. **Review** — comment on open PRs; a second pair of eyes is gold.
3. **Design** — join `collaboration` RFCs before code exists.
4. **Reproduce** — file bugs with fixtures; every repro moves us forward.
5. **Test** — run nightly builds and report breakage.
6. **Translate** — the suite speaks many languages; help keep it that way.

### Good starting points

- `docs/hermes-integration.md` — how the Hermes brain plugs into the apps.
- `packages/agent-core` — the agent loop shared by all apps.
- `packages/docx-engine` — byte-preserving paragraph patch.
- `apps/sheets/native/xlsx-engine` — Rust sidecar (calamine + IronCalc).

### Where your profile fits

| Profile | Where to start |
|---|---|
| First PR | Mapped TODOs (slicers, pivot, z-order, IME), `agent-core` tests, good first issues |
| TypeScript/React | Proposed-change unification, PDF trust UX, agent actions |
| Agent enthusiasts | Embedded MCP server, Hermes skills, runtime plugins |
| Rust | xlsx sidecar (external pivots, performance) |
| Distributed systems | CRDT layer RFC (Phase 3) — open a design issue before writing code |
| Docs/i18n | Hermes gateway setup guides, translations in `packages/i18n` |

---

*Roadmap is a direction, not a promise — items move between phases as we learn.
Questions? Open an issue with the `collaboration` or `help-wanted` label.*
