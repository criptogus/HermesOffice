/**
 * HermesOffice — fork de GenOffice (genspark-ai/genoffice, Apache-2.0,
 * Copyright 2026 Mainfunc, Inc.). Modificações do fork por criptogus;
 * atribuição original preservada em NOTICE.
 */
import { spawn } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import {
  BrowserWindow,
  Menu,
  app,
  dialog,
  ipcMain,
  nativeImage,
  session,
  shell,
  webContents,
} from 'electron'
import type { MenuItemConstructorOptions, NativeImage } from 'electron'
import menuDocxIcon1x from './assets/menu-docx.png?asset'
import menuDocxIcon2x from './assets/menu-docx@2x.png?asset'
import menuXlsxIcon1x from './assets/menu-xlsx.png?asset'
import menuXlsxIcon2x from './assets/menu-xlsx@2x.png?asset'
import menuPptxIcon1x from './assets/menu-pptx.png?asset'
import menuPptxIcon2x from './assets/menu-pptx@2x.png?asset'
import { hermesHealthUrl } from '@hermesoffice/ai-provider'
import { createI18n, isLang, normalizeLang, setUiLang, type Lang } from '@hermesoffice/i18n'
import { installNavigationGuard } from '@hermesoffice/electron-utils'
import { readAppSettings, writeAppSetting } from './app-settings'
import { ProjectStore } from '@hermesoffice/project-store'

import {
  buildDocsMenu,
  configureDocsRuntime,
  docsFileRenamed,
  docsQueryDirty,
  requestDocsClose,
  readRecentFiles,
  readStarredFiles,
  recordRecentFile,
  removeRecentFiles,
  replaceRecentFile,
  registerAiIpc,
  registerProjectIpc,
  toggleStarredFile,
  registerDocsIpc,
  setDocsExtraFileMenuItems,
  setDocsMenuGate,
  setDocsShellHooks,
  projectFileRenamed,
  setDocsShellWindow,
  setDocsFileSavedHook,
  setSessionPathResolver,
  defaultSaveDir,
  uniquePathIn,
} from '../../../docs/src/main/docs-main'
import { blankXlsxBuffer } from '../../../sheets/src/gateway/csv-import'
import {
  configureSheetsRuntime,
  hasQueuedWorkbook,
  installSheetsMenu,
  markSheetsShuttingDown,
  requestSheetsClose,
  resolveSheetsSessionPath,
  markSheetsUntitledPath,
  sendSheetsMenuAction,
  sheetsFileRenamed,
  setForcedWorkbookPath,
  setSheetsCloseTabHook,
  setSheetsExtraFileMenuItems,
  setSheetsShellWindow,
  setSheetsWorkbookOpenedHook,
  startSheetsCaptureServer,
  stopSheetsSidecar,
} from '../../../sheets/src/main/sheets-main'
import {
  configureSlidesRuntime,
  installSlidesMenu,
  replaceSlidesRecentFile,
  requestSlidesClose,
  setSlidesCloseTabHook,
  setSlidesExtraFileMenuItems,
  setSlidesOpenedHook,
  setSlidesShellWindow,
  slidesFileRenamed,
} from '../../../slides/src/main/slides-main'
import { configurePdfRuntime, flushPdfSave, requestPdfClose } from '../../../pdf/src/main/pdf-main'
import type { RecentEntry, RecentPage, RenameResult } from '../shared/home-api'
import { HOME_CHANNELS } from '../shared/home-api'
import type { TabKind } from '../shared/tabs-api'
import { TABS_CHANNELS } from '../shared/tabs-api'
import { ensureHermesGateway } from './hermes-launcher'
import { normalizeRecentQuery, pageRecentPaths, statExistingPaths } from './recent-files'
import { TabManager } from './tab-manager'
import { initAutoUpdater } from './updater'
import { initMainUpdater } from './main-updater'

/**
 * HermesOffice unified shell: ONE Electron app, ONE BrowserWindow, hosting the
 * docs and sheets modules as WebContentsView tabs behind a WPS-style tab
 * strip. The shell owns the lifecycle — single-instance lock, file-
 * association routing by extension, and per-active-tab menu switching.
 * Renderers load from each module's build output (apps/docs/out,
 * apps/sheets/out), so build those before running the shell.
 */

// ANY unpacked run (`npm run shell`, `npm run dev`, `npx electron .`) must not
// share the installed app's userData or single-instance lock — otherwise a dev
// run silently quits and forwards its argv to the running installed HermesOffice.
// HERMESOFFICE_USER_DATA: test drivers point this at a scratch dir so an
// automated instance can run alongside the dev instance (separate lock).
if (!app.isPackaged)
  app.setPath(
    'userData',
    process.env.HERMESOFFICE_USER_DATA ?? join(app.getPath('appData'), 'HermesOffice Dev'),
  )

// The product rename from "AI Office" to HermesOffice changed the userData path; migrate old user data once
if (app.isPackaged) {
  const oldDir = join(app.getPath('appData'), 'AI Office')
  const newDir = app.getPath('userData')
  const newEmpty = !existsSync(newDir) || readdirSync(newDir).length === 0
  if (newEmpty && existsSync(oldDir)) cpSync(oldDir, newDir, { recursive: true })
}

// module build outputs: packaged builds carry them as extraResources
// (resources/modules/*, resources/native/*); dev/unpacked resolves them
// relative to apps/shell in the monorepo layout.
const SIDECAR_EXE = process.platform === 'win32' ? 'xlsx-sidecar.exe' : 'xlsx-sidecar'
const APPS_ROOT = join(app.getAppPath(), '..')
const DOCS_OUT = app.isPackaged
  ? join(process.resourcesPath, 'modules', 'docs')
  : join(APPS_ROOT, 'docs', 'out')
const SHEETS_OUT = app.isPackaged
  ? join(process.resourcesPath, 'modules', 'sheets')
  : join(APPS_ROOT, 'sheets', 'out')
const SLIDES_OUT = app.isPackaged
  ? join(process.resourcesPath, 'modules', 'slides')
  : join(APPS_ROOT, 'slides', 'out')
const PDF_OUT = app.isPackaged
  ? join(process.resourcesPath, 'modules', 'pdf')
  : join(APPS_ROOT, 'pdf', 'out')
const SIDECAR_BIN = app.isPackaged
  ? join(process.resourcesPath, 'native', SIDECAR_EXE)
  : join(APPS_ROOT, 'sheets', 'native', 'xlsx-engine', 'target', 'release', SIDECAR_EXE)

configureDocsRuntime({
  preloadPath: join(DOCS_OUT, 'preload', 'index.js'),
  rendererUrl: process.env.DOCS_RENDERER_URL,
  rendererFile: join(DOCS_OUT, 'renderer', 'index.html'),
})
configureSheetsRuntime({
  preloadPath: join(SHEETS_OUT, 'preload', 'index.js'),
  rendererUrl: process.env.SHEETS_RENDERER_URL,
  rendererFile: join(SHEETS_OUT, 'renderer', 'index.html'),
  sidecarPath: SIDECAR_BIN,
})
configureSlidesRuntime({
  preloadPath: join(SLIDES_OUT, 'preload', 'index.js'),
  rendererDevUrl: process.env.SLIDES_RENDERER_URL,
  rendererFilePath: join(SLIDES_OUT, 'renderer', 'index.html'),
})
configurePdfRuntime({
  preloadPath: join(PDF_OUT, 'preload', 'index.js'),
  rendererUrl: process.env.PDF_RENDERER_URL,
  rendererFile: join(PDF_OUT, 'renderer', 'index.html'),
})

// ---- UI language ----
// Persisted in userData/app-settings.json so the editor modules can read the
// same file when they pick up i18n later. HERMESOFFICE_LANG overrides for tests.

const APP_SETTINGS_PATH = () => join(app.getPath('userData'), 'app-settings.json')

let uiLang: Lang | null = null

function currentLang(): Lang {
  if (uiLang) return uiLang
  if (process.env.HERMESOFFICE_LANG) {
    uiLang = normalizeLang(process.env.HERMESOFFICE_LANG)
    setUiLang(uiLang)
    return uiLang
  }
  const saved = readAppSettings(APP_SETTINGS_PATH()).language
  if (isLang(saved)) uiLang = saved
  uiLang ??= normalizeLang(app.getLocale())
  setUiLang(uiLang)
  return uiLang
}

function persistLang(lang: Lang): void {
  uiLang = lang
  setUiLang(lang)
  writeAppSetting(APP_SETTINGS_PATH(), 'language', lang)
}

// ---- first-run onboarding ----
// Fork: o link de comunidade aponta para o repo do HermesOffice.
const GENTEAM_URL = 'https://github.com/criptogus/HermesOffice'

const tMain = createI18n({
  zh: {
    menuFile: '文件',
    menuSectionNew: '新建',
    menuNewDoc: 'AI Docs',
    menuNewSheet: 'AI Sheets',
    untitledSheet: '未命名表格',
    untitledDoc: '未命名文档',
    untitledDeck: '未命名演示文稿',
    menuNewSlide: 'AI Slides',
    menuOpen: '打开…',
    menuSave: '保存',
    menuSaveAs: '另存为…',
    menuClose: '关闭',
    menuEdit: '编辑',
    menuWindow: '窗口',
    menuHome: '首页',
    backToHome: '返回首页',
    dlgOpenTitle: '打开文件',
    filterSupported: '支持的文件',
    filterWord: 'Word 文档',
    filterExcel: 'Excel 工作簿',
    filterPpt: 'PowerPoint 演示文稿',
    filterPdf: 'PDF 文档',
    errBadArgs: '参数无效',
    errBadName: '文件名不合法',
    errMissing: '文件不存在',
    errExists: '同名文件已存在',
    errRenameFailed: '重命名失败',
    errUnsupportedExt: '暂不支持 .{ext} 类型',
    copySuffix: '副本',
    menuHelp: '帮助',
    thirdPartyNotices: '第三方软件声明',
    hermesGwTitle: 'Hermes 网关',
    hermesGwBody: 'Hermes 网关未在运行。HermesOffice 的 AI 功能需要本地网关。现在启动它吗？',
    hermesGwStart: '启动',
    hermesGwNotNow: '暂不',
    hermesGwNever: '不再询问',
    hermesGwAlways: '总是自动启动',
    hermesGwFailed: '网关启动失败，请在终端中手动运行 hermes gateway start。',
  },
  en: {
    menuFile: 'File',
    menuSectionNew: 'New',
    menuNewDoc: 'AI Docs',
    menuNewSheet: 'AI Sheets',
    untitledSheet: 'Untitled Spreadsheet',
    untitledDoc: 'Untitled Document',
    untitledDeck: 'Untitled Presentation',
    menuNewSlide: 'AI Slides',
    menuOpen: 'Open…',
    menuSave: 'Save',
    menuSaveAs: 'Save As…',
    menuClose: 'Close',
    menuEdit: 'Edit',
    menuWindow: 'Window',
    menuHome: 'Home',
    backToHome: 'Back to Home',
    dlgOpenTitle: 'Open File',
    filterSupported: 'Supported Files',
    filterWord: 'Word Documents',
    filterExcel: 'Excel Workbooks',
    filterPpt: 'PowerPoint Presentations',
    filterPdf: 'PDF Documents',
    errBadArgs: 'Invalid arguments',
    errBadName: 'Invalid file name',
    errMissing: 'File not found',
    errExists: 'A file with that name already exists',
    errRenameFailed: 'Rename failed',
    errUnsupportedExt: '.{ext} files are not supported',
    copySuffix: 'copy',
    menuHelp: 'Help',
    thirdPartyNotices: 'Third-Party Notices',
    hermesGwTitle: 'Hermes gateway',
    hermesGwBody:
      "The Hermes gateway is not running. HermesOffice's AI features need the local gateway. Start it now?",
    hermesGwStart: 'Start',
    hermesGwNotNow: 'Not now',
    hermesGwNever: "Don't ask again",
    hermesGwAlways: 'Always start automatically',
    hermesGwFailed:
      'The gateway failed to start; run `hermes gateway start` manually in a terminal.',
  },
  ja: {
    menuFile: 'ファイル',
    menuSectionNew: '新規作成',
    menuNewDoc: 'AI Docs',
    menuNewSheet: 'AI Sheets',
    untitledSheet: '無題のスプレッドシート',
    untitledDoc: '無題のドキュメント',
    untitledDeck: '無題のプレゼンテーション',
    menuNewSlide: 'AI Slides',
    menuOpen: '開く…',
    menuSave: '保存',
    menuSaveAs: '名前を付けて保存…',
    menuClose: '閉じる',
    menuEdit: '編集',
    menuWindow: 'ウィンドウ',
    menuHome: 'ホーム',
    backToHome: 'ホームに戻る',
    dlgOpenTitle: 'ファイルを開く',
    filterSupported: '対応ファイル',
    filterWord: 'Word 文書',
    filterExcel: 'Excel ブック',
    filterPpt: 'PowerPoint プレゼンテーション',
    filterPdf: 'PDF ドキュメント',
    errBadArgs: '引数が無効です',
    errBadName: 'ファイル名が無効です',
    errMissing: 'ファイルが見つかりません',
    errExists: '同名のファイルが既に存在します',
    errRenameFailed: '名前の変更に失敗しました',
    errUnsupportedExt: '.{ext} 形式には対応していません',
    copySuffix: 'コピー',
    menuHelp: 'ヘルプ',
    thirdPartyNotices: 'サードパーティソフトウェアに関する通知',
    hermesGwTitle: 'Hermes ゲートウェイ',
    hermesGwBody:
      'Hermes ゲートウェイが起動していません。HermesOffice の AI 機能にはローカルゲートウェイが必要です。今すぐ起動しますか？',
    hermesGwStart: '起動',
    hermesGwNotNow: '後で',
    hermesGwNever: '今後表示しない',
    hermesGwAlways: '常に自動で起動',
    hermesGwFailed:
      'ゲートウェイの起動に失敗しました。ターミナルで hermes gateway start を実行してください。',
  },
  ko: {
    menuFile: '파일',
    menuSectionNew: '새로 만들기',
    menuNewDoc: 'AI Docs',
    menuNewSheet: 'AI Sheets',
    untitledSheet: '제목 없는 스프레드시트',
    untitledDoc: '제목 없는 문서',
    untitledDeck: '제목 없는 프레젠테이션',
    menuNewSlide: 'AI Slides',
    menuOpen: '열기…',
    menuSave: '저장',
    menuSaveAs: '다른 이름으로 저장…',
    menuClose: '닫기',
    menuEdit: '편집',
    menuWindow: '창',
    menuHome: '홈',
    backToHome: '홈으로 돌아가기',
    dlgOpenTitle: '파일 열기',
    filterSupported: '지원되는 파일',
    filterWord: 'Word 문서',
    filterExcel: 'Excel 통합 문서',
    filterPpt: 'PowerPoint 프레젠테이션',
    filterPdf: 'PDF 문서',
    errBadArgs: '잘못된 인수입니다',
    errBadName: '파일 이름이 잘못되었습니다',
    errMissing: '파일을 찾을 수 없습니다',
    errExists: '같은 이름의 파일이 이미 있습니다',
    errRenameFailed: '이름 바꾸기에 실패했습니다',
    errUnsupportedExt: '.{ext} 형식은 지원되지 않습니다',
    copySuffix: '복사본',
    menuHelp: '도움말',
    thirdPartyNotices: '타사 소프트웨어 고지',
    hermesGwTitle: 'Hermes 게이트웨이',
    hermesGwBody:
      'Hermes 게이트웨이가 실행 중이 아닙니다. HermesOffice의 AI 기능에는 로컬 게이트웨이가 필요합니다. 지금 시작할까요?',
    hermesGwStart: '시작',
    hermesGwNotNow: '나중에',
    hermesGwNever: '다시 묻지 않음',
    hermesGwAlways: '항상 자동으로 시작',
    hermesGwFailed: '게이트웨이 시작에 실패했습니다. 터미널에서 hermes gateway start를 실행하세요.',
  },
  fr: {
    menuFile: 'Fichier',
    menuSectionNew: 'Nouveau',
    menuNewDoc: 'AI Docs',
    menuNewSheet: 'AI Sheets',
    untitledSheet: 'Feuille de calcul sans titre',
    untitledDoc: 'Document sans titre',
    untitledDeck: 'Présentation sans titre',
    menuNewSlide: 'AI Slides',
    menuOpen: 'Ouvrir…',
    menuSave: 'Enregistrer',
    menuSaveAs: 'Enregistrer sous…',
    menuClose: 'Fermer',
    menuEdit: 'Édition',
    menuWindow: 'Fenêtre',
    menuHome: 'Accueil',
    backToHome: "Retour à l'accueil",
    dlgOpenTitle: 'Ouvrir un fichier',
    filterSupported: 'Fichiers pris en charge',
    filterWord: 'Documents Word',
    filterExcel: 'Classeurs Excel',
    filterPpt: 'Présentations PowerPoint',
    filterPdf: 'Documents PDF',
    errBadArgs: 'Arguments non valides',
    errBadName: 'Nom de fichier non valide',
    errMissing: 'Fichier introuvable',
    errExists: 'Un fichier du même nom existe déjà',
    errRenameFailed: 'Échec du renommage',
    errUnsupportedExt: 'les fichiers .{ext} ne sont pas pris en charge',
    copySuffix: 'copie',
    menuHelp: 'Aide',
    thirdPartyNotices: 'Mentions relatives aux logiciels tiers',
    hermesGwTitle: 'Passerelle Hermes',
    hermesGwBody:
      "La passerelle Hermes n'est pas en cours d'exécution. Les fonctions IA de HermesOffice en ont besoin. La démarrer maintenant ?",
    hermesGwStart: 'Démarrer',
    hermesGwNotNow: 'Plus tard',
    hermesGwNever: 'Ne plus demander',
    hermesGwAlways: 'Toujours démarrer automatiquement',
    hermesGwFailed:
      'Échec du démarrage de la passerelle ; exécutez hermes gateway start dans un terminal.',
  },
  de: {
    menuFile: 'Datei',
    menuSectionNew: 'Neu',
    menuNewDoc: 'AI Docs',
    menuNewSheet: 'AI Sheets',
    untitledSheet: 'Unbenannte Tabelle',
    untitledDoc: 'Unbenanntes Dokument',
    untitledDeck: 'Unbenannte Präsentation',
    menuNewSlide: 'AI Slides',
    menuOpen: 'Öffnen…',
    menuSave: 'Speichern',
    menuSaveAs: 'Speichern unter…',
    menuClose: 'Schließen',
    menuEdit: 'Bearbeiten',
    menuWindow: 'Fenster',
    menuHome: 'Startseite',
    backToHome: 'Zurück zur Startseite',
    dlgOpenTitle: 'Datei öffnen',
    filterSupported: 'Unterstützte Dateien',
    filterWord: 'Word-Dokumente',
    filterExcel: 'Excel-Arbeitsmappen',
    filterPpt: 'PowerPoint-Präsentationen',
    filterPdf: 'PDF-Dokumente',
    errBadArgs: 'Ungültige Argumente',
    errBadName: 'Ungültiger Dateiname',
    errMissing: 'Datei nicht gefunden',
    errExists: 'Eine Datei mit diesem Namen existiert bereits',
    errRenameFailed: 'Umbenennen fehlgeschlagen',
    errUnsupportedExt: '.{ext}-Dateien werden nicht unterstützt',
    copySuffix: 'Kopie',
    menuHelp: 'Hilfe',
    thirdPartyNotices: 'Hinweise zu Drittanbietersoftware',
    hermesGwTitle: 'Hermes-Gateway',
    hermesGwBody:
      'Das Hermes-Gateway läuft nicht. Die KI-Funktionen von HermesOffice benötigen das lokale Gateway. Jetzt starten?',
    hermesGwStart: 'Starten',
    hermesGwNotNow: 'Nicht jetzt',
    hermesGwNever: 'Nicht mehr fragen',
    hermesGwAlways: 'Immer automatisch starten',
    hermesGwFailed:
      'Der Gateway-Start ist fehlgeschlagen; führen Sie hermes gateway start im Terminal aus.',
  },
  es: {
    menuFile: 'Archivo',
    menuSectionNew: 'Nuevo',
    menuNewDoc: 'AI Docs',
    menuNewSheet: 'AI Sheets',
    untitledSheet: 'Hoja de cálculo sin título',
    untitledDoc: 'Documento sin título',
    untitledDeck: 'Presentación sin título',
    menuNewSlide: 'AI Slides',
    menuOpen: 'Abrir…',
    menuSave: 'Guardar',
    menuSaveAs: 'Guardar como…',
    menuClose: 'Cerrar',
    menuEdit: 'Edición',
    menuWindow: 'Ventana',
    menuHome: 'Inicio',
    backToHome: 'Volver al inicio',
    dlgOpenTitle: 'Abrir archivo',
    filterSupported: 'Archivos compatibles',
    filterWord: 'Documentos de Word',
    filterExcel: 'Libros de Excel',
    filterPpt: 'Presentaciones de PowerPoint',
    filterPdf: 'Documentos PDF',
    errBadArgs: 'Argumentos no válidos',
    errBadName: 'Nombre de archivo no válido',
    errMissing: 'Archivo no encontrado',
    errExists: 'Ya existe un archivo con ese nombre',
    errRenameFailed: 'No se pudo cambiar el nombre',
    errUnsupportedExt: 'los archivos .{ext} no son compatibles',
    copySuffix: 'copia',
    menuHelp: 'Ayuda',
    thirdPartyNotices: 'Avisos de software de terceros',
    hermesGwTitle: 'Puerta de enlace Hermes',
    hermesGwBody:
      'La puerta de enlace Hermes no está en ejecución. Las funciones de IA de HermesOffice la necesitan. ¿Iniciarla ahora?',
    hermesGwStart: 'Iniciar',
    hermesGwNotNow: 'Ahora no',
    hermesGwNever: 'No volver a preguntar',
    hermesGwAlways: 'Iniciar siempre automáticamente',
    hermesGwFailed: 'No se pudo iniciar; ejecute hermes gateway start en una terminal.',
  },
  th: {
    menuFile: 'ไฟล์',
    menuSectionNew: 'สร้างใหม่',
    menuNewDoc: 'AI Docs',
    menuNewSheet: 'AI Sheets',
    untitledSheet: 'สเปรดชีตไม่มีชื่อ',
    untitledDoc: 'เอกสารไม่มีชื่อ',
    untitledDeck: 'งานนำเสนอไม่มีชื่อ',
    menuNewSlide: 'AI Slides',
    menuOpen: 'เปิด…',
    menuSave: 'บันทึก',
    menuSaveAs: 'บันทึกเป็น…',
    menuClose: 'ปิด',
    menuEdit: 'แก้ไข',
    menuWindow: 'หน้าต่าง',
    menuHome: 'หน้าแรก',
    backToHome: 'กลับไปหน้าแรก',
    dlgOpenTitle: 'เปิดไฟล์',
    filterSupported: 'ไฟล์ที่รองรับ',
    filterWord: 'เอกสาร Word',
    filterExcel: 'เวิร์กบุ๊ก Excel',
    filterPpt: 'งานนำเสนอ PowerPoint',
    filterPdf: 'เอกสาร PDF',
    errBadArgs: 'อาร์กิวเมนต์ไม่ถูกต้อง',
    errBadName: 'ชื่อไฟล์ไม่ถูกต้อง',
    errMissing: 'ไม่พบไฟล์',
    errExists: 'มีไฟล์ชื่อเดียวกันอยู่แล้ว',
    errRenameFailed: 'เปลี่ยนชื่อไม่สำเร็จ',
    errUnsupportedExt: 'ไม่รองรับไฟล์ .{ext}',
    copySuffix: 'สำเนา',
    menuHelp: 'วิธีใช้',
    thirdPartyNotices: 'ประกาศเกี่ยวกับซอฟต์แวร์ของบุคคลที่สาม',
    hermesGwTitle: 'เกตเวย์ Hermes',
    hermesGwBody:
      'เกตเวย์ Hermes ยังไม่ทำงาน ฟีเจอร์ AI ของ HermesOffice ต้องใช้เกตเวย์ในเครื่อง เริ่มตอนนี้หรือไม่?',
    hermesGwStart: 'เริ่ม',
    hermesGwNotNow: 'ไว้ทีหลัง',
    hermesGwNever: 'ไม่ต้องถามอีก',
    hermesGwAlways: 'เริ่มอัตโนมัติเสมอ',
    hermesGwFailed: 'เริ่มเกตเวย์ไม่สำเร็จ โปรดรัน hermes gateway start ในเทอร์มินัล',
  },
  id: {
    menuFile: 'File',
    menuSectionNew: 'Baru',
    menuNewDoc: 'AI Docs',
    menuNewSheet: 'AI Sheets',
    untitledSheet: 'Spreadsheet tanpa judul',
    untitledDoc: 'Dokumen tanpa judul',
    untitledDeck: 'Presentasi tanpa judul',
    menuNewSlide: 'AI Slides',
    menuOpen: 'Buka…',
    menuSave: 'Simpan',
    menuSaveAs: 'Simpan Sebagai…',
    menuClose: 'Tutup',
    menuEdit: 'Edit',
    menuWindow: 'Jendela',
    menuHome: 'Beranda',
    backToHome: 'Kembali ke Beranda',
    dlgOpenTitle: 'Buka File',
    filterSupported: 'File yang Didukung',
    filterWord: 'Dokumen Word',
    filterExcel: 'Buku Kerja Excel',
    filterPpt: 'Presentasi PowerPoint',
    filterPdf: 'Dokumen PDF',
    errBadArgs: 'Argumen tidak valid',
    errBadName: 'Nama file tidak valid',
    errMissing: 'File tidak ditemukan',
    errExists: 'File dengan nama tersebut sudah ada',
    errRenameFailed: 'Gagal mengganti nama',
    errUnsupportedExt: 'file .{ext} tidak didukung',
    copySuffix: 'salinan',
    menuHelp: 'Bantuan',
    thirdPartyNotices: 'Pemberitahuan Perangkat Lunak Pihak Ketiga',
    hermesGwTitle: 'Gateway Hermes',
    hermesGwBody:
      'Gateway Hermes tidak berjalan. Fitur AI HermesOffice memerlukan gateway lokal. Mulai sekarang?',
    hermesGwStart: 'Mulai',
    hermesGwNotNow: 'Nanti saja',
    hermesGwNever: 'Jangan tanya lagi',
    hermesGwAlways: 'Selalu mulai otomatis',
    hermesGwFailed: 'Gateway gagal dimulai; jalankan hermes gateway start di terminal.',
  },
  ru: {
    menuFile: 'Файл',
    menuSectionNew: 'Создать',
    menuNewDoc: 'AI Docs',
    menuNewSheet: 'AI Sheets',
    untitledSheet: 'Таблица без названия',
    untitledDoc: 'Документ без названия',
    untitledDeck: 'Презентация без названия',
    menuNewSlide: 'AI Slides',
    menuOpen: 'Открыть…',
    menuSave: 'Сохранить',
    menuSaveAs: 'Сохранить как…',
    menuClose: 'Закрыть',
    menuEdit: 'Правка',
    menuWindow: 'Окно',
    menuHome: 'Главная',
    backToHome: 'Вернуться на главную',
    dlgOpenTitle: 'Открытие файла',
    filterSupported: 'Поддерживаемые файлы',
    filterWord: 'Документы Word',
    filterExcel: 'Книги Excel',
    filterPpt: 'Презентации PowerPoint',
    filterPdf: 'Документы PDF',
    errBadArgs: 'Недопустимые аргументы',
    errBadName: 'Недопустимое имя файла',
    errMissing: 'Файл не найден',
    errExists: 'Файл с таким именем уже существует',
    errRenameFailed: 'Не удалось переименовать',
    errUnsupportedExt: 'файлы .{ext} не поддерживаются',
    copySuffix: 'копия',
    menuHelp: 'Справка',
    thirdPartyNotices: 'Уведомления о стороннем ПО',
    hermesGwTitle: 'Шлюз Hermes',
    hermesGwBody:
      'Шлюз Hermes не запущен. Функциям ИИ HermesOffice нужен локальный шлюз. Запустить сейчас?',
    hermesGwStart: 'Запустить',
    hermesGwNotNow: 'Не сейчас',
    hermesGwNever: 'Больше не спрашивать',
    hermesGwAlways: 'Всегда запускать автоматически',
    hermesGwFailed: 'Не удалось запустить шлюз; выполните hermes gateway start в терминале.',
  },
  ar: {
    menuFile: 'ملف',
    menuSectionNew: 'جديد',
    menuNewDoc: 'AI Docs',
    menuNewSheet: 'AI Sheets',
    untitledSheet: 'جدول بيانات بلا عنوان',
    untitledDoc: 'مستند بدون عنوان',
    untitledDeck: 'عرض تقديمي بدون عنوان',
    menuNewSlide: 'AI Slides',
    menuOpen: 'فتح…',
    menuSave: 'حفظ',
    menuSaveAs: 'حفظ باسم…',
    menuClose: 'إغلاق',
    menuEdit: 'تحرير',
    menuWindow: 'نافذة',
    menuHome: 'الصفحة الرئيسية',
    backToHome: 'العودة إلى الصفحة الرئيسية',
    dlgOpenTitle: 'فتح ملف',
    filterSupported: 'الملفات المدعومة',
    filterWord: 'مستندات Word',
    filterExcel: 'مصنفات Excel',
    filterPpt: 'عروض PowerPoint التقديمية',
    filterPdf: 'مستندات PDF',
    errBadArgs: 'وسيطات غير صالحة',
    errBadName: 'اسم ملف غير صالح',
    errMissing: 'الملف غير موجود',
    errExists: 'يوجد ملف بالاسم نفسه بالفعل',
    errRenameFailed: 'فشلت إعادة التسمية',
    errUnsupportedExt: 'ملفات .{ext} غير مدعومة',
    copySuffix: 'نسخة',
    menuHelp: 'تعليمات',
    thirdPartyNotices: 'إشعارات برامج الجهات الخارجية',
    hermesGwTitle: 'بوابة Hermes',
    hermesGwBody:
      'بوابة Hermes غير مشغّلة. تحتاج ميزات الذكاء الاصطناعي في HermesOffice إلى البوابة المحلية. هل تريد تشغيلها الآن؟',
    hermesGwStart: 'تشغيل',
    hermesGwNotNow: 'ليس الآن',
    hermesGwNever: 'عدم السؤال مجددًا',
    hermesGwAlways: 'التشغيل تلقائيًا دائمًا',
    hermesGwFailed: 'فشل تشغيل البوابة؛ نفّذ hermes gateway start في الطرفية.',
  },
  pt: {
    menuFile: 'Arquivo',
    menuSectionNew: 'Novo',
    menuNewDoc: 'AI Docs',
    menuNewSheet: 'AI Sheets',
    untitledSheet: 'Planilha sem título',
    untitledDoc: 'Documento sem título',
    untitledDeck: 'Apresentação sem título',
    menuNewSlide: 'AI Slides',
    menuOpen: 'Abrir…',
    menuSave: 'Salvar',
    menuSaveAs: 'Salvar Como…',
    menuClose: 'Fechar',
    menuEdit: 'Editar',
    menuWindow: 'Janela',
    menuHome: 'Início',
    backToHome: 'Voltar ao início',
    dlgOpenTitle: 'Abrir arquivo',
    filterSupported: 'Arquivos compatíveis',
    filterWord: 'Documentos do Word',
    filterExcel: 'Pastas de trabalho do Excel',
    filterPpt: 'Apresentações do PowerPoint',
    filterPdf: 'Documentos PDF',
    errBadArgs: 'Argumentos inválidos',
    errBadName: 'Nome de arquivo inválido',
    errMissing: 'Arquivo não encontrado',
    errExists: 'Já existe um arquivo com esse nome',
    errRenameFailed: 'Falha ao renomear',
    errUnsupportedExt: 'arquivos .{ext} não são suportados',
    copySuffix: 'cópia',
    menuHelp: 'Ajuda',
    thirdPartyNotices: 'Avisos de software de terceiros',
    hermesGwTitle: 'Gateway Hermes',
    hermesGwBody:
      'O gateway Hermes não está em execução. Os recursos de IA do HermesOffice precisam do gateway local. Iniciar agora?',
    hermesGwStart: 'Iniciar',
    hermesGwNotNow: 'Agora não',
    hermesGwNever: 'Não perguntar novamente',
    hermesGwAlways: 'Sempre iniciar automaticamente',
    hermesGwFailed: 'Falha ao iniciar o gateway; execute hermes gateway start em um terminal.',
  },
  it: {
    menuFile: 'File',
    menuSectionNew: 'Nuovo',
    menuNewDoc: 'AI Docs',
    menuNewSheet: 'AI Sheets',
    untitledSheet: 'Foglio di calcolo senza titolo',
    untitledDoc: 'Documento senza titolo',
    untitledDeck: 'Presentazione senza titolo',
    menuNewSlide: 'AI Slides',
    menuOpen: 'Apri…',
    menuSave: 'Salva',
    menuSaveAs: 'Salva con nome…',
    menuClose: 'Chiudi',
    menuEdit: 'Modifica',
    menuWindow: 'Finestra',
    menuHome: 'Home',
    backToHome: 'Torna alla Home',
    dlgOpenTitle: 'Apri file',
    filterSupported: 'File supportati',
    filterWord: 'Documenti Word',
    filterExcel: 'Cartelle di lavoro Excel',
    filterPpt: 'Presentazioni PowerPoint',
    filterPdf: 'Documenti PDF',
    errBadArgs: 'Argomenti non validi',
    errBadName: 'Nome file non valido',
    errMissing: 'File non trovato',
    errExists: 'Esiste già un file con questo nome',
    errRenameFailed: 'Impossibile rinominare',
    errUnsupportedExt: 'i file .{ext} non sono supportati',
    copySuffix: 'copia',
    menuHelp: 'Aiuto',
    thirdPartyNotices: 'Note sul software di terze parti',
    hermesGwTitle: 'Gateway Hermes',
    hermesGwBody:
      'Il gateway Hermes non è in esecuzione. Le funzioni IA di HermesOffice lo richiedono. Avviarlo ora?',
    hermesGwStart: 'Avvia',
    hermesGwNotNow: 'Non ora',
    hermesGwNever: 'Non chiedere più',
    hermesGwAlways: 'Avvia sempre automaticamente',
    hermesGwFailed: 'Avvio del gateway non riuscito; esegui hermes gateway start in un terminale.',
  },
  pl: {
    menuFile: 'Plik',
    menuSectionNew: 'Nowy',
    menuNewDoc: 'AI Docs',
    menuNewSheet: 'AI Sheets',
    untitledSheet: 'Arkusz bez tytułu',
    untitledDoc: 'Dokument bez tytułu',
    untitledDeck: 'Prezentacja bez tytułu',
    menuNewSlide: 'AI Slides',
    menuOpen: 'Otwórz…',
    menuSave: 'Zapisz',
    menuSaveAs: 'Zapisz jako…',
    menuClose: 'Zamknij',
    menuEdit: 'Edycja',
    menuWindow: 'Okno',
    menuHome: 'Strona główna',
    backToHome: 'Wróć do strony głównej',
    dlgOpenTitle: 'Otwieranie pliku',
    filterSupported: 'Obsługiwane pliki',
    filterWord: 'Dokumenty programu Word',
    filterExcel: 'Skoroszyty programu Excel',
    filterPpt: 'Prezentacje programu PowerPoint',
    filterPdf: 'Dokumenty PDF',
    errBadArgs: 'Nieprawidłowe argumenty',
    errBadName: 'Nieprawidłowa nazwa pliku',
    errMissing: 'Nie znaleziono pliku',
    errExists: 'Plik o tej nazwie już istnieje',
    errRenameFailed: 'Nie udało się zmienić nazwy',
    errUnsupportedExt: 'pliki .{ext} nie są obsługiwane',
    copySuffix: 'kopia',
    menuHelp: 'Pomoc',
    thirdPartyNotices: 'Informacje o oprogramowaniu innych firm',
    hermesGwTitle: 'Brama Hermes',
    hermesGwBody:
      'Brama Hermes nie działa. Funkcje AI HermesOffice wymagają lokalnej bramy. Uruchomić ją teraz?',
    hermesGwStart: 'Uruchom',
    hermesGwNotNow: 'Nie teraz',
    hermesGwNever: 'Nie pytaj ponownie',
    hermesGwAlways: 'Zawsze uruchamiaj automatycznie',
    hermesGwFailed: 'Nie udało się uruchomić bramy; wykonaj hermes gateway start w terminalu.',
  },
  nl: {
    menuFile: 'Bestand',
    menuSectionNew: 'Nieuw',
    menuNewDoc: 'AI Docs',
    menuNewSheet: 'AI Sheets',
    untitledSheet: 'Naamloze spreadsheet',
    untitledDoc: 'Naamloos document',
    untitledDeck: 'Naamloze presentatie',
    menuNewSlide: 'AI Slides',
    menuOpen: 'Openen…',
    menuSave: 'Opslaan',
    menuSaveAs: 'Opslaan als…',
    menuClose: 'Sluiten',
    menuEdit: 'Bewerken',
    menuWindow: 'Venster',
    menuHome: 'Start',
    backToHome: 'Terug naar start',
    dlgOpenTitle: 'Bestand openen',
    filterSupported: 'Ondersteunde bestanden',
    filterWord: 'Word-documenten',
    filterExcel: 'Excel-werkmappen',
    filterPpt: 'PowerPoint-presentaties',
    filterPdf: 'PDF-documenten',
    errBadArgs: 'Ongeldige argumenten',
    errBadName: 'Ongeldige bestandsnaam',
    errMissing: 'Bestand niet gevonden',
    errExists: 'Er bestaat al een bestand met die naam',
    errRenameFailed: 'Naam wijzigen mislukt',
    errUnsupportedExt: '.{ext}-bestanden worden niet ondersteund',
    copySuffix: 'kopie',
    menuHelp: 'Help',
    thirdPartyNotices: 'Kennisgevingen over software van derden',
    hermesGwTitle: 'Hermes-gateway',
    hermesGwBody:
      'De Hermes-gateway draait niet. De AI-functies van HermesOffice hebben de lokale gateway nodig. Nu starten?',
    hermesGwStart: 'Starten',
    hermesGwNotNow: 'Niet nu',
    hermesGwNever: 'Niet meer vragen',
    hermesGwAlways: 'Altijd automatisch starten',
    hermesGwFailed:
      'Het starten van de gateway is mislukt; voer hermes gateway start uit in een terminal.',
  },
  ms: {
    menuFile: 'Fail',
    menuSectionNew: 'Baharu',
    menuNewDoc: 'AI Docs',
    menuNewSheet: 'AI Sheets',
    untitledSheet: 'Hamparan tanpa tajuk',
    untitledDoc: 'Dokumen tanpa tajuk',
    untitledDeck: 'Persembahan tanpa tajuk',
    menuNewSlide: 'AI Slides',
    menuOpen: 'Buka…',
    menuSave: 'Simpan',
    menuSaveAs: 'Simpan Sebagai…',
    menuClose: 'Tutup',
    menuEdit: 'Edit',
    menuWindow: 'Tetingkap',
    menuHome: 'Laman Utama',
    backToHome: 'Kembali ke Laman Utama',
    dlgOpenTitle: 'Buka Fail',
    filterSupported: 'Fail yang Disokong',
    filterWord: 'Dokumen Word',
    filterExcel: 'Buku Kerja Excel',
    filterPpt: 'Persembahan PowerPoint',
    filterPdf: 'Dokumen PDF',
    errBadArgs: 'Argumen tidak sah',
    errBadName: 'Nama fail tidak sah',
    errMissing: 'Fail tidak ditemui',
    errExists: 'Fail dengan nama yang sama sudah wujud',
    errRenameFailed: 'Gagal menamakan semula',
    errUnsupportedExt: 'fail .{ext} tidak disokong',
    copySuffix: 'salinan',
    menuHelp: 'Bantuan',
    thirdPartyNotices: 'Notis Perisian Pihak Ketiga',
    hermesGwTitle: 'Gateway Hermes',
    hermesGwBody:
      'Gateway Hermes tidak berjalan. Ciri AI HermesOffice memerlukan gateway setempat. Mulakan sekarang?',
    hermesGwStart: 'Mula',
    hermesGwNotNow: 'Bukan sekarang',
    hermesGwNever: 'Jangan tanya lagi',
    hermesGwAlways: 'Sentiasa mula secara automatik',
    hermesGwFailed: 'Gateway gagal dimulakan; jalankan hermes gateway start dalam terminal.',
  },
  he: {
    menuFile: 'קובץ',
    menuSectionNew: 'חדש',
    menuNewDoc: 'AI Docs',
    menuNewSheet: 'AI Sheets',
    untitledSheet: 'גיליון אלקטרוני ללא שם',
    untitledDoc: 'מסמך ללא שם',
    untitledDeck: 'מצגת ללא שם',
    menuNewSlide: 'AI Slides',
    menuOpen: 'פתיחה…',
    menuSave: 'שמירה',
    menuSaveAs: 'שמירה בשם…',
    menuClose: 'סגירה',
    menuEdit: 'עריכה',
    menuWindow: 'חלון',
    menuHome: 'דף הבית',
    backToHome: 'חזרה לדף הבית',
    dlgOpenTitle: 'פתיחת קובץ',
    filterSupported: 'קבצים נתמכים',
    filterWord: 'מסמכי Word',
    filterExcel: 'חוברות עבודה של Excel',
    filterPpt: 'מצגות PowerPoint',
    filterPdf: 'מסמכי PDF',
    errBadArgs: 'ארגומנטים לא חוקיים',
    errBadName: 'שם קובץ לא חוקי',
    errMissing: 'הקובץ לא נמצא',
    errExists: 'כבר קיים קובץ באותו שם',
    errRenameFailed: 'שינוי השם נכשל',
    errUnsupportedExt: 'קובצי .{ext} אינם נתמכים',
    copySuffix: 'עותק',
    menuHelp: 'עזרה',
    thirdPartyNotices: 'הודעות על תוכנות צד שלישי',
    hermesGwTitle: 'שער Hermes',
    hermesGwBody:
      'שער Hermes אינו פועל. תכונות ה-AI של HermesOffice זקוקות לשער המקומי. להפעיל עכשיו?',
    hermesGwStart: 'הפעל',
    hermesGwNotNow: 'לא עכשיו',
    hermesGwNever: 'אל תשאל שוב',
    hermesGwAlways: 'הפעל תמיד אוטומטית',
    hermesGwFailed: 'הפעלת השער נכשלה; הריצו hermes gateway start בטרמינל.',
  },
  hi: {
    menuFile: 'फ़ाइल',
    menuSectionNew: 'नया',
    menuNewDoc: 'AI Docs',
    menuNewSheet: 'AI Sheets',
    untitledSheet: 'शीर्षकहीन स्प्रेडशीट',
    untitledDoc: 'बिना शीर्षक दस्तावेज़',
    untitledDeck: 'बिना शीर्षक प्रस्तुति',
    menuNewSlide: 'AI Slides',
    menuOpen: 'खोलें…',
    menuSave: 'सहेजें',
    menuSaveAs: 'इस रूप में सहेजें…',
    menuClose: 'बंद करें',
    menuEdit: 'संपादन',
    menuWindow: 'विंडो',
    menuHome: 'होम',
    backToHome: 'होम पर वापस जाएँ',
    dlgOpenTitle: 'फ़ाइल खोलें',
    filterSupported: 'समर्थित फ़ाइलें',
    filterWord: 'Word दस्तावेज़',
    filterExcel: 'Excel वर्कबुक',
    filterPpt: 'PowerPoint प्रस्तुतियाँ',
    filterPdf: 'PDF दस्तावेज़',
    errBadArgs: 'अमान्य आर्ग्युमेंट',
    errBadName: 'अमान्य फ़ाइल नाम',
    errMissing: 'फ़ाइल नहीं मिली',
    errExists: 'इस नाम की फ़ाइल पहले से मौजूद है',
    errRenameFailed: 'नाम बदलने में विफल',
    errUnsupportedExt: '.{ext} फ़ाइलें समर्थित नहीं हैं',
    copySuffix: 'प्रतिलिपि',
    menuHelp: 'सहायता',
    thirdPartyNotices: 'तृतीय-पक्ष सॉफ़्टवेयर सूचनाएँ',
    hermesGwTitle: 'Hermes गेटवे',
    hermesGwBody:
      'Hermes गेटवे नहीं चल रहा है। HermesOffice की AI सुविधाओं को स्थानीय गेटवे चाहिए। अभी शुरू करें?',
    hermesGwStart: 'शुरू करें',
    hermesGwNotNow: 'अभी नहीं',
    hermesGwNever: 'फिर न पूछें',
    hermesGwAlways: 'हमेशा स्वतः शुरू करें',
    hermesGwFailed: 'गेटवे शुरू नहीं हो सका; टर्मिनल में hermes gateway start चलाएँ।',
  },
  'zh-TW': {
    menuFile: '檔案',
    menuSectionNew: '新增',
    menuNewDoc: 'AI Docs',
    menuNewSheet: 'AI Sheets',
    untitledSheet: '未命名試算表',
    untitledDoc: '未命名文件',
    untitledDeck: '未命名簡報',
    menuNewSlide: 'AI Slides',
    menuOpen: '開啟…',
    menuSave: '儲存',
    menuSaveAs: '另存新檔…',
    menuClose: '關閉',
    menuEdit: '編輯',
    menuWindow: '視窗',
    menuHome: '首頁',
    backToHome: '返回首頁',
    dlgOpenTitle: '開啟檔案',
    filterSupported: '支援的檔案',
    filterWord: 'Word 文件',
    filterExcel: 'Excel 活頁簿',
    filterPpt: 'PowerPoint 簡報',
    filterPdf: 'PDF 文件',
    errBadArgs: '參數無效',
    errBadName: '檔案名稱不合法',
    errMissing: '檔案不存在',
    errExists: '同名檔案已存在',
    errRenameFailed: '重新命名失敗',
    errUnsupportedExt: '暫不支援 .{ext} 類型',
    copySuffix: '副本',
    menuHelp: '說明',
    thirdPartyNotices: '第三方軟體聲明',
    hermesGwTitle: 'Hermes 閘道',
    hermesGwBody: 'Hermes 閘道未在執行。HermesOffice 的 AI 功能需要本機閘道。現在啟動嗎？',
    hermesGwStart: '啟動',
    hermesGwNotNow: '暫不',
    hermesGwNever: '不再詢問',
    hermesGwAlways: '總是自動啟動',
    hermesGwFailed: '閘道啟動失敗，請在終端機手動執行 hermes gateway start。',
  },
})

const tm = (key: Parameters<typeof tMain>[1], params?: Parameters<typeof tMain>[2]) =>
  tMain(currentLang(), key, params)

// ---- the shell window + its tab manager (recreated if the user closes it on macOS) ----

let shellWindow: BrowserWindow | null = null
let tabManager: TabManager | null = null

/**
 * When the user creates a file from a specific project view, remember which
 * project the next save should belong to. key: 'doc' | 'sheet' | 'slide', value: projectId.
 * Consumed by each app's saveHook once the file first hits disk (P1 item 3).
 */
const pendingNewFileProject = new Map<string, string>()

/**
 * P1: after a file first hits disk, if a pending project was set earlier via
 * "create from project view", move the new file into that project automatically.
 * Called from createShellWindow's opened/saved hooks.
 */
function applyPendingProject(filePath: string): void {
  const ext = extname(filePath).slice(1).toLowerCase()
  let key: string | undefined
  if (ext === 'docx') key = 'doc'
  else if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') key = 'sheet'
  else if (ext === 'pptx') key = 'slide'
  if (!key) return
  const projectId = pendingNewFileProject.get(key)
  if (!projectId) return
  pendingNewFileProject.delete(key)
  try {
    const store = new ProjectStore(app.getPath('userData'))
    store.ensureDefaultProject()
    store.resolveProjectForFile(filePath) // assign to default first (idempotent)
    store.moveFileToProject(filePath, projectId)
  } catch (err) {
    console.warn('[shell] applyPendingProject failed:', err)
  }
}

function applyMenuFor(kind: TabKind): void {
  switch (kind) {
    case 'docs':
      buildDocsMenu()
      break
    case 'sheets':
      installSheetsMenu()
      break
    case 'slides':
      installSlidesMenu()
      break
    case 'pdf':
      buildPdfMenu()
      break
    default:
      buildHomeMenu()
  }
}

function createShellWindow(): void {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 600,
    title: 'HermesOffice',
    // vibrancy: editor modules punch translucent regions (e.g. the slides
    // thumbnail pane) through to the desktop
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, vibrancy: 'sidebar' as const }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  shellWindow = win

  const manager = new TabManager(
    win,
    () => win.webContents.send(TABS_CHANNELS.changed, manager.list()),
    applyMenuFor,
    // no extension: these tabs have no file on disk yet; the title becomes the
    // real filename (the localized untitled default + .docx etc.) once the first save lands
    (kind) =>
      kind === 'docs'
        ? tm('untitledDoc')
        : kind === 'slides'
          ? tm('untitledDeck')
          : tm('untitledSheet'),
  )
  tabManager = manager

  // pushRecent-triggered docs menu rebuilds must not clobber the active tab's menu
  setDocsMenuGate(() => manager.list().some((t) => t.active && t.kind === 'docs'))

  setDocsShellWindow(win)
  setSheetsShellWindow(win)
  setSlidesShellWindow(win)
  setDocsShellHooks({
    openTab: (openPath, options) => manager.openDocsTab(openPath, options),
    listTabs: () =>
      manager
        .list()
        .filter((t) => t.kind === 'docs')
        .map((t) => ({ id: t.id, title: t.title, focused: t.active })),
    focusTab: (id) => manager.activateTab(id),
    closeActiveTab: () => manager.closeActiveTab(),
  })
  setSheetsCloseTabHook(() => manager.closeActiveTab())
  setSlidesCloseTabHook(() => manager.closeActiveTab())
  // When ⌘O opens a file inside a tab, sync the tab title/path (used for de-dup by path) and record it as recent.
  // The first save / save-as fires this too, so applyPendingProject also runs here.
  setSheetsWorkbookOpenedHook((wc, path) => {
    manager.setTabFileFor(wc.id, path)
    recordRecentFile(path)
    applyPendingProject(path)
  })
  setSlidesOpenedHook((wc, path) => {
    manager.setTabFileFor(wc.id, path)
    recordRecentFile(path)
    applyPendingProject(path)
  })
  // docs' save-as / silent first save lands on a new path → sync the tab title too
  setDocsFileSavedHook((wc, path) => {
    manager.setTabFileFor(wc.id, path)
    recordRecentFile(path)
    applyPendingProject(path)
  })

  // Closing the whole window walks every dirty sheets/pdf/slides/docs tab through
  // the same save/don't-save/cancel prompt; any cancel aborts the close.
  // docs dirtiness lives renderer-side, so any live docs tab forces the async path
  // and gets queried there (clean tabs pass through without activation).
  let closeConfirmed = false
  win.on('close', (event) => {
    if (closeConfirmed) return
    const dirtySheets = manager.dirtySheetsTabs()
    const dirtyPdf = manager.dirtyPdfTabs()
    const dirtySlides = manager.dirtySlidesTabs()
    const docsTabs = manager.docsTabs()
    if (
      dirtySheets.length === 0 &&
      dirtyPdf.length === 0 &&
      dirtySlides.length === 0 &&
      docsTabs.length === 0
    )
      return
    event.preventDefault()
    void (async () => {
      for (const tab of dirtySheets) {
        manager.activateTab(tab.id)
        if (!(await requestSheetsClose(tab.webContents, win))) return
      }
      for (const tab of dirtyPdf) {
        manager.activateTab(tab.id)
        if (!(await requestPdfClose(tab.webContents, win))) return
      }
      for (const tab of dirtySlides) {
        manager.activateTab(tab.id)
        if (!(await requestSlidesClose(tab.webContents, win))) return
      }
      for (const tab of docsTabs) {
        if (!(await docsQueryDirty(tab.webContents))) continue
        manager.activateTab(tab.id)
        if (!(await requestDocsClose(tab.webContents, win))) return
      }
      closeConfirmed = true
      if (!win.isDestroyed()) win.close()
    })()
  })

  win.on('closed', () => {
    if (shellWindow === win) shellWindow = null
    if (tabManager === manager) tabManager = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ---- routing: one dispatch function for every open path ----

const DOCX_RE = /\.docx$/i
const XLSX_RE = /\.(xlsx|xls|csv)$/i
const PPTX_RE = /\.pptx$/i
const PDF_RE = /\.pdf$/i

/** document formats we recognize but don't open — surfaced as a dialog, not silently dropped */
const UNSUPPORTED_DOC_RE = /\.(doc|rtf|odt|ppt|pps|odp|ods|xlsm|xlsb|pages|key|numbers)$/i

/**
 * Single source of truth for the open-dialog filter. Includes the
 * legacy .doc/.ppt binaries so they are selectable and surface the explicit
 * "not supported" dialog via openDocumentPath instead of being grayed out.
 */
const OPEN_DIALOG_EXTENSIONS = ['docx', 'doc', 'xlsx', 'xls', 'csv', 'pptx', 'ppt', 'pdf']

function supportedFileIn(argv: string[]): string | null {
  return (
    argv.find(
      (arg) =>
        (DOCX_RE.test(arg) || XLSX_RE.test(arg) || PPTX_RE.test(arg) || PDF_RE.test(arg)) &&
        existsSync(arg),
    ) ?? null
  )
}

function unsupportedFileIn(argv: string[]): string | null {
  return argv.find((arg) => UNSUPPORTED_DOC_RE.test(arg) && existsSync(arg)) ?? null
}

function notifyUnsupportedFile(filePath: string): void {
  const ext = extname(filePath).slice(1).toLowerCase() || basename(filePath)
  const options = { type: 'warning' as const, message: tm('errUnsupportedExt', { ext }) }
  if (shellWindow) {
    shellWindow.show()
    shellWindow.focus()
    void dialog.showMessageBox(shellWindow, options)
  } else {
    void dialog.showMessageBox(options)
  }
}

/** the single router: extension decides which module owns the file; false = nothing opened */
function openDocumentPath(filePath: string): boolean {
  if (!existsSync(filePath) || !tabManager) return false
  if (DOCX_RE.test(filePath)) {
    recordRecentFile(filePath)
    const existing = tabManager.findDocsTabByPath(filePath)
    if (existing) tabManager.activateTab(existing)
    else tabManager.openDocsTab(filePath)
    return true
  }
  if (XLSX_RE.test(filePath)) {
    recordRecentFile(filePath)
    const existing = tabManager.findSheetsTabByPath(filePath)
    if (existing) {
      tabManager.activateTab(existing)
    } else {
      setForcedWorkbookPath(filePath)
      tabManager.openSheetsTab(filePath)
      startQueuedWorkbookNudge()
    }
    return true
  }
  if (PPTX_RE.test(filePath)) {
    recordRecentFile(filePath)
    const existing = tabManager.findSlidesTabByPath(filePath)
    if (existing) {
      tabManager.activateTab(existing)
    } else {
      // For a new tab the path goes through the pending queue; the renderer consumes it after mounting
      tabManager.openSlidesTab(filePath)
    }
    return true
  }
  if (PDF_RE.test(filePath)) {
    recordRecentFile(filePath)
    const existing = tabManager.findPdfTabByPath(filePath)
    if (existing) tabManager.activateTab(existing)
    else tabManager.openPdfTab(filePath)
    return true
  }
  notifyUnsupportedFile(filePath)
  return false
}

/**
 * "New spreadsheet" creates the backing .xlsx in the default folder up front and
 * opens it as a regular file tab — the blank in-memory demo mode has no save
 * pipeline, so the file must exist before edits. Falls back to the old blank
 * tab if the write fails.
 */
async function newSheetTab(): Promise<void> {
  try {
    const filePath = uniquePathIn(defaultSaveDir(), `${tm('untitledSheet')}.xlsx`)
    writeFileSync(filePath, await blankXlsxBuffer())
    // eligible for content-derived auto-rename after the first AI generation
    markSheetsUntitledPath(filePath)
    openDocumentPath(filePath)
  } catch (err) {
    console.warn('[shell] blank workbook create failed, opening in-memory blank tab:', err)
    tabManager?.openSheetsTab(undefined, { newBlank: true })
  }
}

/**
 * The sheets renderer subscribes to menu actions only after Univer finishes
 * mounting (seconds on cold start), so a single 'open' can fire into the
 * void. Re-send until the queued workbook is consumed; consumption clears the
 * queue flag main-side (sheets-main), which stops the loop.
 */
let workbookNudgeTimer: ReturnType<typeof setInterval> | null = null

function startQueuedWorkbookNudge(): void {
  if (workbookNudgeTimer) clearInterval(workbookNudgeTimer)
  const startedAt = Date.now()
  sendSheetsMenuAction('open')
  workbookNudgeTimer = setInterval(() => {
    if (!hasQueuedWorkbook() || Date.now() - startedAt > 30_000 || !tabManager?.findSheetsTab()) {
      if (workbookNudgeTimer) clearInterval(workbookNudgeTimer)
      workbookNudgeTimer = null
      return
    }
    sendSheetsMenuAction('open')
  }, 700)
}

// ---- home IPC ----

function statEntries(paths: string[]): RecentEntry[] {
  return statExistingPaths(paths, new Set(readStarredFiles()))
}

function registerHomeIpc(): void {
  // Fork: "conta" = gateway Hermes local (API server :8642). Nada de login
  // Hermes — o status reflete a disponibilidade do agente Hermes.
  ipcMain.handle(HOME_CHANNELS.accountStatus, async () => {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 1500)
      const resp = await fetch('http://127.0.0.1:8642/health', { signal: ctrl.signal })
      clearTimeout(t)
      if (resp.ok) {
        const json = await resp.json().catch(() => null)
        return { loggedIn: true, email: `Hermes ${json?.version ?? ''}`.trim() }
      }
      return { loggedIn: false }
    } catch {
      return { loggedIn: false }
    }
  })

  // Fork: sem fluxo de login em browser — o "login" apenas re-checa o gateway
  ipcMain.handle(HOME_CHANNELS.accountLogin, async () => {
    return null
  })

  ipcMain.handle(HOME_CHANNELS.accountLogout, async () => {
    // Fork: não há conta remota para encerrar sessão
  })

  ipcMain.handle(HOME_CHANNELS.getAppVersion, (): string => app.getVersion())

  ipcMain.handle(HOME_CHANNELS.recents, (_event, query: unknown): RecentPage =>
    pageRecentPaths(readRecentFiles(), query, new Set(readStarredFiles())),
  )

  // Starred files sort by mtime, which requires stat-ing them all first; they are hand-picked and few, so this is fine
  ipcMain.handle(HOME_CHANNELS.starred, (_event, query: unknown): RecentPage => {
    const { offset, limit, ext } = normalizeRecentQuery(query)
    const all = statEntries(readStarredFiles()).sort((a, b) => b.mtimeMs - a.mtimeMs)
    const filtered = ext ? all.filter((entry) => entry.ext === ext) : all
    return {
      entries: limit === 0 ? [] : filtered.slice(offset, offset + limit),
      total: filtered.length,
      totalAll: all.length,
    }
  })

  ipcMain.handle(HOME_CHANNELS.statPaths, (_event, paths: unknown): RecentEntry[] =>
    statEntries(stringPaths(paths)),
  )

  ipcMain.handle(HOME_CHANNELS.toggleStar, (_event, path: unknown) => {
    if (typeof path === 'string') toggleStarredFile(path)
  })

  ipcMain.handle(HOME_CHANNELS.openPath, (_event, path: unknown) => {
    if (typeof path === 'string') openDocumentPath(path)
  })

  ipcMain.handle(HOME_CHANNELS.browse, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? shellWindow
    if (!win) return
    const result = await dialog.showOpenDialog(win, {
      title: tm('dlgOpenTitle'),
      filters: [
        { name: tm('filterSupported'), extensions: OPEN_DIALOG_EXTENSIONS },
        { name: tm('filterWord'), extensions: ['docx', 'doc'] },
        { name: tm('filterExcel'), extensions: ['xlsx', 'xls', 'csv'] },
        { name: tm('filterPpt'), extensions: ['pptx', 'ppt'] },
        { name: tm('filterPdf'), extensions: ['pdf'] },
      ],
      properties: ['openFile'],
    })
    if (!result.canceled && result.filePaths[0]) openDocumentPath(result.filePaths[0])
  })

  ipcMain.handle(HOME_CHANNELS.newDoc, (_event, opts?: { projectId?: string }) => {
    if (opts?.projectId && opts.projectId !== 'default') {
      pendingNewFileProject.set('doc', opts.projectId)
    }
    tabManager?.openDocsTab(undefined, { newBlank: true })
  })

  ipcMain.handle(HOME_CHANNELS.newSheet, (_event, opts?: { projectId?: string }) => {
    if (opts?.projectId && opts.projectId !== 'default') {
      pendingNewFileProject.set('sheet', opts.projectId)
    }
    void newSheetTab()
  })

  ipcMain.handle(HOME_CHANNELS.newSlide, (_event, opts?: { projectId?: string }) => {
    if (opts?.projectId && opts.projectId !== 'default') {
      pendingNewFileProject.set('slide', opts.projectId)
    }
    tabManager?.openSlidesTab()
  })

  ipcMain.handle(HOME_CHANNELS.removeRecent, (_event, paths: unknown) => {
    removeRecentFiles(stringPaths(paths))
  })

  ipcMain.handle(HOME_CHANNELS.revealPath, (_event, path: unknown) => {
    if (typeof path === 'string' && existsSync(path)) shell.showItemInFolder(path)
  })

  ipcMain.handle(
    HOME_CHANNELS.renameFile,
    (_event, path: unknown, newName: unknown): RenameResult => {
      if (typeof path !== 'string' || typeof newName !== 'string')
        return { ok: false, error: tm('errBadArgs') }
      const name = newName.trim()
      if (!name || /[\\/:]/.test(name)) return { ok: false, error: tm('errBadName') }
      if (!existsSync(path)) return { ok: false, error: tm('errMissing') }
      const target = join(dirname(path), name)
      if (target === path) return { ok: true, path }
      if (existsSync(target)) return { ok: false, error: tm('errExists') }
      try {
        renameSync(path, target)
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : tm('errRenameFailed') }
      }
      replaceRecentFile(path, target)
      // project-store's fileMap/chatIdByPath re-key too, so AI chat history follows the file
      projectFileRenamed(path, target)
      // the slides module's own recent list switches to the new path as well (used by the start screen)
      if (/\.pptx$/i.test(target)) void replaceSlidesRecentFile(path, target)
      // open tabs sync their title/path; each editor then syncs its internal save path and title bar
      const affected = tabManager?.renameTabFile(path, target) ?? []
      for (const t of affected) {
        if (t.kind === 'slides') slidesFileRenamed(t.webContents, path, target)
        else if (t.kind === 'docs') docsFileRenamed(t.webContents, path, target)
        else if (t.kind === 'sheets') sheetsFileRenamed(t.webContents, path, target)
      }
      return { ok: true, path: target }
    },
  )

  ipcMain.handle(HOME_CHANNELS.duplicateFile, (_event, path: unknown) => {
    if (typeof path !== 'string' || !existsSync(path)) return
    const ext = extname(path)
    const base = basename(path, ext)
    const dir = dirname(path)
    for (let i = 1; ; i++) {
      const target = join(dir, `${base} ${tm('copySuffix')}${i === 1 ? '' : ` ${i}`}${ext}`)
      if (existsSync(target)) continue
      copyFileSync(path, target)
      recordRecentFile(target)
      return
    }
  })

  ipcMain.handle(HOME_CHANNELS.deleteFiles, async (_event, paths: unknown) => {
    const list = stringPaths(paths)
    for (const p of list) {
      try {
        await shell.trashItem(p)
      } catch {
        // file already gone or trash unavailable; still drop it from the list
      }
    }
    removeRecentFiles(list)
  })

  ipcMain.handle(HOME_CHANNELS.openTrash, () => {
    if (process.platform === 'darwin') {
      void shell.openPath(join(app.getPath('home'), '.Trash'))
    } else if (process.platform === 'win32') {
      spawn('explorer.exe', ['shell:RecycleBin'], { detached: true }).unref()
    } else {
      void shell.openPath(join(app.getPath('home'), '.local', 'share', 'Trash', 'files'))
    }
  })

  ipcMain.handle(HOME_CHANNELS.getLanguage, (): Lang => currentLang())

  ipcMain.handle(HOME_CHANNELS.setLanguage, (_event, lang: unknown) => {
    if (!isLang(lang) || lang === currentLang()) return
    persistLang(lang)
    // the switcher lives on the home page, so the home menu is the active one
    buildHomeMenu()
    installDockMenu()
    installBackToHomeItems()
    for (const wc of webContents.getAllWebContents()) wc.send('app:language-changed', lang)
  })

  ipcMain.handle(
    HOME_CHANNELS.onboardingSeen,
    (): boolean => readAppSettings(APP_SETTINGS_PATH()).onboardingSeen === true,
  )

  ipcMain.handle(HOME_CHANNELS.setOnboardingSeen, () => {
    writeAppSetting(APP_SETTINGS_PATH(), 'onboardingSeen', true)
  })

  ipcMain.handle(HOME_CHANNELS.openGenTeam, () => {
    shell.openExternal(GENTEAM_URL).catch(() => {
      // no browser handler available; nothing actionable for the user here
    })
  })

  // Fork onboarding: live gateway status for the "Connect to Hermes" slide
  ipcMain.handle(HOME_CHANNELS.hermesStatus, async (): Promise<'ok' | 'offline'> => {
    try {
      const response = await fetch(hermesHealthUrl(''), { signal: AbortSignal.timeout(2000) })
      return response.ok ? 'ok' : 'offline'
    } catch {
      return 'offline'
    }
  })
}

function stringPaths(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string') : []
}

// electron-vite emits ?asset files under hashed names, which breaks nativeImage's
// automatic `@2x` sibling lookup — attach the retina representation by hand
function loadMenuIcon(path1x: string, path2x: string): NativeImage {
  const icon = nativeImage.createFromPath(path1x)
  icon.addRepresentation({ scaleFactor: 2, buffer: readFileSync(path2x) })
  return icon
}

// loaded once, not on every menu open
let menuIconCache: { docx: NativeImage; xlsx: NativeImage; pptx: NativeImage } | null = null
function menuIcons(): { docx: NativeImage; xlsx: NativeImage; pptx: NativeImage } {
  menuIconCache ??= {
    docx: loadMenuIcon(menuDocxIcon1x, menuDocxIcon2x),
    xlsx: loadMenuIcon(menuXlsxIcon1x, menuXlsxIcon2x),
    pptx: loadMenuIcon(menuPptxIcon1x, menuPptxIcon2x),
  }
  return menuIconCache
}

function registerTabsIpc(): void {
  ipcMain.handle(TABS_CHANNELS.list, () => tabManager?.list() ?? [])
  ipcMain.handle(TABS_CHANNELS.activate, (_event, id: string) => tabManager?.activateTab(id))
  ipcMain.handle(TABS_CHANNELS.close, (_event, id: string) => tabManager?.closeTab(id))
  ipcMain.handle(TABS_CHANNELS.reorder, (_event, id: string, toIndex: number) => {
    if (typeof id === 'string' && Number.isInteger(toIndex)) tabManager?.reorderTab(id, toIndex)
  })
  // "all tabs" overflow menu — native popup because the editors' WebContentsView
  // would cover any DOM dropdown the shell renderer draws below the tab strip
  ipcMain.handle(TABS_CHANNELS.showMenu, (_event, x: unknown, y: unknown) => {
    if (!tabManager || !shellWindow) return
    const menu = Menu.buildFromTemplate(
      tabManager.list().map((tab) => ({
        label: tab.title,
        type: 'checkbox' as const,
        checked: tab.active,
        click: () => tabManager?.activateTab(tab.id),
      })),
    )
    menu.popup({
      window: shellWindow,
      ...(typeof x === 'number' && typeof y === 'number'
        ? { x: Math.round(x), y: Math.round(y) }
        : {}),
    })
  })
  // "+" new-file menu — native for the same reason as the tab list above
  ipcMain.handle(TABS_CHANNELS.showNewMenu, (_event, x: unknown, y: unknown) => {
    if (!tabManager || !shellWindow) return
    const menu = Menu.buildFromTemplate([
      // enabled:false so pre-Sonoma macOS / Windows (no 'header' support) degrade
      // to an inert label instead of a clickable no-op item
      { label: tm('menuSectionNew'), type: 'header', enabled: false },
      {
        label: tm('menuNewDoc'),
        icon: menuIcons().docx,
        click: () => tabManager?.openDocsTab(undefined, { newBlank: true }),
      },
      {
        label: tm('menuNewSheet'),
        icon: menuIcons().xlsx,
        click: () => void newSheetTab(),
      },
      {
        label: tm('menuNewSlide'),
        icon: menuIcons().pptx,
        click: () => tabManager?.openSlidesTab(),
      },
      { type: 'separator' },
      { label: tm('menuOpen'), click: () => void openFileViaDialog() },
    ])
    menu.popup({
      window: shellWindow,
      ...(typeof x === 'number' && typeof y === 'number'
        ? { x: Math.round(x), y: Math.round(y) }
        : {}),
    })
  })
}

// ---- home menu ----

async function openFileViaDialog(): Promise<void> {
  const win = shellWindow ?? BrowserWindow.getFocusedWindow()
  if (!win) return
  const result = await dialog.showOpenDialog(win, {
    filters: [{ name: tm('filterSupported'), extensions: OPEN_DIALOG_EXTENSIONS }],
    properties: ['openFile'],
  })
  if (!result.canceled && result.filePaths[0]) openDocumentPath(result.filePaths[0])
}

function buildHomeMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: tm('menuFile'),
      submenu: [
        { label: tm('menuSectionNew'), type: 'header', enabled: false },
        {
          label: tm('menuNewDoc'),
          accelerator: 'CmdOrCtrl+N',
          click: () => tabManager?.openDocsTab(undefined, { newBlank: true }),
        },
        {
          label: tm('menuNewSheet'),
          click: () => void newSheetTab(),
        },
        { label: tm('menuNewSlide'), click: () => tabManager?.openSlidesTab() },
        { type: 'separator' },
        {
          label: tm('menuOpen'),
          accelerator: 'CmdOrCtrl+O',
          click: () => void openFileViaDialog(),
        },
        { type: 'separator' },
        { role: 'close', label: tm('menuClose') },
      ],
    },
    { role: 'editMenu', label: tm('menuEdit') },
    { role: 'windowMenu', label: tm('menuWindow') },
    {
      role: 'help',
      label: tm('menuHelp'),
      submenu: [{ label: tm('thirdPartyNotices'), click: () => void openThirdPartyNotices() }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---- pdf menu (pdf-main has no menu of its own; the shell owns pdf tabs, so it builds one) ----

function buildPdfMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: tm('menuFile'),
      submenu: [
        {
          label: tm('menuOpen'),
          accelerator: 'CmdOrCtrl+O',
          click: () => void openFileViaDialog(),
        },
        { type: 'separator' },
        {
          label: tm('backToHome'),
          accelerator: 'Shift+CmdOrCtrl+H',
          click: () => tabManager?.openHomeTab(),
        },
        { type: 'separator' },
        {
          label: tm('menuSave'),
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            const tab = tabManager?.activePdfTab()
            if (tab) void flushPdfSave(tab.webContents)
          },
        },
        {
          label: tm('menuSaveAs'),
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => void savePdfAs(),
        },
        { type: 'separator' },
        {
          label: tm('menuClose'),
          accelerator: 'CmdOrCtrl+W',
          click: () => tabManager?.closeActiveTab(),
        },
      ],
    },
    { role: 'editMenu', label: tm('menuEdit') },
    { role: 'windowMenu', label: tm('menuWindow') },
    {
      role: 'help',
      label: tm('menuHelp'),
      submenu: [{ label: tm('thirdPartyNotices'), click: () => void openThirdPartyNotices() }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Save As for pdf tabs: flush pending edits into the original, copy it, open the copy */
async function savePdfAs(): Promise<void> {
  const tab = tabManager?.activePdfTab()
  if (!tab?.filePath || !shellWindow) return
  if (!(await flushPdfSave(tab.webContents))) return
  const picked = await dialog.showSaveDialog(shellWindow, {
    defaultPath: tab.filePath,
    filters: [{ name: tm('filterPdf'), extensions: ['pdf'] }],
  })
  if (picked.canceled || !picked.filePath || picked.filePath === tab.filePath) return
  copyFileSync(tab.filePath, picked.filePath)
  openDocumentPath(picked.filePath)
}

function openThirdPartyNotices(): Promise<string> {
  const path = app.isPackaged
    ? join(process.resourcesPath, 'THIRD-PARTY-NOTICES.txt')
    : join(app.getAppPath(), 'build', 'THIRD-PARTY-NOTICES.txt')
  return shell.openPath(path)
}

/** every module's File menu gets a way back to the launcher */
function installBackToHomeItems(): void {
  const backToHomeItem: MenuItemConstructorOptions = {
    label: tm('backToHome'),
    accelerator: 'Shift+CmdOrCtrl+H',
    click: () => tabManager?.openHomeTab(),
  }
  setDocsExtraFileMenuItems([backToHomeItem])
  setSheetsExtraFileMenuItems([backToHomeItem])
  setSlidesExtraFileMenuItems([backToHomeItem])
}

function installDockMenu(): void {
  if (process.platform !== 'darwin') return
  app.dock?.setMenu(
    Menu.buildFromTemplate([
      { label: tm('menuHome'), click: () => tabManager?.openHomeTab() },
      {
        label: tm('menuNewDoc'),
        click: () => tabManager?.openDocsTab(undefined, { newBlank: true }),
      },
      {
        label: tm('menuNewSheet'),
        click: () => void newSheetTab(),
      },
      { label: tm('menuNewSlide'), click: () => tabManager?.openSlidesTab() },
    ]),
  )
}

// On mainland-China networks the main process's Node fetch (undici) bypasses the system proxy,
// so direct calls to overseas LLM/image-search APIs time out or get region-blocked (403).
// Prefer proxy env vars (terminal launch); a packaged app launched from Finder inherits no shell
// env vars, so fall back to the system HTTP proxy. The renderer uses Chromium's system proxy and
// is unaffected. Same bootstrap as slides-main startSlidesStandalone.
async function installMainProcessProxy(): Promise<void> {
  let proxyUrl = [
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
    process.env.ALL_PROXY,
    process.env.all_proxy,
  ].find((v) => v && /^https?:\/\//.test(v))
  if (!proxyUrl) {
    try {
      const resolved = await session.defaultSession.resolveProxy('https://api.anthropic.com/')
      const m = /PROXY\s+([^;\s]+)/.exec(resolved)
      if (m) proxyUrl = `http://${m[1]}`
    } catch {
      /* no system proxy */
    }
  }
  if (!proxyUrl) return
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import('undici')
    setGlobalDispatcher(new ProxyAgent(proxyUrl))
    // strip user:pass credentials before logging
    console.log('[proxy] main-process fetch via', proxyUrl.replace(/\/\/[^@/]*@/, '//***@'))
  } catch (e) {
    console.warn('[proxy] failed to set ProxyAgent:', e)
  }
}

// ---- lifecycle (the shell is the only owner) ----

let pendingLaunchPath = supportedFileIn(process.argv) ?? unsupportedFileIn(process.argv)

// show() does not un-minimize, and on macOS ⌘W destroys the shell window while the
// app keeps running — either way a file opened from Finder would land out of sight.
function revealShellWindow(): void {
  if (!shellWindow) createShellWindow()
  if (shellWindow?.isMinimized()) shellWindow.restore()
  shellWindow?.show()
  shellWindow?.focus()
}

// On macOS a file opened from Finder is not in argv; it arrives via the open-file event (before ready).
// If another instance already holds the lock, this process exits, and the path must ride along in
// the lock request's additionalData to the surviving instance — so the lock request is deferred
// until ready, after the path is known.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (!app.isReady()) {
    pendingLaunchPath = filePath
    return
  }
  revealShellWindow()
  if (!openDocumentPath(filePath)) tabManager?.openHomeTab()
})

app.on('second-instance', (_event, argv, _cwd, additionalData) => {
  const file =
    supportedFileIn(argv) ??
    unsupportedFileIn(argv) ??
    (additionalData as { launchPath?: string } | null)?.launchPath
  revealShellWindow()
  if (!file || !openDocumentPath(file)) tabManager?.openHomeTab()
})

installNavigationGuard(app)
registerAiIpc()
registerProjectIpc()
registerDocsIpc()
registerHomeIpc()
registerTabsIpc()

// sheets' project:resolveChat goes through the handler registered by docs-main; the sessionId reverse lookup hooks in here
setSessionPathResolver(resolveSheetsSessionPath)

app.whenReady().then(() => {
  const hasLock = app.requestSingleInstanceLock(
    pendingLaunchPath ? { launchPath: pendingLaunchPath } : {},
  )
  if (!hasLock) {
    app.quit()
    return
  }

  void installMainProcessProxy()
  app.setAccessibilitySupportEnabled(true)
  // Settle the shared uiLang from saved settings BEFORE any tab renderer can
  // ask 'app:get-language': the editor handlers return the i18n module's
  // mutable lang, whose 'zh' default otherwise wins the race for whichever
  // tab loads first (e.g. sheets booting in Chinese while docs shows English).
  currentLang()
  startSheetsCaptureServer()
  createShellWindow()
  // deferred to ready: labels need currentLang(), which reads app.getLocale()
  installBackToHomeItems()
  installDockMenu()
  initAutoUpdater(() => shellWindow)
  initMainUpdater(() => shellWindow)
  // Fork (#7): offer to start the local Hermes gateway when it is offline (consent-gated, never blocks startup)
  void ensureHermesGateway(() => shellWindow, {
    title: tm('hermesGwTitle'),
    body: tm('hermesGwBody'),
    start: tm('hermesGwStart'),
    notNow: tm('hermesGwNotNow'),
    never: tm('hermesGwNever'),
    always: tm('hermesGwAlways'),
    failed: tm('hermesGwFailed'),
  })

  if (!pendingLaunchPath || !openDocumentPath(pendingLaunchPath)) tabManager?.openHomeTab()
  pendingLaunchPath = null

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createShellWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // No close prompt may fall through to "Save" during shutdown
  markSheetsShuttingDown()
  stopSheetsSidecar()
})
