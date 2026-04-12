import { initializeApp } from "firebase/app"

const requiredFirebaseEnvKeys = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
]

const missingFirebaseEnvKeys = requiredFirebaseEnvKeys.filter(
  (key) => !import.meta.env[key]
)

const isFirebaseConfigured = missingFirebaseEnvKeys.length === 0

const firebaseConfigError = isFirebaseConfigured
  ? ""
  : `Missing Firebase config: ${missingFirebaseEnvKeys.join(", ")}`

let hasWarnedAboutFirebaseConfig = false

function notifyFirebaseConfigError() {
  if (isFirebaseConfigured || hasWarnedAboutFirebaseConfig) {
    return
  }

  hasWarnedAboutFirebaseConfig = true
  console.error(firebaseConfigError)

  if (typeof window !== "undefined") {
    window.alert("Firebase is not configured. Authentication is disabled.")
  }
}

let firebaseApp = null

if (isFirebaseConfigured) {
  const realtimeDatabaseUrl =
    import.meta.env.VITE_FIREBASE_DATABASE_URL ||
    `https://${import.meta.env.VITE_FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`

  firebaseApp = initializeApp({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    databaseURL: realtimeDatabaseUrl,
  })
}

export { firebaseApp, isFirebaseConfigured, notifyFirebaseConfigError }
