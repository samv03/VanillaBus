import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { EngineSupervisor } from './engineSupervisor'

const WINDOW_TITLE = 'VanillaBus'
const supervisor = new EngineSupervisor()

function createWindow(): void {
  const window = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 420,
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

function broadcastEngineStatus(): void {
  const status = supervisor.getStatus()
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('vanillabus:engine-status', status)
  }
}

app.whenReady().then(() => {
  ipcMain.handle('vanillabus:engine-status', () => supervisor.getStatus())
  supervisor.onStatus(() => {
    broadcastEngineStatus()
  })
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
