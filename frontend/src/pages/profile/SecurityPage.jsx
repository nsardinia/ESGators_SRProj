function SecurityPage() {
  return (
    <section className="profile-content">
      <h1 className="page-title">Security</h1>
      <p className="page-subtitle">Protect your account with strong authentication settings.</p>

      <div className="settings-card">
        <h2>Password</h2>
        <p>Last changed 38 days ago.</p>
        <button type="button" className="secondary-action">Change password</button>
      </div>

      <div className="settings-card">
        <h2>Two-Factor Authentication</h2>
        <p>2FA is currently disabled for this account.</p>
        <button type="button" className="primary-action">Enable 2FA</button>
      </div>

      <div className="settings-card">
        <h2>Active Sessions</h2>
        <div className="invoice-list">
          <div className="invoice-row"><span>Chrome on macOS</span><span>Current session</span></div>
          <div className="invoice-row"><span>Safari on iPhone</span><span>2 days ago</span></div>
        </div>
      </div>
    </section>
  )
}

export default SecurityPage
