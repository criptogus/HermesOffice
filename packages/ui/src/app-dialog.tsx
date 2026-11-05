/**
 * Shared themed confirm/alert dialogs as a promise-based API — replaces
 * window.confirm/window.alert, which render unstyled OS dialogs that ignore
 * the app theme and cannot show rich context.
 *
 * Styling lives in app-dialog.css (gs-appdialog* classes, chrome tokens only).
 * Dialogs queue: only one is visible at a time, in call order.
 */
import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './app-dialog.css'

export interface AppDialogOptions {
  /** Bold heading; falls back to the app-agnostic default. */
  readonly title?: string
  /** Body text; line breaks are preserved. */
  readonly message: string
  /** Confirm button label (confirm dialogs only). */
  readonly confirmLabel?: string
  /** Cancel button label (confirm dialogs only). */
  readonly cancelLabel?: string
  /** Style the confirm action as destructive (e.g. redactions, deletes). */
  readonly danger?: boolean
}

export interface AppDialogChoice {
  readonly label: string
  /** Value the promise resolves with when this button is picked. */
  readonly value: string
  /** Style this action as destructive. */
  readonly danger?: boolean
}

interface DialogItem extends AppDialogOptions {
  readonly kind: 'confirm' | 'confirm-danger' | 'alert' | 'choice'
  readonly choices?: ReadonlyArray<AppDialogChoice>
  readonly resolve: (value: string | boolean | null) => void
}

const queue: DialogItem[] = []
let hostSetItems: React.Dispatch<React.SetStateAction<DialogItem[]>> | null = null
let hostRoot: ReturnType<typeof createRoot> | null = null
let hostContainer: HTMLDivElement | null = null

function ensureHost(): void {
  if (hostContainer) return
  hostContainer = document.createElement('div')
  hostContainer.className = 'gs-appdialog-host'
  document.body.appendChild(hostContainer)
  hostRoot = createRoot(hostContainer)
  hostRoot.render(<DialogHost />)
}

function enqueue(item: DialogItem): void {
  ensureHost()
  queue.push(item)
  hostSetItems?.([...queue])
}

function settleCurrent(value: string | boolean | null): void {
  const current = queue.shift()
  if (!current) return
  current.resolve(value)
  hostSetItems?.([...queue])
}

/** Themed replacement for window.confirm — resolves true on confirm, false on cancel/Escape/backdrop. */
export function appConfirmDialog(options: AppDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    enqueue({ ...options, kind: options.danger ? 'confirm-danger' : 'confirm', resolve: (v) => resolve(v === true) })
  })
}

/** Themed replacement for window.alert — resolves when dismissed. */
export function appAlertDialog(options: AppDialogOptions): Promise<void> {
  return new Promise((resolve) => {
    enqueue({ ...options, kind: 'alert', resolve: () => resolve() })
  })
}

/** Themed replacement for multi-button prompts (e.g. the Zotero Yes/No/Cancel
 *  shim): resolves with the picked choice's value, or null on cancel/Escape/backdrop. */
export function appChoiceDialog(options: {
  readonly title?: string
  readonly message: string
  readonly choices: ReadonlyArray<AppDialogChoice>
  readonly cancelLabel?: string
}): Promise<string | null> {
  return new Promise((resolve) => {
    enqueue({
      ...options,
      kind: 'choice',
      resolve: (v) => resolve(typeof v === 'string' ? v : null),
    })
  })
}

function DialogHost(): React.JSX.Element | null {
  const [items, setItems] = useState<DialogItem[]>([])
  const primaryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    hostSetItems = setItems
    return () => {
      hostSetItems = null
    }
  }, [])

  const current = items[0]
  useEffect(() => {
    if (current) primaryRef.current?.focus()
  }, [current])

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        settleCurrent(current.kind === 'alert' ? true : null)
      } else if (e.key === 'Enter' && current.kind !== 'alert' && current.kind !== 'choice') {
        e.preventDefault()
        settleCurrent(true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [current])

  if (!current) return null
  const isAlert = current.kind === 'alert'
  const isDanger = current.kind === 'confirm-danger'
  const isChoice = current.kind === 'choice'

  return (
    <div
      className="gs-appdialog-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) settleCurrent(isAlert ? true : null)
      }}
    >
      <div
        className="gs-appdialog"
        role={isAlert ? 'alert' : 'alertdialog'}
        aria-modal="true"
        aria-label={current.title}
      >
        {current.title ? <div className="gs-appdialog-title">{current.title}</div> : null}
        <div className="gs-appdialog-message">{current.message}</div>
        <div className="gs-appdialog-actions">
          {isAlert ? (
            <button
              ref={primaryRef}
              type="button"
              className="gs-appdialog-btn gs-appdialog-btn-primary"
              onClick={() => settleCurrent(true)}
            >
              {current.confirmLabel ?? 'OK'}
            </button>
          ) : isChoice ? (
            <>
              <button
                type="button"
                className="gs-appdialog-btn"
                onClick={() => settleCurrent(null)}
              >
                {current.cancelLabel ?? 'Cancel'}
              </button>
              {current.choices?.map((choice, i) => (
                <button
                  key={choice.value}
                  ref={i === current.choices!.length - 1 ? primaryRef : undefined}
                  type="button"
                  className={
                    choice.danger
                      ? 'gs-appdialog-btn gs-appdialog-btn-danger'
                      : i === current.choices!.length - 1
                        ? 'gs-appdialog-btn gs-appdialog-btn-primary'
                        : 'gs-appdialog-btn'
                  }
                  onClick={() => settleCurrent(choice.value)}
                >
                  {choice.label}
                </button>
              ))}
            </>
          ) : (
            <>
              <button
                type="button"
                className="gs-appdialog-btn"
                onClick={() => settleCurrent(null)}
              >
                {current.cancelLabel ?? 'Cancel'}
              </button>
              <button
                ref={primaryRef}
                type="button"
                className={
                  isDanger
                    ? 'gs-appdialog-btn gs-appdialog-btn-danger'
                    : 'gs-appdialog-btn gs-appdialog-btn-primary'
                }
                onClick={() => settleCurrent(true)}
              >
                {current.confirmLabel ?? 'OK'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
