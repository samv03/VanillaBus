import type { FrameEvent, RxBatch } from '../../../../shared/engine'

/** DEV-only synthetic frames so Trace can be exercised without vcan. */
export function buildDemoBatch(nowUs = Date.now() * 1000): RxBatch {
  const frames: FrameEvent[] = [
    {
      busId: 'demo',
      ifName: 'vcan0',
      ts_us: nowUs,
      can_id: 0x123,
      dlc: 8,
      data: '014a00ff1200003c',
      is_eff: false,
      is_fd: false,
      brs: false,
      is_rtr: false,
      is_err: false,
      dir: 'rx',
      rate_ms: 10,
      decode: null
    },
    {
      busId: 'demo',
      ifName: 'vcan0',
      ts_us: nowUs + 20_000,
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
        signals: { EngineSpeed: 250, EngineTemp: 50, OilPressure: 20 },
        units: { EngineSpeed: 'rpm', EngineTemp: 'degC', OilPressure: 'kPa' }
      }
    },
    {
      busId: 'demo',
      ifName: 'vcan0',
      ts_us: nowUs + 40_000,
      can_id: 0x101,
      dlc: 2,
      data: '401f',
      is_eff: false,
      is_fd: false,
      brs: false,
      is_rtr: false,
      is_err: false,
      dir: 'rx',
      rate_ms: 20,
      decode: {
        name: 'VehicleSpeed',
        signals: { Speed: 80 },
        units: { Speed: 'km/h' }
      }
    },
    {
      busId: 'demo',
      ifName: 'vcan0',
      ts_us: nowUs + 55_000,
      can_id: 0x7e0,
      dlc: 8,
      data: '0222100000000000',
      is_eff: false,
      is_fd: false,
      brs: false,
      is_rtr: false,
      is_err: false,
      dir: 'tx',
      rate_ms: 50,
      decode: null
    },
    {
      busId: 'demo',
      ifName: 'vcan0',
      ts_us: nowUs + 70_000,
      can_id: 0x7ff,
      dlc: 4,
      data: 'deadbeef',
      is_eff: false,
      is_fd: false,
      brs: false,
      is_rtr: false,
      is_err: false,
      dir: 'rx',
      rate_ms: null,
      decode: null
    }
  ]
  return { frames, dropped: 0 }
}
