/**
 * Billing page shell.
 * 
 * TODO: implement functionality to enable sustainable scalability based on user DB reads and writes.
 * TODO: Determine best billing scheme. Reads + writes or charge for private writes and all reads. 
 *       Private writes + all reads may encourage public data sharing. Will explore literature.
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */

function BillingPage() {
  return (
    <section className="profile-content">
      <h1 className="page-title">Billing</h1>
      <p className="page-subtitle">Manage plans, invoices, and payment methods.</p>

      <div className="settings-card">
        <h2>Current Plan</h2>
        <p>TODO Plans</p>
        <div className="billing-pill-row">
          <span className="billing-pill">Plan Info</span>
          <span className="billing-pill muted">$TBD/request</span>
        </div>
        <button type="button" className="primary-action">Manage subscription</button>
      </div>

      <div className="settings-card">
        <h2>Payment Method</h2>
        <p>TODO Charge Info</p>
        <button type="button" className="secondary-action">Update card</button>
      </div>

      <div className="settings-card">
        <h2>Recent Invoices</h2>
        <div className="invoice-list">
          <div className="invoice-row"><span>INV-2026-0215</span><span>$TODO</span></div>
          <div className="invoice-row"><span>INV-2026-0115</span><span>$TODO</span></div>
          <div className="invoice-row"><span>INV-2025-1215</span><span>$TODO</span></div>
        </div>
      </div>
    </section>
  )
}

export default BillingPage
