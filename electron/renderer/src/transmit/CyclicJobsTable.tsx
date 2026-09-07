import type { ReactElement } from 'react'
import { formatCanIdPrefixed } from '../../../../shared/traceFormat'
import type { CyclicJobRow } from './useTransmitModel'

type CyclicJobsTableProps = {
  readonly jobs: readonly CyclicJobRow[]
  readonly onStop: (jobId: string) => void
}

export function CyclicJobsTable({ jobs, onStop }: CyclicJobsTableProps): ReactElement {
  return (
    <section className="tx-col tx-col-jobs">
      <h2>Active cyclic jobs</h2>
      <div className="tx-jobs-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Type</th>
              <th>ID / Message</th>
              <th>Period (ms)</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No cyclic jobs. Start one from Raw send.
                </td>
              </tr>
            ) : (
              jobs.map((job, index) => (
                <tr key={job.jobId}>
                  <td className="mono">{index + 1}</td>
                  <td>{job.type}</td>
                  <td className="mono">
                    {formatCanIdPrefixed(job.canId, job.isEff)}
                    <span className="tx-job-if muted"> {job.ifName}</span>
                  </td>
                  <td className="mono">{job.periodMs}</td>
                  <td>
                    <span
                      className={`tx-job-status ${
                        job.status === 'Running' ? 'tx-job-running' : 'tx-job-stopped'
                      }`}
                    >
                      {job.status}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      disabled={job.status !== 'Running'}
                      onClick={() => onStop(job.jobId)}
                    >
                      Stop
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
