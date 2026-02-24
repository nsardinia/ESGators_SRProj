import { initializeApp } from "firebase/app"
import { getAuth } from "firebase/auth"

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

let auth = null

if (isFirebaseConfigured) {
  const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  }

  const app = initializeApp(firebaseConfig)
  auth = getAuth(app)
}

export { auth, firebaseConfigError, isFirebaseConfigured, missingFirebaseEnvKeys }
