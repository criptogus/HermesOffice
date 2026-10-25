# PR 67 reconciliation

Baseline: HermesOffice main `a4f2c5bc`; upstream proposal `77ae666e`.
The merge retains both histories and combines the engine/editor migration with the HermesOffice integration layer.

Accepted: upstream DOCX/PPTX/XLSX parsing and rendering changes, HTML editor, CLI/MCP tooling, document-control APIs and their tests. Restored fork fidelity tools remain available.

Preserved: HermesOffice application identity, gateway startup and health/login behavior, provider defaults, MiniMax Flash settings, source updater and Windows npm handling. Genspark remains the name of the actual external services. Original copyright attribution and file-format metadata markers remain intact. The bundled CLI and launchers use HermesOffice and do not overwrite foreign launchers.

Document AI sessions remain stable through renderer resolution, strict IPC validation, agent turns, compaction and the provider HTTP header. The initial send waits for document identity; cancellation while waiting does not send a request. HTML and Markdown use the same document identity contract. Regression tests cover transport-to-HTTP forwarding, distinct documents, fallback identity and deferred first-send behavior.

Additional integration fixes: namespaced Docs/Slides media handlers, HTML toolbar stacking, manual update transport routing, correct Linux launcher ownership, platform-aware macOS clipboard shortcuts and HermesOffice save paths in E2E tests. Optional Office cloud-font assertions require the actual family to be installed.

The repository's existing upstream-diff script now accepts explicit candidate/base refs and an optional JSON report, identifies fork-sensitive paths, and rejects empty comparisons. It was run against this migration and against an empty comparison; the latter failed as required. Jev provided advisory conflict-policy classification using minimal evidence (`jev-1.14.0`, 3,244 input / 45 output tokens); code inspection and tests determined the implementation.

Validation results are recorded in the PR description after the final run. No release or installation is part of this PR reconciliation. Windows/Linux runtime behavior requires their CI/platform checks; local runtime checks use macOS and isolated app data without paid inference.
