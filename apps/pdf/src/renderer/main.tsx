import { createRoot } from 'react-dom/client'
import { htmlDir, htmlLang, type Lang } from '@hermesoffice/i18n'
import App from './App'
import { LocaleProvider } from './i18n/locale'
import type { UiTheme } from '../shared/ipc'
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
import './styles.css'
import { applyAiPanelPrefs, installScreenTips } from '@hermesoffice/ui'

installScreenTips()

function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

void (async () => {
  const [lang, theme] = await Promise.all([
    window.pdfApi.getLanguage().catch(() => 'zh' as const),
    window.pdfApi.getTheme().catch(() => 'system' as const),
  ])
  document.documentElement.lang = htmlLang(lang as Lang)
  document.documentElement.dir = htmlDir(lang)
  applyTheme(theme)
  window.pdfApi.onThemeChanged(applyTheme)
  await window.pdfApi
    ?.getAiPanelPrefs?.()
    .then(applyAiPanelPrefs)
    .catch(() => {})
  window.pdfApi?.onAiPanelPrefsChanged?.(applyAiPanelPrefs)
  createRoot(document.getElementById('root')!).render(
    <LocaleProvider initial={lang}>
      <App />
    </LocaleProvider>,
  )
})()
