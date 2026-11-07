import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appBinaryForResources } from '../src/resources'

describe('appBinaryForResources', () => {
  it('finds the app in a custom Windows install directory', () => {
    expect(appBinaryForResources(join('D:\\Apps\\HermesOffice', 'resources'), 'win32')).toBe(
      join('D:\\Apps\\HermesOffice', 'HermesOffice.exe'),
    )
  })

  it('resolves the same binary for the default Windows install directory', () => {
    const localAppData = 'C:\\Users\\test\\AppData\\Local'
    const resources = join(localAppData, 'Programs', 'HermesOffice', 'resources')
    expect(appBinaryForResources(resources, 'win32')).toBe(
      join(localAppData, 'Programs', 'HermesOffice', 'HermesOffice.exe'),
    )
  })

  it('finds the app in a custom macOS bundle location', () => {
    expect(
      appBinaryForResources(join('/Volumes/Work/HermesOffice.app/Contents/Resources'), 'darwin'),
    ).toBe(join('/Volumes/Work/HermesOffice.app/Contents/MacOS/HermesOffice'))
  })

  it('finds the app in a custom Linux prefix', () => {
    expect(appBinaryForResources(join('/opt/hermesoffice-custom/resources'), 'linux')).toBe(
      join('/opt/hermesoffice-custom/hermesoffice'),
    )
  })
})
