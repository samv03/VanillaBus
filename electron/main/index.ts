import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { EngineSupervisor } from './engineSupervisor'
import { registerIpcBridge } from './ipc-bridge'
import { persistFilePath, UserStore } from './userStore'

const WINDOW_TITLE = 'VanillaBus'
const supervisor = new EngineSupervisor()
const SMOKE = process.env.VANILLABUS_SMOKE === '1'
const SMOKE_TIMEOUT_MS = Number.parseInt(process.env.VANILLABUS_SMOKE_MS ?? '8000', 10)

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 880,
    minWidth: 880,
    minHeight: 600,
    title: WINDOW_TITLE,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.on('ready-to-show', () => {
    window.setTitle(WINDOW_TITLE)
    if (!SMOKE) {
      window.show()
    }
  })

  // Keep the product title even if the renderer document title changes.
  window.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle(WINDOW_TITLE)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function armSmokeExit(): void {
  if (!SMOKE) {
    return
  }
  const timeoutMs = Number.isFinite(SMOKE_TIMEOUT_MS) && SMOKE_TIMEOUT_MS > 0 ? SMOKE_TIMEOUT_MS : 8000
  const started = Date.now()
  const timer = setInterval(() => {
    if (supervisor.getStatus().connected) {
      clearInterval(timer)
      console.log('[smoke] engine.hello ok; exiting 0')
      app.exit(0)
      return
    }
    if (Date.now() - started >= timeoutMs) {
      clearInterval(timer)
      console.error('[smoke] timed out waiting for engine.hello')
      app.exit(1)
    }
  }, 50)
}

function createUserStore(): UserStore {
  const override = process.env.VANILLABUS_STORE_PATH
  if (typeof override === 'string' && override.length > 0) {
    return new UserStore(override)
  }
  return new UserStore(persistFilePath(app.getPath('userData')))
}

app.whenReady().then(() => {
  registerIpcBridge(supervisor, createUserStore())
  supervisor.start()
  createWindow()
  armSmokeExit()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  supervisor.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
