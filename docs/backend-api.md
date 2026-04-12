# Backend API

This page documents the `mwbe` service, which is the main REST API consumed by the frontend application. It is implemented with Fastify and lives under `mwbe/src`.

## Purpose

The `mwbe` service handles application-facing operations for:

- health and API discovery
- user records stored in Supabase
- device ownership, claiming, provisioning, and deletion
- device telemetry history lookup
- radio network configuration persistence to Firebase Realtime Database

It also exposes generated OpenAPI documentation through Swagger UI.

## Service layout

```text
mwbe/
├── src/
│   ├── app.js
│   ├── server.js
│   ├── plugins/
│   │   ├── index.js
│   │   ├── swagger.js
│   │   ├── supabase.js
│   │   ├── firebase.js
│   │   └── grafanaMetrics.js
│   ├── routes/
│   │   ├── index.js
│   │   ├── root.js
│   │   ├── users.js
│   │   ├── devices.js
│   │   └── configuration.js
│   └── services/
│       └── deviceHistory.js
└── test/
```

## Runtime dependencies

The API depends on these integrations:

- Supabase for `users`, `devices`, and `device_history` table access
- Firebase Admin for custom device tokens and Realtime Database writes
- Fastify plugins for CORS, security headers, sensible HTTP errors, and Swagger docs

## Local development

From the `mwbe/` directory:

```bash
npm install
npm run dev
```

Useful local URLs:

- `http://localhost:3000/`
- `http://localhost:3000/health`
- `http://localhost:3000/docs`
- `http://localhost:3000/documentation/json`

## Environment variables

Common variables used by the API include:

- `PORT`
- `HOST`
- `LOG_LEVEL`
- `CORS_ORIGIN`
- `PUBLIC_API_BASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- Firebase Admin credentials and `FIREBASE_DATABASE_URL`
- `DEVICE_HISTORY_SYNC_ENABLED`
- `DEVICE_HISTORY_POLL_INTERVAL_MS`

If Supabase or Firebase are missing, route handlers fail fast with configuration errors rather than silently degrading.

## Plugin registration

`mwbe/src/plugins/index.js` registers the service capabilities in this order:

1. `@fastify/sensible`
2. Swagger and Swagger UI
3. `@fastify/helmet`
4. `@fastify/cors`
5. Supabase client decoration
6. Firebase Admin decoration
7. device history synchronization service
8. Grafana metrics support

## Route groups

All routes are registered in `mwbe/src/routes/index.js`.

### System routes

Defined in `mwbe/src/routes/root.js`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Returns a basic service message and docs links |
| `GET` | `/health` | Returns service status and timestamp |

### User routes

Defined in `mwbe/src/routes/users.js`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/users` | List all users |
| `GET` | `/users/:id` | Fetch one user by UUID |
| `POST` | `/users` | Create or upsert a user by email and Firebase UID |
| `PUT` | `/users/:id` | Update a user |
| `DELETE` | `/users/:id` | Delete a user |

Notes:

- the create route behaves like an upsert when the email or Firebase UID already exists
- user records are the ownership anchor for device APIs

### Device routes

Defined in `mwbe/src/routes/devices.js`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/devices` | Basic devices index response |
| `GET` | `/devices/owned?ownerUid=...` | List devices owned by one user |
| `GET` | `/devices/:deviceId/history?ownerUid=...` | Fetch historical telemetry for one owned device |
| `GET` | `/devices/network` | List all devices with resolved owner details |
| `GET` | `/devices/claim?ownerUid=...` | Claim a device with generated credentials |
| `POST` | `/devices/claim` | Claim a named device with generated credentials |
| `POST` | `/devices/provision` | Validate device credentials and mint Firebase custom token |
| `POST` | `/devices/:deviceId/revoke` | Revoke a device and invalidate Firebase refresh tokens |
| `DELETE` | `/devices/:deviceId?ownerUid=...` | Delete an owned device |

Important behavior:

- device ownership accepts either a Firebase UID or database UUID for `ownerUid`
- claimed devices are stored with a hashed secret, not a raw secret
- claimed `deviceSecret` values may include an embedded owner hint, but devices still submit that same single secret during provisioning
- provisioning returns a Firebase custom token plus owner-scoped Realtime Database paths
- history queries support `start`, `end`, and `limit`

### Configuration routes

Defined in `mwbe/src/routes/configuration.js`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/configuration/radio-network?ownerUid=...` | Persist a radio network config under the owner in Firebase Realtime Database |

The body schema requires:

- `version`
- `gateways`
- `nodes`

Each node includes:

- `nodeId`
- `role`
- `preferredGateway`
- `fallbackGateway`
- `enabled`

## Request and response patterns

The API uses Fastify JSON schemas for validation and OpenAPI generation. Common patterns include:

- `ownerUid` query parameters for ownership validation
- UUID path params for `/users/:id`
- structured error payloads with `statusCode`, `error`, and `message`
- response wrappers such as `{ user: ... }`, `{ users: [...] }`, `{ devices: [...] }`, and `{ deviceId, samples: [...] }`

## Frontend integration points

The frontend primarily consumes these endpoints:

- `POST /users` to ensure a signed-in Firebase user exists in Supabase
- `GET /devices/owned` to load the current user's devices
- `POST /devices/claim` and `DELETE /devices/:deviceId` for hardware lifecycle actions
- `GET /devices/:deviceId/history` for telemetry history views
- `POST /configuration/radio-network` to persist network topology changes

## Swagger and OpenAPI

Swagger UI is enabled by `mwbe/src/plugins/swagger.js`.

- UI: `/docs`
- raw spec: `/documentation/json`

This is the best place to inspect exact schemas while the service is running.

## Related service in this repository

The repository also contains `backend/`, an Express-based telemetry and ESG scoring service. That service is separate from the app-facing `mwbe` API documented here.
