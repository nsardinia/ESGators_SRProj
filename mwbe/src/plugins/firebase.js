/**
 * Firebase configuration handled as fastify plugin. Allows all backend routes to interface with firebase using 
 * service keys stored in firebaseServiceKeys.json (not public). Creates firebase connections.
 * 
 * Last Edit: Nicholas Sardinia, 4/19/2026
 */

const fs = require("node:fs");
const path = require("node:path");

function normalizePrivateKey(privateKey) {
  return String(privateKey || "").replace(/\\n/g, "\n");
}


//Reads the firebase service account information from the MWBE env.
function readServiceAccountFromEnv() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey,
  };
}

//read database information from env.
function getDatabaseUrl(serviceAccount) {
  const explicitDatabaseUrl = process.env.FIREBASE_DATABASE_URL;

  if (explicitDatabaseUrl) {
    return explicitDatabaseUrl;
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    serviceAccount?.project_id ||
    serviceAccount?.projectId;

  if (!projectId) {
    return null;
  }

  return `https://${projectId}-default-rtdb.firebaseio.com`;
}

// setup firebase admin and attach clients to the fastify app.
function registerFirebase(app) {
  let admin;

  try {
    admin = require("firebase-admin");
  } catch (error) {
    app.log.warn(
      "firebase-admin is not installed. Firebase integration is disabled until dependency is installed."
    );
    return;
  }

  const serviceAccountPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "firebaseServiceKeys.json";
  const appName = process.env.FIREBASE_APP_NAME || "mwbe";
  let serviceAccount;

  try {
    serviceAccount = readServiceAccountFromEnv();
  } catch (error) {
    app.log.warn(
      { error },
      "Failed to parse Firebase service account from env. Firebase integration is disabled."
    );
    return;
  }

  if (!serviceAccount) {
    const resolvedPath = path.resolve(process.cwd(), serviceAccountPath);

    if (!fs.existsSync(resolvedPath)) {
      app.log.warn(
        {
          serviceAccountPath: resolvedPath,
          expectedEnvVars: [
            "FIREBASE_SERVICE_ACCOUNT_JSON",
            "FIREBASE_PROJECT_ID",
            "FIREBASE_CLIENT_EMAIL",
            "FIREBASE_PRIVATE_KEY",
          ],
        },
        "Firebase credentials not found in env or service account file. Firebase integration is disabled."
      );
      return;
    }

    try {
      serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    } catch (error) {
      app.log.warn(
        { error, serviceAccountPath: resolvedPath },
        "Failed to parse Firebase service account file. Firebase integration is disabled."
      );
      return;
    }
  }

  const databaseURL = getDatabaseUrl(serviceAccount);

  const hasNamedApp = admin.apps.some((existingApp) => existingApp.name === appName);
  const firebaseApp = hasNamedApp
    ? admin.app(appName)
    : admin.initializeApp(
        {
          credential: admin.credential.cert(serviceAccount),
          ...(databaseURL ? { databaseURL } : {}),
        },
        appName
      );

  app.decorate("firebaseAdmin", admin);
  app.decorate("firebaseAuth", firebaseApp.auth());

  if (databaseURL) {
    app.decorate("firebaseDb", firebaseApp.database());
  }
}

module.exports = registerFirebase;
