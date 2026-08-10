# Contributing to HermesOffice

Thanks for your interest in contributing. This document covers the local
setup, the checks a change must pass, and the conventions used in this
repository.

## How changes land here

`main` is the trunk: every change ships as a reviewed, **squash-merged** pull
request (the merge commit carries the full PR description). Maintainers sync
with the [upstream HermesOffice](https://github.com/genspark-ai/hermesoffice) tree
periodically — engines and app shells follow upstream, so please focus
contributions on the fork's own layer (Hermes integration, agent features,
collaboration, product polish) and on bug fixes to engines.

External pull requests are welcome and reviewed here. The CI gate
(format, lint, typecheck, tests, licenses) must pass — if your PR is against a
red `main`, the gate still runs on your branch, so keep it green locally
(see [Checks every change must pass](#checks-every-change-must-pass)). Issues
and feature requests are handled directly on this repository as usual.

New here? The [public roadmap](ROADMAP.md) lists where the product is going,
and issues labeled `good first issue` are small, well-scoped entry points.

## Repository layout

- `apps/*` — the six Electron apps (docs, sheets, slides, pdf, markdown, shell).
  Each app is an npm workspace with its own `src/main` (Electron main
  process), `src/renderer` (React UI), and `tests/`.
- `packages/*` — pure TypeScript engine and shared packages (no Electron
  dependency, unit-tested): docx/pptx engines, AI agent core, providers,
  i18n, UI kit.
- `apps/sheets/native/xlsx-engine` — Rust xlsx engine (runs as a sidecar process) for xlsx import/export.

## Getting started

Prerequisites: Node 22+, npm 10+, and a Rust toolchain (`cargo` on PATH,
needed only for the sheets xlsx sidecar).

```bash
npm install
npm run fixtures     # generate test .docx fixtures (one-time, and after docx-engine changes)
npm run dev          # all editors + shell against Vite dev servers
npm run dev:docs     # or run a single app
```

## Checks every change must pass

CI runs these on every PR; please run them locally first:

```bash
npm run format:check # Prettier check for uncommitted changed/new files
npm run lint         # ESLint across the repo (0 errors required; warnings allowed)
npm run typecheck    # tsc --noEmit across every workspace
npm test             # engine + app unit tests (also runs the Rust sidecar tests)
npm run licenses     # production dependency licenses within the permissive allowlist
```

Formatting is intentionally incremental: existing files are not reformatted
unless they are part of your change. Run these exact commands before committing:

```bash
npm run format                              # format uncommitted changed/new files
npm run format:check                        # verify uncommitted changed/new files
npm run format:check -- --base origin/main  # verify committed files on your branch
```

CI supplies the PR or push base automatically and checks only files changed from
that base. This keeps the formatter gate useful without creating a repository-wide
formatting diff.

## Pre-PR testing rules

These are the rules for opening a PR, not suggestions. CI enforces the
baseline, but bugs that reach `main` ship to users through the auto-updater
within hours — the gate lives on your machine first.

1. **Run the whole gate with one command** before opening (or updating) a PR:

   ```bash
   npm run preflight   # format:check vs origin/main + lint + typecheck + npm test
   ```

   Optionally install it as a pre-push hook so a failing branch never leaves
   your machine (`git push --no-verify` bypasses it in an emergency):

   ```bash
   npm run hooks
   ```

2. **Every behavior change ships with a test that fails without it.** Bug
   fixes include a regression test reproducing the bug; new tools/IPC come
   with contract tests next to the existing suites. "Tested manually" is not
   a substitute for code the CI can rerun.

3. **High-risk areas have extra obligations** (mirrored as checkboxes in the
   PR template):
   - _Updater/installer_: `node --check` on touched scripts, the atomic
     verify → copy-aside → rename-swap → rollback sequence preserved, and
     never swapping with the app process alive. Describe your manual dry-run
     in the PR — this code cannot be fully exercised by CI, and both field
     incidents so far came from it.
   - _i18n_: new keys go into **all 19 locales** of the touched dictionary in
     the same commit; there is no runtime fallback.
   - _IPC/preload_: shared types, channel constants and preload bridges
     change together; renderer input is validated in the main process.
   - _Engines (open/save)_: round-trip fidelity test proving untouched
     content survives byte-for-byte.
   - _Renderer flows_: update or add the Playwright spec in `e2e/` covering
     the flow you touched.

4. **Don't weaken the gate to pass it.** Skipping tests, loosening types or
   disabling lint rules to get green requires an explicit callout in the PR
   summary and reviewer sign-off.

5. **If CI is red on your PR, it is yours to fix** — push the fix or comment
   what is blocking; never merge on red or rely on someone else noticing.

## Building installers

Run these from the repository root — they regenerate the third-party
notices and build all six apps before packaging:

```bash
npm run dist:mac   # dmg + zip
npm run dist:win   # nsis installer
```

Without Apple or Windows signing credentials in the environment these produce
unsigned artifacts: code signing and notarization are skipped with a warning
rather than failing. That is the expected result for a contributor build.

`dist:win` additionally expects the xlsx sidecar at the MinGW cross-compilation
path. Building on Windows leaves it under the MSVC target instead, so stage it
first:

```bash
cargo build --release --target x86_64-pc-windows-gnu   # from apps/sheets/native/xlsx-engine
```

or copy an existing `target/release/xlsx-sidecar.exe` to
`target/x86_64-pc-windows-gnu/release/`.

## Environment variables

None are required — the apps run with all of these unset. They exist for
testing and local overrides:

| Variable                                                    | Effect                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `HERMESOFFICE_USER_DATA`                                    | Override the Electron userData directory (test isolation)              |
| `HERMESOFFICE_LANG`                                         | Force the UI language instead of following the OS locale               |
| `HERMESOFFICE_FAKE_UPDATE`                                  | Exercise the updater UI without a real release feed                    |
| `HERMESOFFICE_CLOUD_SLIDE`, `HERMESOFFICE_CLOUD_SLIDE_TIER` | Route slide generation through the cloud endpoint                      |
| `GSK_API_KEY`, `GSK_CLI_PATH`                               | Genspark credentials / CLI location for the built-in AI provider       |
| `AI_SEARCH_DISABLE_GSK`, `SERPER_API_KEY`                   | Disable the gsk search backend / supply a Serper key instead           |
| `XLSX_SIDECAR_PATH`, `XLSX_OPEN_PATH`, `XLSX_DEBUG_PORT`    | Point at a locally built xlsx sidecar and its debug port               |
| `*_DEV_PORT`, `*_RENDERER_URL`                              | Per-app Vite dev server ports and renderer URLs (set by `npm run dev`) |

AI features degrade rather than break without credentials: requests surface an
inline sign-in prompt, and web search falls back to a keyless backend.

## Coding conventions

- **English only** in code, comments, commit messages, and docs. User-facing
  strings go through the i18n resources (`src/renderer/i18n/`, plus the inline
  main-process dictionaries in `src/main/`), which are the only places
  non-English text belongs (plus test fixture text).
- TypeScript everywhere; avoid adding new `any` surfaces where a precise type
  is cheap.
- Tests live in `apps/*/tests` and `packages/*/tests` (vitest). New engine
  behavior needs a unit test; renderer-only UI tweaks generally don't.
- Local Playwright/Electron acceptance drivers belong in `scripts/drivers/`
  (gitignored, excluded from CI) — see `scripts/drivers/README.md`.
- The Word-fidelity scripts (`scripts/docs-word-fidelity.mjs`,
  `scripts/pagination-baseline-word.mjs`) need macOS with Microsoft Word
  installed and AppleScript automation permission granted; they are optional
  local tools and never run in CI.
- Keep files from growing without bound: if you are adding a substantial new
  concern to an already-large file, prefer a new module.

## Commit and PR guidelines

- Small, focused commits with imperative English subject lines
  (e.g. `fix docx table border round-trip`, `add slides chart legend parsing`).
- A PR should explain _why_ the change is needed, and mention which of the
  checks above you ran.
- File format fidelity is the core product promise: for changes touching
  open/save paths (docx/xlsx/pptx), include a round-trip test proving
  untouched content survives byte-for-byte.

## Reporting bugs and requesting features

Use the issue templates. For suspected security issues, do **not** open a
public issue — follow [SECURITY.md](SECURITY.md).

## Code of conduct

All community spaces follow the
[Contributor Covenant](CODE_OF_CONDUCT.md); participation implies acceptance.

## License and CLA

There is no CLA (contributor license agreement), and we do not plan to add
one. By contributing, you agree that your contributions are licensed under
the [Apache License 2.0](LICENSE) that covers this project — inbound =
outbound, per Apache-2.0 §5. Because community contributions keep their
Apache-2.0 terms, the open-source core cannot be retroactively relicensed.

The `ee/` directory is reserved for future enterprise modules under a
[separate license](ee/LICENSE) and does not accept external contributions —
pull requests from outside the maintainer team must not modify files under
`ee/` (enforced via [CODEOWNERS](.github/CODEOWNERS)).
