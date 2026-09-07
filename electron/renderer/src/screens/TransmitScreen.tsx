import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { DbcCatalogMessage } from '../../../../shared/engine'
import { parseCanIdHex, parseDataHex } from '../../../../shared/txFormat'
import type { OpenedBus } from '../shell/types'
import { CyclicJobsTable } from '../transmit/CyclicJobsTable'
import { DbcPackPanel, parseSignalValues } from '../transmit/DbcPackPanel'
import { RawSendPanel } from '../transmit/RawSendPanel'
import { TransmitFooter } from '../transmit/TransmitFooter'
import type { RawSendDraft, TransmitModel } from '../transmit/useTransmitModel'

type TransmitScreenProps = {
  readonly model: TransmitModel
  readonly opened: readonly OpenedBus[]
  readonly selectedBus: string
  readonly engineConnected: boolean
}

export function TransmitScreen({
  model,
  opened,
  selectedBus,
  engineConnected
}: TransmitScreenProps): ReactElement {
  const [sending, setSending] = useState(false)
  const [starting, setStarting] = useState(false)
  const [dbcSending, setDbcSending] = useState(false)
  const [dbcStarting, setDbcStarting] = useState(false)

  useEffect(() => {
    model.syncSelectedBus(selectedBus)
  }, [model.syncSelectedBus, selectedBus])

  const target = useMemo(
    () => opened.find((item) => item.name === model.draft.busName) ?? opened[0],
    [model.draft.busName, opened]
  )

  const catalog = target?.dbc?.catalog ?? []
  const canStopRaw = model.jobs.some(
    (job) => job.jobId === model.lastRawJobId && job.status === 'Running'
  )
  const canStopDbc = model.jobs.some(
    (job) => job.jobId === model.lastDbcJobId && job.status === 'Running'
  )

  async function handleSend(): Promise<void> {
    const request = buildRequest(model.draft, target?.busId)
    if (!request) {
      return
    }
    setSending(true)
    try {
      await model.sendOnce(request)
    } finally {
      setSending(false)
    }
  }

  async function handleStart(): Promise<void> {
    const request = buildRequest(model.draft, target?.busId)
    if (!request || !target) {
      return
    }
    setStarting(true)
    try {
      await model.startCyclic(
        { ...request, period_ms: model.draft.periodMs },
        {
          type: 'Raw',
          busId: target.busId,
          ifName: target.name,
          canId: request.can_id,
          isEff: request.is_eff ?? false,
          data: request.data,
          periodMs: model.draft.periodMs
        }
      )
    } finally {
      setStarting(false)
    }
  }

  async function handleDbcSend(): Promise<void> {
    const packed = buildDbcRequest(model, target?.busId, catalog)
    if (!packed) {
      return
    }
    setDbcSending(true)
    try {
      await model.sendOnce(packed.request)
    } finally {
      setDbcSending(false)
    }
  }

  async function handleDbcStart(): Promise<void> {
    const packed = buildDbcRequest(model, target?.busId, catalog)
    if (!packed || !target) {
      return
    }
    setDbcStarting(true)
    try {
      await model.startCyclic(
        { ...packed.request, period_ms: model.dbcDraft.periodMs },
        {
          type: 'DBC',
          busId: target.busId,
          ifName: target.name,
          canId: packed.canId,
          isEff: packed.isEff,
          data: '',
          message: packed.request.message,
          periodMs: model.dbcDraft.periodMs
        }
      )
    } finally {
      setDbcStarting(false)
    }
  }

  return (
    <div className="tx-screen">
      <div className="tx-columns">
        <RawSendPanel
          draft={model.draft}
          onChange={model.setDraft}
          opened={opened}
          engineConnected={engineConnected}
          sending={sending}
          starting={starting}
          canStopRaw={canStopRaw}
          onSend={() => void handleSend()}
          onStart={() => void handleStart()}
          onStop={() => void model.stopLastRaw()}
        />
        <DbcPackPanel
          draft={model.dbcDraft}
          onChange={model.setDbcDraft}
          catalog={catalog}
          dbcLoaded={target?.dbc !== null && target?.dbc !== undefined}
          ready={engineConnected && target !== undefined && target.dbc !== null}
          sending={dbcSending}
          starting={dbcStarting}
          canStop={canStopDbc}
          onSend={() => void handleDbcSend()}
          onStart={() => void handleDbcStart()}
          onStop={() => void model.stopLastDbc()}
        />
        <CyclicJobsTable jobs={model.jobs} onStop={(jobId) => void model.stopJob(jobId)} />
      </div>
      <p className="tx-multibus-hint muted">
        Transmit targets the bus in the Raw send dropdown (synced from the
        header-selected open bus). DBC pack uses <strong>that bus&apos;s</strong>{' '}
        loaded DBC only — packing on vcan0 never uses vcan1&apos;s database.
      </p>
      <TransmitFooter stats={model.stats} />
    </div>
  )
}

function buildRequest(draft: RawSendDraft, busId: string | undefined) {
  if (!busId) {
    return null
  }
  const id = parseCanIdHex(draft.idHex)
  const data = parseDataHex(draft.dataHex)
  if (!id.ok || !data.ok) {
    return null
  }
  return {
    busId,
    can_id: id.value,
    data: data.hex,
    is_eff: draft.isEff || id.isEffHint,
    is_rtr: draft.isRtr,
    is_fd: draft.isFd
  }
}

function buildDbcRequest(model: TransmitModel, busId: string | undefined, catalog: readonly DbcCatalogMessage[]) {
  if (!busId) {
    return null
  }
  const message = catalog.find((item) => item.name === model.dbcDraft.message)
  const signals = parseSignalValues(message, model.dbcDraft.values)
  if (!message || !signals) {
    return null
  }
  return {
    request: { busId, message: message.name, signals },
    canId: message.can_id,
    isEff: message.can_id > 0x7ff
  }
}
