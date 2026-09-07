import { useCallback, useState } from 'react'
import type {
  FrameEvent,
  RxBatch,
  TxCyclicStartRequest,
  TxSendRequest,
  VanillaBusApi
} from '../../../../shared/engine'

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

export type TransmitModel = {
  readonly jobs: readonly CyclicJobRow[]
  readonly stats: TransmitStats
  readonly lastRawJobId: string | null
  sendOnce: (request: TxSendRequest) => Promise<boolean>
  startCyclic: (request: TxCyclicStartRequest, meta: Omit<CyclicJobRow, 'jobId' | 'status'>) => Promise<boolean>
  stopJob: (jobId: string) => Promise<boolean>
  stopLastRaw: () => Promise<boolean>
  noteBatch: (batch: RxBatch) => void
  markBusClosed: (busId: string) => void
  reset: () => void
}

const EMPTY_STATS: TransmitStats = { txCount: 0, errors: 0, lastTx: null }

function lastTxFromFrame(frame: FrameEvent): LastTx {
  return { tsUs: frame.ts_us, canId: frame.can_id, isEff: frame.is_eff }
}

export function useTransmitModel(api: VanillaBusApi | undefined): TransmitModel {
  const [jobs, setJobs] = useState<CyclicJobRow[]>([])
  const [stats, setStats] = useState<TransmitStats>(EMPTY_STATS)
  const [lastRawJobId, setLastRawJobId] = useState<string | null>(null)

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
      setStats((current) => ({
        ...current,
        lastTx: {
          tsUs: Date.now() * 1000,
          canId: request.can_id,
          isEff: request.is_eff ?? request.can_id > 0x7ff
        }
      }))
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
    setJobs([])
    setStats(EMPTY_STATS)
    setLastRawJobId(null)
  }, [])

  return {
    jobs,
    stats,
    lastRawJobId,
    sendOnce,
    startCyclic,
    stopJob,
    stopLastRaw,
    noteBatch,
    markBusClosed,
    reset
  }
}
