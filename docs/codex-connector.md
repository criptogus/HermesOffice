# Codex connector

Select **Codex** in Settings → AI, test the connection, and save before opening a
Docs document. Hermes remains the default backend for existing installations;
choosing Codex does not require a Hermes gateway or a Genspark login.

The connector uses the authenticated local Codex CLI's `app-server` over stdio.
Sign in with `codex login` through the supported Codex flow before connecting.
Account access, available models and usage limits come from that Codex account.
The model list is read from the runtime. No API key is required in HermesOffice
for this connector.

Leave the executable path empty for automatic discovery. Discovery checks the
Windows managed installation, PATH/common binary directories, and on macOS the
Codex/ChatGPT application bundles under `/Applications` and `~/Applications`.
An explicit absolute path must exist; an invalid path reports a Codex error
instead of silently switching backends. If you change settings while a document
is already open, reopen that document to load the saved backend configuration.

## Sessions and history

HermesOffice stores user and assistant messages immediately in its project-store
JSONL files, including the first user message when the backend fails. Each
saved document has its own stable chat ID. Within a running app the Codex adapter
maps that ID to an independent ephemeral Codex thread. It never uses a single
global thread for different documents.

After a full app restart the saved document transcript is restored before the
first follow-up request. A fresh native Codex thread receives that transcript;
logical conversation continuity uses replay, not persistent native Codex thread
IDs. Existing history limits and compaction still apply. Saved message metadata
remains visible, but historical attachment bytes and complete tool transcripts
are not automatically reattached to the model when reopening a document.

## Document tools and permissions

Codex returns structured HermesOffice tool requests. The existing editor agent
executes them, including its normal undo/rollback flow. Native Codex shell,
filesystem, browsing and MCP tools are forbidden by the backend instructions;
server-side requests for approval or unsupported tools are rejected.

A named `hermesoffice` permission profile limits filesystem reads to minimal
runtime paths and the connector's private temporary directory. Connection fails
if the runtime cannot activate that profile; there is no fallback to a broader
filesystem sandbox. Update Codex if the permission-profile error is displayed.

## Validation scope

The initial live validation targets **Docs on macOS arm64** using the installed
Codex CLI. Other editors share provider selection and immediate history storage,
but are not advertised as live-tested Codex integrations by this change.
Automated regression coverage includes CLI discovery, permission-profile
activation, transport/session routing, cancellation, failed opening-message
persistence, and history restoration before a fast first follow-up.

The measured macOS run used `codex-cli 0.164.0-alpha.11.1` (seven available
models). Two Docs conversations returned their own chat-only markers before and
after a complete process restart, with stable distinct chat IDs and visible
restored history. A controlled paragraph insertion and the editor's rollback
button both passed. This does not establish compatibility with every Codex build;
permission-profile activation is checked at runtime.

Reproduce the deterministic regression without model access:

```sh
npm run build:all
npm run test:e2e -- e2e/codex-history.spec.ts
```

The live test is skipped by default because it consumes the signed-in Codex
account's usage. Explicitly opt in; it creates only synthetic documents and an
isolated Office profile, then closes its own processes:

```sh
HERMESOFFICE_CODEX_LIVE=1 \
HERMESOFFICE_TEST_EXECUTABLE=/Applications/HermesOffice.app/Contents/MacOS/HermesOffice \
HERMESOFFICE_CODEX_REPORT=/tmp/codex-live-result.json \
npm run test:e2e -- e2e/codex-live.spec.ts
```

Omit `HERMESOFFICE_TEST_EXECUTABLE` to test the built development shell. Optional
`HERMESOFFICE_CODEX_CLI` selects a specific runtime. The JSON report records
observed replies, process IDs, document chat IDs and the tested app version.
