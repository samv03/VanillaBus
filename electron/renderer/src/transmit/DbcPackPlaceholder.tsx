import type { ReactElement } from 'react'

export function DbcPackPlaceholder(): ReactElement {
  return (
    <section className="tx-col tx-col-dbc" aria-disabled="true">
      <h2>DBC pack</h2>
      <p className="tx-dbc-banner">DBC pack — T13</p>
      <p className="tx-hint muted">
        Signal encode / cantools pack is T13. This column is a layout placeholder
        so T12 raw send and cyclic jobs stay on the locked Transmit mockup.
      </p>
      <label className="tx-field">
        <span>Message</span>
        <select disabled aria-label="DBC message placeholder">
          <option>Engine_Status (0x7E0)</option>
        </select>
      </label>
      <div className="tx-dbc-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Signal</th>
              <th>Value</th>
              <th>Unit</th>
              <th>Min</th>
              <th>Max</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={5} className="muted">
                Signals land in T13
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="tx-dbc-actions">
        <button type="button" disabled>
          Add to send list
        </button>
        <button type="button" className="tx-btn-outline" disabled>
          Send once
        </button>
        <button type="button" className="tx-send-btn" disabled>
          Start cyclic
        </button>
      </div>
    </section>
  )
}
