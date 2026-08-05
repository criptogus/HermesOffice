# HermesOffice

AI-native office suite for macOS and Windows: word processor, spreadsheet,
presentations and PDF — five Electron apps sharing one engine layer, built
around AI editing as a first-class flow, not an attached chat.

> **Fork of [genspark-ai/genoffice](https://github.com/genspark-ai/genoffice)**
> (Apache-2.0). This is a *thin fork*: engine and app code follows upstream,
> with its own layer of identity and **Hermes Agent** (Nous Research)
> integration as the native AI.

## Download

Signed fork releases will be published here (in progress — use the
[GenOffice upstream](https://github.com/genspark-ai/genoffice/releases) or
build locally with `npm run dist:mac`).

## Roadmap

Where the product is going — and how the community can help:
**[ROADMAP.md](ROADMAP.md)** (vision, phases, initiatives, contribution areas).

## Apps

| App            | Product              | What it is                                                                                                                                                                                                                                                                                                                              |
| -------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/docs`    | **HermesOffice Docs**  | `.docx` processor. Byte-preserving round-trip: only "dirty" paragraphs are regenerated (paragraph patch); everything else in the original file stays byte-for-byte, so open/save never breaks Word layout. Paginated view whose line metrics reproduce the original layout, tracked changes, comments, styles, equations, ink.                |
| `apps/sheets`  | **HermesOffice Sheets** | `.xlsx` spreadsheet. UI over the open-source [Univer](https://github.com/dream-num/univer) core (Apache-2.0) with an extensive custom extension layer; xlsx import/export via a Rust sidecar (calamine + IronCalc), in-house charts (Konva), pivot tables, slicers, conditional formatting and formula tracing.                              |
| `apps/slides`  | **HermesOffice Slides** | `.pptx` presentations. In-house pptx parse/render/edit engine with masters, charts, crop, ink and text shaping (HarfBuzz metrics).                                                                                                                                                                                                        |
| `apps/pdf`     | **HermesOffice PDF**   | PDF viewer/editor on pdf.js + pdf-lib: annotations, forms, outlines, stamps, signatures, page operations, printing.                                                                                                                                                                                                                        |
| `apps/shell`   | **HermesOffice**       | The suite shell: home screen, tab hosting of the four editors, auto-update.                                                                                                                                                                                                                                                               |

Every app embeds the same AI panel: block-granularity AI editing with
snapshots and diffs in docs; an agent with tool-calling over the
spreadsheet/slides/PDF state in the others.

**Native AI (Hermes).** In this fork the default provider is the **Hermes
Agent** — the Hermes gateway exposes an OpenAI-compatible endpoint
(`http://127.0.0.1:8642/v1`) that runs the full agent (memory, skills, tools,
MCP). No Genspark account, no third-party proxy: 100% local.
*(Integration under development — see `docs/hermes-integration.md`.)*

## Engine packages

Pure TypeScript, no Electron dependency, unit-tested (except the UI kit):

- `packages/docx-engine` — docx parse → block tree (with `docxIndex` anchors and passthrough), OOXML fragment generation, byte-level paragraph patching.
- `packages/pptx-engine` / `packages/pptx-render` — pptx model and rendering.
- `packages/file-parse` — text extraction for AI attachments (office and text formats).
- `packages/agent-core` — the agent loop and skill composition shared by all apps.
- `packages/ai-provider` — provider abstraction and streaming for model backends.
- `packages/ai-search` — Genspark auth + web/image search tools (kept from upstream; the fork does not depend on it).
- `packages/i18n`, `packages/ui`, `packages/project-store`, `packages/electron-utils` — shared i18n, React UI kit, recent-files store and main-process helpers.

## Development

```bash
npm install
npm run fixtures     # generate .docx test fixtures
npm test             # engine + app unit tests (docs/sheets/slides headless)
npm run typecheck    # tsc --noEmit across all workspaces
npm run dev          # all editors + shell against Vite dev servers
npm run dev:docs     # single app (same pattern per workspace)
npm run dist:mac     # package macOS dmg (regenerates third-party notices)
npm run dist:win     # package Windows nsis installer
```

The sheets app additionally needs a Rust toolchain for the xlsx sidecar
(`cargo` on PATH); `npm run build -w @hermesoffice/sheets` compiles it
automatically.

### Syncing with upstream

```bash
git fetch upstream
git merge upstream/main        # resolve conflicts in the fork layer (rebrand/integration)
python3 tools/rebrand-hermesoffice.py   # ensure no "genoffice" leaked back
npm install && npm run typecheck
```

## Architecture (docx round trip)

```
open docx ─► archive original by hash (never touched)
          ─► docx-engine parses top-level elements of word/document.xml (w:p / w:tbl / …)
          ─► block tree, each block anchored by docxIndex + original XML slice
          ─► TipTap streaming editor (manual + AI editing, dirty tracking)
save      ─► dirty blocks → OOXML fragments (referencing only existing styles)
          ─► splice into the original document.xml (untouched blocks keep original bytes)
          ─► rezip; all other entries copied byte-for-byte
```

The same philosophy applies to sheets and slides: the original file is the
source of truth, edits are narrow patches, and everything the editor did not
touch survives the round trip intact.

## Security

See [SECURITY.md](SECURITY.md) for the process security posture (renderer
sandboxing, IPC validation, external-link gating) and threat models for
AI-generated content.

## Third-party notices

`npm run notices` regenerates the third-party license summary
(`tools/gen-third-party-notices.mjs`); all runtime dependencies are
MIT/Apache-2.0/OFL, and the bundled fonts (Liberation, Carlito, Caladea, Noto
CJK subsets) are OFL/Apache.

## Community

- **Roadmap & how to help**: [ROADMAP.md](ROADMAP.md) — good first issues are
  labeled `good first issue` in the [issues tab](https://github.com/criptogus/HermesOffice/issues).
- **Kanban**: [HermesOffice Roadmap project](https://github.com/users/criptogus/projects/1)
  — phases and work-in-progress at a glance.
- **Maintainer**: [Gustavo Caetano](https://x.com/gustavocaetano) — reach out
  on X/Twitter ([@gustavocaetano](https://x.com/gustavocaetano)) for product
  direction, partnerships or just to talk agents-in-the-office.

## License

HermesOffice is licensed under the [Apache License 2.0](LICENSE), with one
exception: the `ee/` directory is reserved for future enterprise modules and
is covered by the [HermesOffice Enterprise License](ee/LICENSE).

**Attribution**: this project is a fork of
[genspark-ai/genoffice](https://github.com/genspark-ai/genoffice) (Apache-2.0,
Copyright Mainfunc, Inc.), keeping the original [NOTICE](NOTICE). The
HermesOffice and Genspark names and logos are trademarks of Mainfunc, Inc. and
are not used by this fork — which adopts its own branding, per the license.
