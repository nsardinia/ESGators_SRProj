import { firebaseConfigError, missingFirebaseEnvKeys } from "../lib/firebase"

function FirebaseConfigError() {
  return (
    <div className="auth-root">
      <section className="auth-panel">
        <p className="page-kicker">Configuration Error</p>
        <h1 className="page-title">Firebase is not configured</h1>
        <p className="page-subtitle">
          Authentication is disabled until Firebase environment variables are set.
        </p>
        <div className="settings-card">
          <p className="data-card-label">Missing Environment Variables</p>
          <pre className="data-json">
            {missingFirebaseEnvKeys.join("\n") || firebaseConfigError}
          </pre>
        </div>
      </section>
    </div>
  )
}

export default FirebaseConfigError
