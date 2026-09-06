import { contextBridge } from 'electron'

/**
 * T1 preload stub. Later milestones will expose a typed IPC surface that
 * matches shared/ipc-schema.json (engine.hello, bus.*, dbc.load, rx/tx).
 * No live engine IPC is wired in T1.
 */
const api = {
  version: '0.1.0'
} as const

contextBridge.exposeInMainWorld('vanillabus', api)
