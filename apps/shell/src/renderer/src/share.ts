import type { ShareTargets, ShareWindowState } from '@hermesoffice/hermes-share'

interface ShareSendResult {
  ok: boolean
  error?: string
  note?: string
}

interface ShareApi {
  getState(): Promise<ShareWindowState | null>
  listChannels(): Promise<ShareTargets>
  send(request: { target: string; message?: string }): Promise<ShareSendResult>
}

// exposed by src/preload/share.ts
const api = (window as unknown as { shareApi: ShareApi }).shareApi

const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement
const title = el('title')
const fileLabel = el('file-label')
const fileName = el('file-name')
const targetLabel = el('target-label')
const targetSelect = el('target') as HTMLSelectElement
const messageLabel = el('message-label')
const messageInput = el('message') as HTMLTextAreaElement
const status = el('status')
const cancelBtn = el('cancel') as HTMLButtonElement
const sendBtn = el('send') as HTMLButtonElement

let strings: ShareWindowState['strings'] | null = null

function showStatus(text: string, isError: boolean): void {
  status.textContent = text
  status.classList.toggle('error', isError)
  status.classList.toggle('success', !isError)
  status.classList.remove('hidden')
}

function hideStatus(): void {
  status.classList.add('hidden')
}

function setSending(sending: boolean): void {
  sendBtn.disabled = sending
  sendBtn.textContent = sending ? (strings?.sending ?? '…') : (strings?.send ?? 'Send')
}

async function loadChannels(): Promise<void> {
  setSending(true)
  hideStatus()
  try {
    const targets = await api.listChannels()
    targetSelect.replaceChildren()
    if (targets.channels.length === 0) {
      showStatus(strings?.noTargets ?? 'No channels available', true)
      return
    }
    for (const channel of targets.channels) {
      const option = document.createElement('option')
      option.value = channel.target ?? channel.platform
      option.textContent = `${channel.platform} — ${channel.name}`
      targetSelect.appendChild(option)
    }
  } catch {
    showStatus(strings?.noHermes ?? 'Hermes is not available', true)
    return
  } finally {
    setSending(false)
  }
}

async function onSend(): Promise<void> {
  if (!strings) return
  setSending(true)
  hideStatus()
  const result = await api.send({
    target: targetSelect.value,
    message: messageInput.value.trim() || undefined,
  })
  if (result.ok) {
    showStatus(result.note ?? strings.sent, false)
    setSending(false)
    sendBtn.textContent = strings.close
    sendBtn.onclick = () => window.close()
    setTimeout(() => window.close(), 1400)
  } else {
    showStatus(`${strings.failed}: ${result.error ?? ''}`, true)
    setSending(false)
  }
}

async function init(): Promise<void> {
  const state = await api.getState()
  if (!state) return
  strings = state.strings
  document.documentElement.lang = state.lang
  document.title = state.strings.title
  title.textContent = state.strings.title
  fileLabel.textContent = state.strings.fileLabel
  targetLabel.textContent = state.strings.targetLabel
  messageLabel.textContent = `${state.strings.messageLabel} (${state.strings.optional})`
  cancelBtn.textContent = state.strings.cancel
  sendBtn.textContent = state.strings.send

  if (state.fileName) {
    fileName.textContent = state.fileName
  } else {
    fileName.textContent = state.strings.noFile
    showStatus(state.strings.noFile, true)
    setSending(true)
    return
  }

  if (!state.hermesAvailable) {
    showStatus(state.strings.noHermes, true)
    setSending(true)
    return
  }

  await loadChannels()
}

cancelBtn.addEventListener('click', () => window.close())
sendBtn.addEventListener('click', () => void onSend())
void init()
