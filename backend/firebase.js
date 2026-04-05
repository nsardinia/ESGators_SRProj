require("dotenv").config()

const admin = require("firebase-admin")
const DEFAULT_FIREBASE_PROJECT_ID = "senior-project-esgators"

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  }

  return require("./firebase-key.json")
}

function resolveDatabaseUrl(serviceAccount) {
  if (process.env.FIREBASE_DATABASE_URL) {
    return process.env.FIREBASE_DATABASE_URL
  }

  if (process.env.VITE_FIREBASE_DATABASE_URL) {
    return process.env.VITE_FIREBASE_DATABASE_URL
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID
    || process.env.VITE_FIREBASE_PROJECT_ID
    || serviceAccount?.project_id
    || DEFAULT_FIREBASE_PROJECT_ID

  return `https://${projectId}-default-rtdb.firebaseio.com`
}

const serviceAccount = loadServiceAccount()

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: resolveDatabaseUrl(serviceAccount),
  })
}

module.exports = admin.database()
