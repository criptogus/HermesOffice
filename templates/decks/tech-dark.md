<!--
HermesOffice deck template — consumed by AI agents (Hermes).
Usage: read this file, then call plan_deck/generate_deck in HermesOffice Slides
passing the Style section verbatim as the `style` argument and adapting the
Suggested page plan to the user's actual content. Do not present sample
figures as real data (declare dataSource accordingly).
-->

# Tech Dark deck template

Developer-product look: dark UI, code-friendly, precise.

## Style

- Palette: #0F172A background, #E2E8F0 text, #38BDF8 accent, #1E293B card surfaces with 12px radius.
- Typography: sans for prose, monospace for anything technical (commands, APIs, metrics); code blocks styled as terminal cards.
- Layout: card grid (2×2 or 3×1) for feature slides; architecture diagrams as simple labeled boxes and arrows, never clip-art.
- Charts: dark-theme, accent-colored series, thin white gridlines at 10% opacity.
- Content: concrete beats abstract — show the command, the latency number, the diff.

## Suggested page plan

1. Cover — product + version tag
2. The pain (developer story)
3. Architecture at a glance
4. Feature cards (2×2)
5. Benchmark chart
6. Getting started (terminal card)
7. Roadmap & links

## Agent notes

- Keep the page count close to the plan; merge or split pages based on the user's actual content, never to pad.
- Follow the deck-wide palette and typography exactly; consistency beats variety.
- Figures require a declared dataSource ('user' / 'document' / 'search' / 'sample'); sample data must be flagged to the user.
