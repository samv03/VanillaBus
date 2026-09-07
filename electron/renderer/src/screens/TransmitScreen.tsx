import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { parseCanIdHex, parseDataHex } from '../../../../shared/txFormat'
import type { OpenedBus } from '../shell/types'
import { CyclicJobsTable } from '../transmit/CyclicJobsTable'
import { DbcPackPlaceholder } from '../transmit/DbcPackPlaceholder'
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

  useEffect(() => {
    model.syncSelectedBus(selectedBus)
  }, [model.syncSelectedBus, selectedBus])

  const target = useMemo(
    () => opened.find((item) => item.name === model.draft.busName) ?? opened[0],
    [model.draft.busName, opened]
  )

  const canStopRaw = model.jobs.some(
    (job) => job.jobId === model.lastRawJobId && job.status === 'Running'
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
        <DbcPackPlaceholder />
        <CyclicJobsTable jobs={model.jobs} onStop={(jobId) => void model.stopJob(jobId)} />
      </div>
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
