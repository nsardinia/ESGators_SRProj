function AccountPage() {
  return (
    <section className="profile-content">
      <h1 className="page-title">Account</h1>
      <p className="page-subtitle">Manage your public profile and account metadata.</p>

      <div className="settings-card">
        <h2>Profile Details</h2>
        <p>Shown across your organization and project activity.</p>
        <div className="settings-grid">
          <label className="field">
            <span>Full name</span>
            <input type="text" placeholder="Nicholas Carter" />
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
            <textarea rows="4" placeholder="Building IoT-first sustainability tools." />
          </label>
        </div>
        <button type="button" className="primary-action">Save changes</button>
      </div>

      <div className="settings-card danger-card">
        <h2>Delete Account</h2>
        <p>Permanently remove your user profile and all linked personal preferences.</p>
        <button type="button" className="danger-action">Delete account</button>
      </div>
    </section>
  )
}

export default AccountPage
