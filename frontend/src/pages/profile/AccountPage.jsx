/**
 * Account management page shell.
 * 
 * TODO: implement functionality.
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */
function AccountPage() {
  return (
    <section className="profile-content">
      <h1 className="page-title">Account</h1>
      <p className="page-subtitle">TODO Account Info</p>

      <div className="settings-card">
        <h2>Profile Details</h2>
        <p>Todo Profile Details</p>
        <div className="settings-grid">
          <label className="field">
            <span>Full name</span>
            <input type="text" placeholder="Nicholas Sardinia" />
          </label>
          <label className="field">
            <span>Username</span>
            <input type="text" placeholder="nicholas" />
          </label>
          <label className="field field-wide">
            <span>Email</span>
            <input type="email" placeholder="nicholas@esgators.io" />
          </label>
          <label className="field field-wide">
            <span>Bio</span>
            <textarea rows="4" placeholder="Building IoT-first sustainability tools for companies and investors." />
          </label>
        </div>
        <button type="button" className="primary-action">Save changes</button>
      </div>

      <div className="settings-card danger-card">
        <h2>Delete Account</h2>
        <p>Permanently delete your account</p>
        <button type="button" className="danger-action">Delete account</button>
      </div>
    </section>
  )
}

export default AccountPage
