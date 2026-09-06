import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { EngineSupervisor } from './engineSupervisor'
import { registerIpcBridge } from './ipc-bridge'

const WINDOW_TITLE = 'VanillaBus'
const supervisor = new EngineSupervisor()

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
    window.show()
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

app.whenReady().then(() => {
  registerIpcBridge(supervisor)
  supervisor.start()
  createWindow()

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
