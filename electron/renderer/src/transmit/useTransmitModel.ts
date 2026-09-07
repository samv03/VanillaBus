import { useCallback, useState } from 'react'
import {
  isTxRawSendRequest,
  type FrameEvent,
  type RxBatch,
  type TxCyclicStartRequest,
  type TxSendRequest,
  type VanillaBusApi
} from '../../../../shared/engine'
import {
  cyclicJobDefinitionId,
  type PersistedCyclicJob,
  type PersistedDbcDraft,
  type PersistedRawDraft
} from '../../../../shared/persist'

export type CyclicJobType = 'Raw' | 'DBC'
export type CyclicJobStatus = 'Running' | 'Stopped'

export type CyclicJobRow = {
  readonly jobId: string
  readonly type: CyclicJobType
  readonly busId: string
  readonly ifName: string
  readonly canId: number
  readonly isEff: boolean
  readonly data: string
  readonly message?: string
  readonly periodMs: number
  readonly status: CyclicJobStatus
}

export type LastTx = {
  readonly tsUs: number
  readonly canId: number
  readonly isEff: boolean
}

export type TransmitStats = {
  readonly txCount: number
  readonly errors: number
  readonly lastTx: LastTx | null
}

export type SendMode = 'oneshot' | 'cyclic'

export type RawSendDraft = {
  readonly busName: string
  readonly idHex: string
  readonly dataHex: string
  readonly mode: SendMode
  readonly periodMs: number
  readonly isEff: boolean
  readonly isRtr: boolean
  readonly isFd: boolean
}

export const DEFAULT_RAW_DRAFT: RawSendDraft = {
  busName: 'vcan0',
  idHex: '0x7E0',
  dataHex: '02 10 0C 00 00 00 00 00',
  mode: 'oneshot',
  periodMs: 100,
  isEff: false,
  isRtr: false,
  isFd: false
}

export type DbcPackDraft = {
  readonly message: string
  readonly values: Readonly<Record<string, string>>
  readonly periodMs: number
}

export const DEFAULT_DBC_DRAFT: DbcPackDraft = {
  message: '',
  values: {},
  periodMs: 100
}

export type TransmitModel = {
  readonly draft: RawSendDraft
  setDraft: (next: RawSendDraft) => void
  readonly dbcDraft: DbcPackDraft
  setDbcDraft: (next: DbcPackDraft) => void
  syncSelectedBus: (name: string) => void
  readonly jobs: readonly CyclicJobRow[]
  readonly stats: TransmitStats
  readonly lastRawJobId: string | null
  readonly lastDbcJobId: string | null
  sendOnce: (request: TxSendRequest) => Promise<boolean>
  startCyclic: (request: TxCyclicStartRequest, meta: Omit<CyclicJobRow, 'jobId' | 'status'>) => Promise<boolean>
  stopJob: (jobId: string) => Promise<boolean>
  stopLastRaw: () => Promise<boolean>
  stopLastDbc: () => Promise<boolean>
  noteBatch: (batch: RxBatch) => void
  markBusClosed: (busId: string) => void
  reset: () => void
  hydratePrefs: (
    raw: PersistedRawDraft,
    dbc: PersistedDbcDraft,
    jobs: readonly PersistedCyclicJob[]
  ) => void
}

const EMPTY_STATS: TransmitStats = { txCount: 0, errors: 0, lastTx: null }

function lastTxFromFrame(frame: FrameEvent): LastTx {
  return { tsUs: frame.ts_us, canId: frame.can_id, isEff: frame.is_eff }
}

export function useTransmitModel(api: VanillaBusApi | undefined): TransmitModel {
  const [draft, setDraft] = useState<RawSendDraft>(DEFAULT_RAW_DRAFT)
  const [dbcDraft, setDbcDraft] = useState<DbcPackDraft>(DEFAULT_DBC_DRAFT)
  const [jobs, setJobs] = useState<CyclicJobRow[]>([])
  const [stats, setStats] = useState<TransmitStats>(EMPTY_STATS)
  const [lastRawJobId, setLastRawJobId] = useState<string | null>(null)
  const [lastDbcJobId, setLastDbcJobId] = useState<string | null>(null)

  const syncSelectedBus = useCallback((name: string): void => {
    if (name.length === 0) {
      return
    }
    setDraft((current) => (current.busName === name ? current : { ...current, busName: name }))
  }, [])

  const noteError = useCallback((): void => {
    setStats((current) => ({ ...current, errors: current.errors + 1 }))
  }, [])

  const sendOnce = useCallback(
    async (request: TxSendRequest): Promise<boolean> => {
      if (!api) {
        noteError()
        return false
      }
      const result = await api.sendFrame(request)
      if (!result.ok) {
        noteError()
        return false
      }
      if (isTxRawSendRequest(request)) {
        setStats((current) => ({
          ...current,
          lastTx: {
            tsUs: Date.now() * 1000,
            canId: request.can_id,
            isEff: request.is_eff ?? request.can_id > 0x7ff
          }
        }))
      }
      return true
    },
    [api, noteError]
  )

  const startCyclic = useCallback(
    async (
      request: TxCyclicStartRequest,
      meta: Omit<CyclicJobRow, 'jobId' | 'status'>
    ): Promise<boolean> => {
      if (!api) {
        noteError()
        return false
      }
      const result = await api.startCyclic(request)
      if (!result.ok) {
        noteError()
        return false
      }
      const row: CyclicJobRow = { ...meta, jobId: result.job_id, status: 'Running' }
      setJobs((current) => [...current, row])
      if (meta.type === 'Raw') {
        setLastRawJobId(result.job_id)
      } else {
        setLastDbcJobId(result.job_id)
      }
      return true
    },
    [api, noteError]
  )

  const stopJob = useCallback(
    async (jobId: string): Promise<boolean> => {
      if (!api) {
        noteError()
        return false
      }
      const result = await api.stopCyclic(jobId)
      if (!result.ok) {
        noteError()
        if (result.error.code === 'job_not_found') {
          setJobs((current) =>
            current.map((job) => (job.jobId === jobId ? { ...job, status: 'Stopped' } : job))
          )
        }
        return false
      }
      setJobs((current) =>
        current.map((job) => (job.jobId === jobId ? { ...job, status: 'Stopped' } : job))
      )
      return true
    },
    [api, noteError]
  )

  const stopLastRaw = useCallback(async (): Promise<boolean> => {
    if (lastRawJobId === null) {
      return false
    }
    const target = jobs.find((job) => job.jobId === lastRawJobId && job.status === 'Running')
    if (!target) {
      return false
    }
    return stopJob(target.jobId)
  }, [jobs, lastRawJobId, stopJob])

  const stopLastDbc = useCallback(async (): Promise<boolean> => {
    if (lastDbcJobId === null) {
      return false
    }
    const target = jobs.find((job) => job.jobId === lastDbcJobId && job.status === 'Running')
    if (!target) {
      return false
    }
    return stopJob(target.jobId)
  }, [jobs, lastDbcJobId, stopJob])

  const noteBatch = useCallback((batch: RxBatch): void => {
    const txFrames = batch.frames.filter((frame) => frame.dir === 'tx')
    if (txFrames.length === 0) {
      return
    }
    const last = txFrames[txFrames.length - 1]
    setStats((current) => ({
      txCount: current.txCount + txFrames.length,
      errors: current.errors,
      lastTx: last ? lastTxFromFrame(last) : current.lastTx
    }))
  }, [])

  const markBusClosed = useCallback((busId: string): void => {
    setJobs((current) =>
      current.map((job) => (job.busId === busId ? { ...job, status: 'Stopped' } : job))
    )
  }, [])

  const reset = useCallback((): void => {
    setJobs((current) =>
      current.map((job, index) => ({
        ...job,
        jobId: job.status === 'Running' ? cyclicJobDefinitionId(index) : job.jobId,
        status: 'Stopped' as const
      }))
    )
    setStats(EMPTY_STATS)
    setLastRawJobId(null)
    setLastDbcJobId(null)
  }, [])

  const hydratePrefs = useCallback(
    (raw: PersistedRawDraft, dbc: PersistedDbcDraft, jobs: readonly PersistedCyclicJob[]): void => {
      setDraft({ ...raw })
      setDbcDraft({
        message: dbc.message,
        values: { ...dbc.values },
        periodMs: dbc.periodMs
      })
      setJobs(
        jobs.map((job, index) => ({
          jobId: cyclicJobDefinitionId(index),
          type: job.type,
          busId: '',
          ifName: job.ifName,
          canId: job.canId,
          isEff: job.isEff,
          data: job.data,
          message: job.message,
          periodMs: job.periodMs,
          status: 'Stopped'
        }))
      )
      setStats(EMPTY_STATS)
      setLastRawJobId(null)
      setLastDbcJobId(null)
    },
    []
  )

  return {
    draft,
    setDraft,
    dbcDraft,
    setDbcDraft,
    syncSelectedBus,
    jobs,
    stats,
    lastRawJobId,
    lastDbcJobId,
    sendOnce,
    startCyclic,
    stopJob,
    stopLastRaw,
    stopLastDbc,
    noteBatch,
    markBusClosed,
    reset,
    hydratePrefs
  }
}
