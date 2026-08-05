---
name: hermesoffice-decks
description: Produce presentations in HermesOffice Slides — the plan_deck/generate_deck pipeline, native element editing, and the templates/decks style specs (modern, elegant, professional, keynote-speaker, minimal, tech-dark, investor-pitch, workshop). Load for any request that creates or restyles a deck.
---

# Producing decks

## New decks: always through the generation pipeline

For blank/from-scratch decks do **not** hand-assemble pages element by
element — use the pipeline:

1. If the brief is vague, `ask_clarification` (audience, goal, tone) or
   decide with professional judgment.
2. Pick a style spec from `templates/decks/` and read it:

   | Spec                 | Character                                  |
   | -------------------- | ------------------------------------------ |
   | `modern.md`          | Bold, asymmetric, one idea per slide       |
   | `elegant.md`         | Editorial serif, muted luxury              |
   | `professional.md`    | Corporate reviews/QBRs, agenda + summary   |
   | `keynote-speaker.md` | Stage deck: huge type, dark, no bullets    |
   | `minimal.md`         | Monochrome, typographic, zero decoration   |
   | `tech-dark.md`       | Developer product: dark UI, code cards     |
   | `investor-pitch.md`  | Fundraising: traction-first, ≤12 slides    |
   | `workshop.md`        | Interactive session: exercises + timeboxes |

3. `plan_deck` with a `core_hook`, the spec's **Style** section as `style`,
   and the user's content mapped onto the spec's suggested page plan.
4. `generate_deck` once, passing all planned pages; follow the
   `<generation-progress>` notes until every page is done.

## Refining an existing deck (native tools)

When the deck already has real content, refine with the element tools:
`read_slide` for fresh ids, then `set_element_text/style/transform/fill/
stroke`, `edit_table_*`, `edit_chart`, `set_slide_background`. For
multi-element layout changes use `execute_slide_script` (atomic, reads real
geometry) and heed the layout-audit warnings it returns.

## Data discipline

Charts require a declared `dataSource` (`user` / `document` / `search` /
`sample`). `search` requires an actual `web_search` in this conversation;
`sample` data must be explicitly flagged to the user as illustrative.
