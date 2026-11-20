import { useEffect, useState } from 'react'
import type { DocTemplateInfo } from '../../shared/home-api'
import { useI18n } from './locale'

interface TemplatePickerProps {
  /** the picked template's id; the caller creates the document */
  onChoose: (id: string) => void
  onCancel: () => void
}

/** Modal listing the built-in document templates (data-driven from templates/manifest.json). */
export function TemplatePicker({ onChoose, onCancel }: TemplatePickerProps) {
  const { t } = useI18n()
  // null while loading
  const [templates, setTemplates] = useState<DocTemplateInfo[] | null>(null)

  useEffect(() => {
    let cancelled = false
    window.aiOffice
      .listDocTemplates()
      .then((list) => {
        if (!cancelled) setTemplates(list)
      })
      .catch(() => {
        if (!cancelled) setTemplates([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal template-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('templatePickerTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{t('templatePickerTitle')}</h3>
        {templates && templates.length === 0 ? (
          <p>{t('templatePickerEmpty')}</p>
        ) : (
          <ul className="template-list">
            {(templates ?? []).map((tpl) => (
              <li key={tpl.id}>
                <button type="button" className="template-card" onClick={() => onChoose(tpl.id)}>
                  <span className="template-name">{tpl.name}</span>
                  {tpl.description && <span className="template-desc">{tpl.description}</span>}
                  {tpl.tags.length > 0 && (
                    <span className="template-tags">
                      {tpl.tags.map((tag) => (
                        <span key={tag} className="template-tag">
                          {tag}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-buttons">
          <button className="btn btn-secondary" autoFocus onClick={onCancel}>
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
