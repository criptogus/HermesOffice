// Spike 40 — RFC 0008 Proposed Change contract, piloted on Slides.
// Lifecycle: draft → proposed → accepted → applied | rejected (RFC #8).
// Storage mirrors the RFC layout: <auditRoot>/<projectId>/proposals/<id>.json
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'

const AUDIT_ROOT =
  process.env.HERMESOFFICE_SPIKE40_AUDIT || join(homedir(), '.hermesoffice-spike40-audit')

const TRANSITIONS = {
  draft: ['proposed'],
  proposed: ['accepted', 'rejected'],
  accepted: ['applied'],
  applied: ['reverted'],
  rejected: [],
}

export function proposalDir(projectId) {
  return join(AUDIT_ROOT, projectId, 'proposals')
}

export function newProposal({ projectId, actor, summary, operations, preview, risks = [] }) {
  return {
    schema: 'rfc-0008/proposed-change/1',
    id: `pc_${randomUUID().slice(0, 8)}`,
    status: 'draft',
    projectId,
    actor,
    summary,
    operations,
    preview,
    risks,
    timestamps: { created: new Date().toISOString() },
  }
}

export function transition(proposal, to, note) {
  const allowed = TRANSITIONS[proposal.status]
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`illegal transition ${proposal.status} → ${to}`)
  }
  proposal.status = to
  proposal.timestamps[to] = new Date().toISOString()
  if (note) {
    proposal.history ??= []
    proposal.history.push({ at: new Date().toISOString(), to, note })
  }
  return proposal
}

export function persist(proposal) {
  const dir = proposalDir(proposal.projectId)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${proposal.id}.json`)
  writeFileSync(file, JSON.stringify(proposal, null, 2))
  return file
}

export function load(projectId, proposalId) {
  const file = join(proposalDir(projectId), `${proposalId}.json`)
  if (!existsSync(file)) throw new Error(`proposal not found: ${file}`)
  return JSON.parse(readFileSync(file, 'utf8'))
}
