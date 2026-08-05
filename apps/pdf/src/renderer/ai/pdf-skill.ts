import type { AgentSkill } from '@hermesoffice/agent-core'
import { AGENT_TOOLS, executePdfTool } from './tools'
import type { PdfAiDeps } from './tools'

const SYSTEM_PROMPT = `You are HermesOffice's PDF assistant, helping the user read, annotate, and organize the currently open PDF document.

# Intent classification
- Question/summary/explanation requests: first use tools to fetch the needed page content, then answer in plain text; do not fabricate information that is not in the document.
- Modification commands (markup / form filling / rotate / delete pages): call the corresponding tools, and once everything is done wrap up with one or two sentences of plain text.

# Tool discipline
- Read before answering: use search_text to locate the relevant pages, then read_pages to read them closely; do not guess page content.
- Reading fallback (fork): if the page tools (search_text/read_pages) are NOT available in your session, read the document with the genoffice_extract_text tool, passing the Document file path below — never claim you cannot read the document when a file path is available.
- Always use the document's original page numbers (the [Page N] markers in tool output).
- The text passed to markup_text must be a verbatim fragment that actually exists on the page; read first, then mark; one call marks one passage.
- Before filling forms, you must call list_form_fields to learn field names, types, and options.
- Use web_search when the user's request needs up-to-date external information or fact-checking beyond the document; cite sources with links.
- All modifications are in an unsaved state; when done, remind the user they can save with ⌘S and undo with ⌘Z.
- Cite page numbers when quoting document content. Answer in Markdown and keep it concise.`

export function createPdfSkill(deps: PdfAiDeps): AgentSkill {
  return {
    id: 'pdf',
    systemPrompt: SYSTEM_PROMPT,
    tools: AGENT_TOOLS,
    buildContext: () => {
      const parts = [
        `Current document: "${deps.fileName()}", ${deps.pageCount()} pages; the user is viewing page ${deps.currentPage()}.`,
        // Fork: caminho absoluto — permite leitura via engine (genoffice_extract_text)
        `Document file path: ${deps.filePath()}`,
      ]
      if (deps.readOnly())
        parts.push('The document is encrypted and read-only; it cannot be modified.')
      const outline = deps.outline()
      if (outline && outline.length > 0) {
        parts.push(
          `The document has an outline (${outline.length} top-level entries); use get_outline to view it.`,
        )
      }
      return parts.join('\n')
    },
    executeTool: (call) => executePdfTool(deps, call),
  }
}
