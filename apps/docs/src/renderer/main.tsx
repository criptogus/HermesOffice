import { createRoot } from 'react-dom/client'
import { htmlDir, htmlLang, type Lang } from '@hermesoffice/i18n'
import { App } from './App'
import { setAuthorName } from './author-name'
import { LocaleProvider, setModuleLang } from './i18n/locale'
import type { DocTheme, UiTheme } from '../shared/ipc'
import '@hermesoffice/ui/tokens.css'
import '@hermesoffice/ui/screentip.css'
import '@hermesoffice/ui/ai-model-picker.css'
import '@hermesoffice/ui/ai-queue-strip.css'
import '@hermesoffice/ui/ai-usage.css'
import '@hermesoffice/ui/ai-skills.css'
import '@hermesoffice/ui/color-picker.css'
import '@hermesoffice/ui/dropdown.css'
import '@hermesoffice/ui/ribbon-collapse.css'
import '@hermesoffice/ui/markdown.css'
import '@hermesoffice/ui/ai-panel-prefs.css'
import '@hermesoffice/ui/ai-scope-quote.css'
import '@hermesoffice/ui/image-viewer.css'
import './styles.css'
import './fonts/fonts.css'
import { applyAiPanelPrefs, installScreenTips } from '@hermesoffice/ui'
import { setAltChunkHtmlConverter } from '@hermesoffice/docx-engine'

installScreenTips()
if (window.desktop?.convertAltChunkHtml) {
  setAltChunkHtmlConverter((html) => window.desktop.convertAltChunkHtml(html))
}

function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

function applyDocumentTheme(theme: DocTheme): void {
  // data-doc-theme drives the canvas/paper (hermesoffice#1811); absent means 'follow' the UI theme
  if (theme === 'follow') document.documentElement.removeAttribute('data-doc-theme')
  else document.documentElement.setAttribute('data-doc-theme', theme)
}

async function bootstrap(): Promise<void> {
  let lang: Lang = 'zh'
  let theme: UiTheme = 'system'
  let docTheme: DocTheme = 'follow'
  try {
    // per-promise catch: standalone runs have no app:get-theme handler, and
    // that rejection must not drop a resolved language
    ;[lang, theme, docTheme] = await Promise.all([
      window.desktop.getLanguage().catch(() => 'zh' as const),
      window.desktop.getTheme().catch(() => 'system' as const),
      window.desktop.getDocumentTheme?.().catch(() => 'follow' as const),
    ])
  } catch {
    /* dev renderer without the preload bridge */
  }
  setModuleLang(lang)
  document.documentElement.lang = htmlLang(lang)
  document.documentElement.dir = htmlDir(lang)
  applyTheme(theme)
  applyDocumentTheme(docTheme ?? 'follow')
  window.desktop?.onThemeChanged(applyTheme)
  window.desktop?.onDocumentThemeChanged?.(applyDocumentTheme)
  await window.desktop
    ?.getAiPanelPrefs?.()
    .then(applyAiPanelPrefs)
    .catch(() => {})
  window.desktop?.onAiPanelPrefsChanged?.(applyAiPanelPrefs)
  await window.desktop
    ?.getAuthorName?.()
    .then(setAuthorName)
    .catch(() => {})
  window.desktop?.onAuthorNameChanged?.(setAuthorName)
  createRoot(document.getElementById('root')!).render(
    <LocaleProvider initial={lang}>
      <App />
    </LocaleProvider>,
  )
}

void bootstrap()
