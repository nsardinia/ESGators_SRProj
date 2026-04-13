const test = require("node:test")
const assert = require("node:assert/strict")
const Module = require("node:module")

test("firebase module initializes admin SDK from split env vars", async () => {
    const originalLoad = Module._load
    const originalEnv = {
        FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
        FIREBASE_SERVICE_ACCOUNT_PATH: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
        FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
        FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
        FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
        FIREBASE_DATABASE_URL: process.env.FIREBASE_DATABASE_URL,
        VITE_FIREBASE_DATABASE_URL: process.env.VITE_FIREBASE_DATABASE_URL,
    }
    const firebaseModulePath = require.resolve("../firebase")
    const observed = {
        serviceAccount: null,
        config: null,
    }
    const fakeDatabase = { name: "fake-db" }
    const fakeAdmin = {
        apps: [],
        credential: {
            cert(serviceAccount) {
                observed.serviceAccount = serviceAccount
                return { serviceAccount }
            },
        },
        initializeApp(config) {
            observed.config = config
            this.apps.push({ name: "[DEFAULT]" })
            return { name: "[DEFAULT]" }
        },
        database() {
            return fakeDatabase
        },
    }

    Module._load = function patchedModuleLoad(request, parent, isMain) {
        if (request === "firebase-admin") {
            return fakeAdmin
        }

        return originalLoad.call(this, request, parent, isMain)
    }

    delete require.cache[firebaseModulePath]

    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = ""
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH = "./does-not-exist.json"
    process.env.FIREBASE_PROJECT_ID = "senior-project-esgators"
    process.env.FIREBASE_CLIENT_EMAIL = "firebase-adminsdk-test@senior-project-esgators.iam.gserviceaccount.com"
    process.env.FIREBASE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nabc123\\n-----END PRIVATE KEY-----\\n"
    process.env.FIREBASE_DATABASE_URL = "https://senior-project-esgators-default-rtdb.firebaseio.com"
    delete process.env.VITE_FIREBASE_DATABASE_URL

    try {
        const database = require("../firebase")

        assert.equal(database, fakeDatabase)
        assert.equal(observed.config.databaseURL, process.env.FIREBASE_DATABASE_URL)
        assert.equal(observed.serviceAccount.project_id, process.env.FIREBASE_PROJECT_ID)
        assert.equal(observed.serviceAccount.client_email, process.env.FIREBASE_CLIENT_EMAIL)
        assert.equal(
            observed.serviceAccount.private_key,
            "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----"
        )
    } finally {
        Module._load = originalLoad
        delete require.cache[firebaseModulePath]

        Object.entries(originalEnv).forEach(([key, value]) => {
            if (value === undefined) {
                delete process.env[key]
                return
            }

            process.env[key] = value
        })
    }
})
