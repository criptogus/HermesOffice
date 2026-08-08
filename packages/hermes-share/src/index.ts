/**
 * @hermesoffice/hermes-share — bridge documents from HermesOffice to every
 * messaging platform the Hermes gateway is configured for.
 *
 * Transport is the Hermes CLI (`hermes send`): it reuses the gateway's
 * credentials, needs no running gateway for bot-token platforms, and already
 * knows how to attach a file as a native media bubble (`MEDIA:<path>`).
 */

export { hermesBinCandidates, resolveHermesBin } from './hermes-cli'
export { SEND_LIST_TIMEOUT_MS, execSendList, listShareTargets, parseSendList } from './targets'
export {
  MAX_ATTACHMENT_BYTES,
  SEND_TIMEOUT_MS,
  buildSendMessage,
  buildTarget,
  execSend,
  quoteMediaPath,
  sendFileToTarget,
  validateSendRequest,
} from './send'
export { SHARE_CHANNELS, registerShareIpc, setShareWindowState, type ShareIpcDeps } from './ipc'
export { openShareWindow } from './share-window'
export type {
  ShareChannel,
  ShareSendRequest,
  ShareSendResult,
  ShareStrings,
  ShareTargets,
  ShareWindowSendRequest,
  ShareWindowState,
} from './types'
