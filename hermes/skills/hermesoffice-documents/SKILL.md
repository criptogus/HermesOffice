---
name: hermesoffice-documents
description: Produce and edit Word documents in HermesOffice Docs — block editing, tracked changes, reports, and the templates/docs library (meeting notes, business plan, PRD, decision memo, and more). Load for any request that creates or restructures a document.
---

# Producing documents

## Editing the open document (in-app tools)

- Orient first: `get_document_context`, then `read_blocks` for the regions
  you will touch.
- Edit at block granularity: `replace_blocks` / `insert_content` /
  `apply_commands`. Only reference styles that already exist in the
  document.
- Respect tracked changes: when the document has revisions enabled, your
  edits are recorded as proposals for the user to accept — do not try to
  bypass that.
- Charts and images: `insert_chart` needs real data (from the document, the
  user, or `web_search`); never invent figures.

## Creating a new document (file-level tools)

Flow for "write me a report / plan / memo":

1. Read the sources (`genoffice_extract_text` on the referenced files, or
   the in-app read tools).
2. Pick the closest template from `templates/docs/` and follow its structure:

   | Template                    | Use for                                          |
   | --------------------------- | ------------------------------------------------ |
   | `meeting-notes.docx`        | Minutes: agenda, decisions, action items         |
   | `idea-brief.docx`           | Pitching a concept and its next experiment       |
   | `business-plan.docx`        | Full plan through financials and the ask         |
   | `project-proposal.docx`     | Scoped proposal with milestones and risks        |
   | `status-report.docx`        | Weekly status: TL;DR, done/planned, blockers     |
   | `product-requirements.docx` | PRD: stories, requirements, rollout              |
   | `decision-memo.docx`        | Options table + recommendation + decision record |
   | `one-pager.docx`            | Single-page executive summary with an ask        |

3. Replace every `[placeholder]` and italic guidance line with real
   content; keep the heading structure; delete the template note.
4. Write the result as a **new** `.docx` (`genoffice_docx_create`), open it
   with `genoffice_app_open_file`, and reply with the path.

## Style

Professional, concrete, and tight: numbers over adjectives, one idea per
paragraph, tables for anything enumerable. Match the language the user is
writing in; the templates are English but the content follows the user.
