import { test, expect } from '@playwright/test'
import { mkdtemp, writeFile, copyFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl } from './helpers'

// Deterministic real IPC recovery: no model account, credentials or network.
// The fake runtime accepts a tool-result turn and then goes silent, matching
// the observed native trace. The next thread must continue rather than edit twice.
for (const outcome of ['recover', 'exhaust', 'cancel'] as const) {
  test(`Codex silent confirmation: ${outcome} without duplicating an applied edit`, async () => {
    test.skip(process.platform === 'win32', 'Executable fixture uses a POSIX Node shebang')
    const dir = await mkdtemp(join(tmpdir(), 'hermesoffice-codex-recovery-'))
    const fixture = join(dir, 'runtime.mjs')
    const log = join(dir, 'calls.jsonl')
    await writeFile(
      fixture,
      `#!${process.execPath}
import { createInterface } from 'node:readline'
import { appendFileSync } from 'node:fs'
let threads=0, turns=0
const send = message => process.stdout.write(JSON.stringify(message)+'\\n')
createInterface({input:process.stdin}).on('line', line => {
 const msg=JSON.parse(line); const p=msg.params || {}
 appendFileSync(${JSON.stringify(log)},JSON.stringify({method:msg.method,threadId:p.threadId,nativeToolsDisabled:msg.method==='thread/start' ? p.config?.mcp_servers?.blocked?.enabled===false && p.config?.plugins?.optional?.enabled===false : undefined})+'\\n')
 if(msg.id===undefined)return
 if(msg.method==='initialize')return send({id:msg.id,result:{}})
 if(msg.method==='config/read')return send({id:msg.id,result:{config:{mcp_servers:{blocked:{enabled:true}},plugins:{optional:{enabled:true}}}}})
 if(msg.method==='thread/start') {
  return send({id:msg.id,result:{thread:{id:'thread-'+(++threads)},activePermissionProfile:{id:'hermesoffice'}}})
 }
 if(msg.method!=='turn/start')return send({id:msg.id,result:{}})
 const n=++turns, id='turn-'+n
 send({id:msg.id,result:{turn:{id,status:'inProgress'}}})
 send({method:'turn/started',params:{threadId:p.threadId,turn:{id,status:'inProgress'}}})
 if(n===2 || (${JSON.stringify(outcome === 'exhaust')} && n>=2))return
 const response=n===1 ? {text:'',toolCalls:[{id:'insert-once',name:'insert_content',inputJson:JSON.stringify({html:'<p>RECOVERY-EDIT-ONCE</p>',afterBlockIndex:-1})}]} : {text:'Recovery complete.',toolCalls:[]}
 send({method:'item/completed',params:{threadId:p.threadId,turnId:id,item:{type:'agentMessage',text:JSON.stringify(response)}}})
 send({method:'turn/completed',params:{threadId:p.threadId,turn:{id,status:'completed'}}})
})
`,
      { mode: 0o755 },
    )
    await writeFile(
      join(dir, 'ai-settings.json'),
      JSON.stringify({
        provider: 'codex',
        providers: { codex: { apiKey: '', model: 'fixture', cliPath: fixture } },
      }),
    )
    const doc = join(dir, 'recovery.docx')
    await copyFile(join(__dirname, 'assets/justify-pagegap-fr.docx'), doc)
    const launched = await launchShell({
      ...(process.env.HERMESOFFICE_TEST_EXECUTABLE
        ? { executablePath: process.env.HERMESOFFICE_TEST_EXECUTABLE }
        : {}),
      userDataDir: dir,
      onboardingSeen: true,
      openFile: doc,
      videoDir: 'codex-recovery',
      env: { APPIMAGE: 'hermesoffice-recovery-test', HERMESOFFICE_AUTH_DIR: join(dir, 'auth') },
    })
    try {
      // Accelerate only the existing 180s watchdog in this test-owned main
      // process. Production keeps its generous long-context timeout unchanged.
      await launched.app.evaluate(() => {
        const original = globalThis.setTimeout
        globalThis.setTimeout = ((handler, ms, ...args) =>
          original(handler, ms === 180_000 ? 1_000 : ms, ...args)) as typeof globalThis.setTimeout
      })
      const page = await waitForPageWithUrl(launched.app, '://docs/')
      await expect(page.locator('.ProseMirror').first()).toBeVisible()
      await page.locator('.ai-panel textarea').fill('Insert exactly one recovery paragraph.')
      await page.locator('.ai-panel textarea').press('Enter')
      await expect(
        page.locator('.ProseMirror').filter({ hasText: 'RECOVERY-EDIT-ONCE' }).first(),
      ).toBeVisible()
      if (outcome === 'cancel') {
        await expect
          .poll(async () => (await readFile(log, 'utf8')).split('"method":"turn/start"').length - 1)
          .toBe(2)
        await page.locator('.ai-stop-btn').click()
      }
      await expect(page.locator('.ai-stop-btn')).toHaveCount(0, { timeout: 45_000 })
      if (outcome === 'recover') {
        expect(await page.locator('.ai-msg-assistant').last().innerText()).toContain(
          'Recovery complete.',
        )
        await expect(page.locator('.ai-msg-error')).toHaveCount(0)
      } else if (outcome === 'exhaust') {
        await expect(page.locator('.ai-msg-error')).toBeVisible()
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1_300))
        await expect(page.locator('.ai-msg-error')).toHaveCount(0)
      }
      const content = (await page.locator('.ProseMirror').allTextContents()).join('\n')
      expect(content.match(/RECOVERY-EDIT-ONCE/g)).toHaveLength(1)
      const calls = (await readFile(log, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(calls.filter((call) => call.method === 'turn/start')).toHaveLength(
        outcome === 'cancel' ? 2 : 3,
      )
      expect(calls.filter((call) => call.method === 'thread/start')).toHaveLength(
        outcome === 'cancel' ? 1 : 2,
      )
      expect(
        calls
          .filter((call) => call.method === 'thread/start')
          .every((call) => call.nativeToolsDisabled),
      ).toBe(true)
      expect(calls.some((call) => call.method === 'turn/interrupt')).toBe(true)
      if (outcome === 'recover') {
        await page.locator('.ai-rollback-btn').last().click()
        await expect(
          page.locator('.ProseMirror').filter({ hasText: 'RECOVERY-EDIT-ONCE' }),
        ).toHaveCount(0)
      }
    } finally {
      await closeAndSaveVideo(launched, 'codex-recovery')
    }
  })
}
