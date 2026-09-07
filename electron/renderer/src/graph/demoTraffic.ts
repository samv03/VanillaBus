import type { FrameEvent, RxBatch } from '../../../../shared/engine'

/** DEV-only oscillating DBC-shaped frames so Graph can run without vcan. */
export function buildGraphDemoBatch(nowUs = Date.now() * 1000, phase = 0): RxBatch {
  const rpm = 3500 + 2200 * Math.sin(phase)
  const temp = 82 + 12 * Math.sin(phase * 0.35)
  const oil = 180 + 40 * Math.sin(phase * 0.5)
  const speed = 64 + 48 * Math.sin(phase * 0.8)

  const frames: FrameEvent[] = [
    {
      busId: 'demo',
      ifName: 'vcan0',
      ts_us: nowUs,
      can_id: 0x100,
      dlc: 8,
      data: 'e8035a0a00000000',
      is_eff: false,
      is_fd: false,
      brs: false,
      is_rtr: false,
      is_err: false,
      dir: 'rx',
      rate_ms: 10,
      decode: {
        name: 'EngineStatus',
        signals: { EngineSpeed: rpm, EngineTemp: temp, OilPressure: oil },
        units: { EngineSpeed: 'rpm', EngineTemp: 'degC', OilPressure: 'kPa' }
      }
    },
    {
      busId: 'demo',
      ifName: 'vcan0',
      ts_us: nowUs + 400,
      can_id: 0x101,
      dlc: 2,
      data: '401f',
      is_eff: false,
      is_fd: false,
      brs: false,
      is_rtr: false,
      is_err: false,
      dir: 'rx',
      rate_ms: 10,
      decode: {
        name: 'VehicleSpeed',
        signals: { Speed: Math.max(0, speed) },
        units: { Speed: 'km/h' }
      }
    }
  ]
  return { frames, dropped: 0 }
}
