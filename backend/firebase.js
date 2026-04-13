require("dotenv").config()

const admin = require("firebase-admin")
const fs = require("node:fs")
const path = require("node:path")
const DEFAULT_FIREBASE_PROJECT_ID = "senior-project-esgators"

function normalizePrivateKey(privateKey) {
  return String(privateKey || "").replace(/\\n/g, "\n").trim()
}

function readServiceAccountFromEnv() {
  const rawJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim()

  if (rawJson) {
    return JSON.parse(rawJson)
  }

  const projectId = String(process.env.FIREBASE_PROJECT_ID || "").trim()
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || "").trim()
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY)

  if (!projectId || !clientEmail || !privateKey) {
    return null
  }

  return {
    type: "service_account",
    project_id: projectId,
    private_key: privateKey,
    client_email: clientEmail,
    projectId,
    privateKey,
    clientEmail,
  }
}

function loadServiceAccount() {
  const fromEnv = readServiceAccountFromEnv()

  if (fromEnv) {
    return fromEnv
  }

  const configuredPath = String(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./firebase-key.json"
  ).trim()
  const resolvedPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(__dirname, configuredPath)

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      "Firebase credentials not found. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY, or add backend/firebase-key.json."
    )
  }

  return JSON.parse(fs.readFileSync(resolvedPath, "utf8"))
}

function resolveDatabaseUrl(serviceAccount) {
  const explicitDatabaseUrl = String(
    process.env.FIREBASE_DATABASE_URL || process.env.VITE_FIREBASE_DATABASE_URL || ""
  ).trim()

  if (explicitDatabaseUrl) {
    return explicitDatabaseUrl
  }

  const projectId =
    String(process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || "").trim()
    || serviceAccount?.project_id
    || serviceAccount?.projectId
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
