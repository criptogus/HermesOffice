import { createRoot } from 'react-dom/client'
import { htmlLang, type Lang } from '@hermesoffice/i18n'
import App from './App'
import { PresentView } from './PresentView'
import { LocaleProvider } from './i18n/locale'
import type { UiTheme } from '../shared/ipc'
import { applyAiPanelPrefs, installScreenTips } from '@hermesoffice/ui'
import '@hermesoffice/ui/tokens.css'
import '@hermesoffice/ui/screentip.css'
import '@hermesoffice/ui/dropdown.css'
import '@hermesoffice/ui/find-panel.css'
import '@hermesoffice/ui/color-picker.css'
import '@hermesoffice/ui/ribbon-collapse.css'
import '@hermesoffice/ui/ai-panel-prefs.css'
import '@hermesoffice/ui/ai-scope-quote.css'
import '@hermesoffice/ui/image-dialogs.css'
import './styles.css'

installScreenTips()

function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

void (async () => {
  const [lang, theme] = await Promise.all([
    window.htmlApi.getLanguage().catch(() => 'zh' as const),
    window.htmlApi.getTheme().catch(() => 'system' as const),
  ])
  document.documentElement.lang = htmlLang(lang as Lang)
  applyTheme(theme)
  window.htmlApi.onThemeChanged(applyTheme)
  void window.htmlApi
    ?.getAiPanelPrefs?.()
    .then(applyAiPanelPrefs)
    .catch(() => {})
  window.htmlApi?.onAiPanelPrefsChanged?.(applyAiPanelPrefs)
  // a present tab/window (opened by Present → New tab) renders only its owner's preview
  const params = new URLSearchParams(location.search)
  const present = params.has('present')
  createRoot(document.getElementById('root')!).render(
    <LocaleProvider initial={lang}>
      {present ? <PresentView title={params.get('title') ?? ''} /> : <App />}
    </LocaleProvider>,
  )
})()
