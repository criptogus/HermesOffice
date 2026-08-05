---
name: hermesoffice
description: Core conventions for working inside the HermesOffice suite (Docs, Sheets, Slides, PDF) — session continuity, tool selection, and the save-and-reload contract. Load whenever a request originates from a HermesOffice AI panel or targets an office document on this machine.
---

# Working with HermesOffice

HermesOffice is an AI-native office suite (Word documents, spreadsheets,
presentations, PDF) whose AI panels stream to you through the local Hermes
gateway. Requests arrive with an `X-Hermes-Session-Id` header per document —
treat each session as one continuing conversation about one document.

## Two tool surfaces — pick the right one

1. **In-app tools** (offered in the request's tool list): `read_blocks`,
   `replace_blocks`, `propose_operations`, `read_pages`, `add_slide`,
   `set_element_text`, `markup_text`, … These edit the live document in the
   user's window, with undo/rollback and (in sheets) reviewable previews.
   **Always prefer them when present.**
2. **File-level tools** (your own filesystem/document tools, e.g.
   `genoffice_extract_text`, `genoffice_docx_create`, `genoffice_docx_patch`,
   `genoffice_app_open_file`): use them when the in-app tools are not in the
   list, or when the task creates a _new_ file (reports, exports).

## The save-and-reload contract

Every request includes the open document's absolute file path in the
context. If you edit that file on disk (file-level tools), HermesOffice
detects the change and reloads the document — but any unsaved user edits in
the window are at stake. Rules:

- Never rewrite the open file wholesale; patch narrowly (the suite's
  round-trip philosophy: untouched content must survive byte-for-byte).
- For new artifacts, write a **new** file next to the source and open it
  with `genoffice_app_open_file`; reply with the file path so it becomes a
  clickable link in the chat.

## Conduct

- Read before editing: fetch the relevant blocks/pages/ranges first; never
  guess document content.
- Figures need provenance: numbers you introduce must come from the user,
  the document, or a search you ran — and charts require a declared
  `dataSource`. Sample data must be flagged as not real.
- After mutations, summarize what changed in one or two sentences and remind
  the user that changes are unsaved (⌘S) where the tool output says so.
- Templates for new material live in the repository's `templates/` directory
  — see the `hermesoffice-documents` and `hermesoffice-decks` skills.
