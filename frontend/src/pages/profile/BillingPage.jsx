function BillingPage() {
  return (
    <section className="profile-content">
      <h1 className="page-title">Billing</h1>
      <p className="page-subtitle">Manage plans, invoices, and payment methods.</p>

      <div className="settings-card">
        <h2>Current Plan</h2>
        <p>Team Pro plan with usage-based metrics enabled.</p>
        <div className="billing-pill-row">
          <span className="billing-pill">Team Pro</span>
          <span className="billing-pill muted">$99/mo base</span>
        </div>
        <button type="button" className="primary-action">Manage subscription</button>
      </div>

      <div className="settings-card">
        <h2>Payment Method</h2>
        <p>Visa ending in 4242. Next charge on March 15.</p>
        <button type="button" className="secondary-action">Update card</button>
      </div>

      <div className="settings-card">
        <h2>Recent Invoices</h2>
        <div className="invoice-list">
          <div className="invoice-row"><span>INV-2026-0215</span><span>$123.40</span></div>
          <div className="invoice-row"><span>INV-2026-0115</span><span>$118.90</span></div>
          <div className="invoice-row"><span>INV-2025-1215</span><span>$106.20</span></div>
        </div>
      </div>
    </section>
  )
}

export default BillingPage
