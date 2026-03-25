/**
 * Security management shell.
 * 
 * TODO: implement functionality. Allow changes, provide support. 
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */

function SecurityPage() {
  return (
    <section className="profile-content">
      <h1 className="page-title">Security</h1>
      <p className="page-subtitle">Protect your account with strong authentication settings.</p>

      <div className="settings-card">
        <h2>Password</h2>
        <p>TODO enable password changes</p>
        <button type="button" className="secondary-action">Change password</button>
      </div>

      <div className="settings-card">
        <h2>TODO 2FA</h2>
        <p>2FA is currently disabled for this account.</p>
        <button type="button" className="primary-action">Enable 2FA</button>
      </div>

      <div className="settings-card">
        <h2>Active Sessions</h2>
        <div className="invoice-list">
          <div className="invoice-row"><span>TODO fetch session info</span><span>TODO store sessions</span></div>
          <div className="invoice-row"><span>TODO fetch session info</span><span>TODO store sessions</span></div>
        </div>
      </div>
    </section>
  )
}

export default SecurityPage
