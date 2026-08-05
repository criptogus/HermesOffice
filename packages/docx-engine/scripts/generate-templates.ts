/**
 * Generates the English document templates shipped in templates/docs/.
 * Run with: npm run templates -w @hermesoffice/docx-engine
 *
 * The templates are written for AI agents (Hermes) as much as for humans:
 * every section carries a one-line italic guidance note the agent replaces
 * with real content, and placeholders use [brackets].
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDocx } from '../tests/helpers/build-docx'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../../../templates/docs')

const esc = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const h1 = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
const h2 = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
const note = (text: string) =>
  `<w:p><w:r><w:rPr><w:i/><w:color w:val="7F7F7F"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
const bullet = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
const numbered = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`

/** simple full-width table: first row bold */
function table(rows: string[][]): string {
  const cell = (text: string, bold: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p></w:tc>`
  const tr = (cells: string[], bold: boolean) =>
    `<w:tr>${cells.map((c) => cell(c, bold)).join('')}</w:tr>`
  const borders =
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((s) => `<w:${s} w:val="single" w:sz="4" w:color="D0D0D0"/>`)
      .join('') +
    '</w:tblBorders>'
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${borders}</w:tblPr>` +
    rows.map((r, i) => tr(r, i === 0)).join('') +
    '</w:tbl>'
  )
}

interface Template {
  file: string
  body: string
}

const AGENT_PREAMBLE =
  'Template note for AI agents: replace every [placeholder] and italic guidance line with real content, keep the heading structure, and delete this note before delivering.'

const TEMPLATES: Template[] = [
  {
    file: 'meeting-notes.docx',
    body: [
      h1('Meeting Notes — [Topic]'),
      note(AGENT_PREAMBLE),
      p('Date: [YYYY-MM-DD]    Time: [HH:MM–HH:MM]    Location: [Room / Link]'),
      p('Attendees: [Names]    Facilitator: [Name]    Note taker: [Name or agent]'),
      h2('Agenda'),
      numbered('[Agenda item 1]'),
      numbered('[Agenda item 2]'),
      h2('Discussion'),
      note(
        'Summarize each agenda item in 2–4 sentences: what was discussed, positions taken, data cited.',
      ),
      p('[Discussion summary]'),
      h2('Decisions'),
      bullet('[Decision — include who decided and the rationale]'),
      h2('Action Items'),
      table([
        ['Action', 'Owner', 'Due date', 'Status'],
        ['[Action item]', '[Name]', '[Date]', 'Open'],
      ]),
      h2('Next Meeting'),
      p('[Date, time and proposed agenda]'),
    ].join(''),
  },
  {
    file: 'idea-brief.docx',
    body: [
      h1('Idea Brief — [Idea name]'),
      note(AGENT_PREAMBLE),
      h2('The Idea in One Sentence'),
      p('[One sentence a stranger would understand]'),
      h2('Problem'),
      note('Who has the problem, how painful it is, and how it is solved today.'),
      p('[Problem statement]'),
      h2('Proposed Solution'),
      p('[What we would build or do, and why it beats the status quo]'),
      h2('Who Benefits'),
      bullet('[Audience / customer segment and the value they get]'),
      h2('Why Now'),
      p('[Trend, technology, or event that makes this timely]'),
      h2('Risks & Open Questions'),
      bullet('[Biggest risk or unknown]'),
      h2('Next Step'),
      p('[The single cheapest experiment that would validate or kill this idea]'),
    ].join(''),
  },
  {
    file: 'business-plan.docx',
    body: [
      h1('Business Plan — [Company / Product]'),
      note(AGENT_PREAMBLE),
      h2('Executive Summary'),
      note('Write this last: mission, product, market size, traction, ask — half a page maximum.'),
      p('[Executive summary]'),
      h2('Problem & Opportunity'),
      p('[The problem, who has it, and the size of the opportunity (TAM/SAM/SOM with sources)]'),
      h2('Product & Value Proposition'),
      p('[What the product does and the measurable value it delivers]'),
      h2('Market & Competition'),
      table([
        ['Competitor', 'Strengths', 'Weaknesses', 'Our edge'],
        ['[Name]', '[…]', '[…]', '[…]'],
      ]),
      h2('Business Model'),
      p('[How money is made: pricing, unit economics, LTV/CAC assumptions]'),
      h2('Go-to-Market'),
      p('[Channels, first 100 customers, partnerships]'),
      h2('Team'),
      p('[Founders and key hires, with the one credential that matters for each]'),
      h2('Financial Projections'),
      table([
        ['Metric', 'Year 1', 'Year 2', 'Year 3'],
        ['Revenue', '[…]', '[…]', '[…]'],
        ['Costs', '[…]', '[…]', '[…]'],
        ['Net', '[…]', '[…]', '[…]'],
      ]),
      h2('The Ask'),
      p('[Funding sought, use of funds, milestones it buys]'),
    ].join(''),
  },
  {
    file: 'project-proposal.docx',
    body: [
      h1('Project Proposal — [Project name]'),
      note(AGENT_PREAMBLE),
      p('Author: [Name]    Date: [YYYY-MM-DD]    Sponsor: [Name]'),
      h2('Summary'),
      p('[Three sentences: what, why, and what it costs]'),
      h2('Goals & Success Metrics'),
      table([
        ['Goal', 'Metric', 'Target'],
        ['[Goal]', '[How it is measured]', '[Number and date]'],
      ]),
      h2('Scope'),
      bullet('In scope: [item]'),
      bullet('Out of scope: [item — being explicit here prevents scope creep]'),
      h2('Approach & Milestones'),
      table([
        ['Milestone', 'Deliverable', 'Date'],
        ['[M1]', '[…]', '[…]'],
      ]),
      h2('Resources & Budget'),
      p('[People, tools, and money required]'),
      h2('Risks & Mitigations'),
      table([
        ['Risk', 'Likelihood', 'Impact', 'Mitigation'],
        ['[Risk]', 'Low/Med/High', 'Low/Med/High', '[Plan]'],
      ]),
    ].join(''),
  },
  {
    file: 'status-report.docx',
    body: [
      h1('Status Report — [Project] — Week of [Date]'),
      note(AGENT_PREAMBLE),
      h2('TL;DR'),
      note(
        'One paragraph a busy executive can read in 20 seconds: overall health, the one thing that matters, the one thing you need.',
      ),
      p('Overall status: [On track / At risk / Off track] — [one-sentence reason]'),
      h2('Done This Week'),
      bullet('[Shipped or completed item, with a link or number]'),
      h2('Planned for Next Week'),
      bullet('[Planned item and owner]'),
      h2('Blockers & Asks'),
      bullet('[Blocker — who can unblock it and by when]'),
      h2('Metrics'),
      table([
        ['Metric', 'Last week', 'This week', 'Trend'],
        ['[Metric]', '[…]', '[…]', '↑/↓/→'],
      ]),
    ].join(''),
  },
  {
    file: 'product-requirements.docx',
    body: [
      h1('Product Requirements — [Feature name]'),
      note(AGENT_PREAMBLE),
      p('Author: [Name]    Status: Draft    Last updated: [Date]'),
      h2('Problem'),
      p('[User problem this solves, with evidence: quotes, tickets, data]'),
      h2('Goals / Non-goals'),
      bullet('Goal: [measurable outcome]'),
      bullet('Non-goal: [explicitly excluded]'),
      h2('User Stories'),
      numbered('As a [user], I want [capability] so that [benefit].'),
      h2('Requirements'),
      table([
        ['#', 'Requirement', 'Priority', 'Notes'],
        ['R1', '[Requirement]', 'P0/P1/P2', '[…]'],
      ]),
      h2('UX Notes'),
      p('[Key flows and states; link mockups]'),
      h2('Rollout & Measurement'),
      p('[Launch plan, flags, and the metric that defines success]'),
      h2('Open Questions'),
      bullet('[Question — owner and deadline for the answer]'),
    ].join(''),
  },
  {
    file: 'decision-memo.docx',
    body: [
      h1('Decision Memo — [Decision]'),
      note(AGENT_PREAMBLE),
      p('Decision owner: [Name]    Deciders: [Names]    Decide by: [Date]'),
      h2('Context'),
      p('[Why this decision is needed now, in 3–5 sentences]'),
      h2('Options Considered'),
      table([
        ['Option', 'Pros', 'Cons', 'Cost'],
        ['A. [Option]', '[…]', '[…]', '[…]'],
        ['B. [Option]', '[…]', '[…]', '[…]'],
      ]),
      h2('Recommendation'),
      note(
        'State the recommended option and the two strongest reasons; acknowledge the best argument against it.',
      ),
      p('[Recommendation]'),
      h2('Decision'),
      p('[To be filled by the deciders: chosen option, date, and any conditions]'),
      h2('Consequences & Follow-ups'),
      bullet('[What happens next, who does it, by when]'),
    ].join(''),
  },
  {
    file: 'one-pager.docx',
    body: [
      h1('[Title] — One-Pager'),
      note(AGENT_PREAMBLE),
      note('Hard limit: everything must fit one page. Cut adjectives before cutting facts.'),
      h2('What'),
      p('[What this is, in two sentences]'),
      h2('Why It Matters'),
      p('[The stakes: revenue, users, risk, or time — with a number]'),
      h2('How It Works'),
      numbered('[Step or component 1]'),
      numbered('[Step or component 2]'),
      h2('Proof'),
      bullet('[Strongest evidence: metric, pilot result, customer quote]'),
      h2('Ask'),
      p('[The specific thing the reader should do after reading]'),
    ].join(''),
  },
]

async function main() {
  mkdirSync(outDir, { recursive: true })
  for (const t of TEMPLATES) {
    const bytes = await buildDocx({ bodyXml: t.body, withNumbering: true })
    writeFileSync(join(outDir, t.file), bytes)
    console.log(`wrote templates/docs/${t.file}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
