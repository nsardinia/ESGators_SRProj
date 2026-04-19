# Fastify Starter (Beginner-Friendly)

This is a generic Fastify starter you can use as a base for:
- user management APIs
- IoT ingestion APIs
- integrations with Supabase/Postgres and Firebase later

This now includes a basic users CRUD connected through Supabase (`supabase-js`).

## 1. What Fastify is

Fastify is a Node.js web framework for building APIs.

Core ideas:
- **Routes**: define endpoints like `GET /health`.
- **Plugins**: modular way to attach features (CORS, auth, DB clients).
- **Schema-first mindset**: you can validate request/response payloads per route.
- **High performance**: built for low overhead and fast request handling.

For your future system, this plugin architecture is useful because you can isolate:
- database clients (Supabase/Postgres)
- Firebase Admin setup
- user/auth routes
- IoT ingestion routes

## 2. Project structure

```txt
.
├── src
│   ├── app.js            # Creates and configures Fastify instance
│   ├── server.js         # Starts HTTP server and handles shutdown
│   ├── plugins
│   │   └── index.js      # Registers framework plugins
│   └── routes
│       ├── index.js      # Registers route modules
│       ├── root.js       # Base routes: / and /health
│       └── users.js      # Users CRUD routes (/users/*)
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## 3. Setup steps

### Step A: Install dependencies

```bash
npm install
```

### Step B: Create your local env file

```bash
cp .env.example .env
```

### Step C: Run in development mode

```bash
npm run dev
```

`nodemon` watches `src/` and restarts automatically when files change.

### Step D: Check the API

Open:
- `http://localhost:3000/`
- `http://localhost:3000/health`
- `http://localhost:3000/users`
- `http://localhost:3000/docs`

## 4. Configure Supabase

1. In Supabase dashboard, copy:
- `Project URL` -> `SUPABASE_URL`
- `service_role` key -> `SUPABASE_SERVICE_ROLE_KEY`
2. Put both values in `.env`.
3. Start server with `npm run dev`.

Create this table in Supabase SQL editor (one-time):

```sql
create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null,
  firebase_uid text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.devices (
  device_id text primary key,
  owner_uid text not null,
  name text not null default '',
  description text not null default '',
  status text not null default 'active',
  device_code_hash text not null,
  latitude double precision,
  longitude double precision,
  location_label text,
  is_location_unknown boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.devices add column if not exists latitude double precision;
alter table public.devices add column if not exists longitude double precision;
alter table public.devices add column if not exists location_label text;
alter table public.devices add column if not exists is_location_unknown boolean not null default true;

create table if not exists public.device_history (
  sample_key text primary key,
  device_id text not null,
  owner_uid text not null,
  owner_firebase_uid text,
  captured_at timestamptz not null,
  source_updated_at timestamptz not null,
  sample_interval_start timestamptz not null,
  no2 double precision,
  sound_level double precision,
  particulate_matter_level double precision,
  temperature double precision,
  humidity double precision,
  raw_payload jsonb not null default '{}'::jsonb
);

create index if not exists device_history_device_interval_idx
  on public.device_history (device_id, sample_interval_start desc);
```

`mwbe` now includes a background sync that polls Firebase Realtime Database every 10 seconds and mirrors the latest supported telemetry into `device_history`.

Relevant env vars:
- `DEVICE_HISTORY_SYNC_ENABLED=true` (set to `false` to disable background sync)
- `DEVICE_HISTORY_POLL_INTERVAL_MS=10000`
- `DEVICE_HISTORY_MAX_SNAPSHOT_AGE_MS=30000`

If a Firebase snapshot is older than `DEVICE_HISTORY_MAX_SNAPSHOT_AGE_MS`, MWBE skips it instead of writing stale history rows. This helps avoid wasting compute on devices that have gone offline but still have an old last-known payload in RTDB.

## 4-1. IoT Dummy API deprecation notice

`mwbe` IoT dummy endpoints are now deprecated.

- Deprecated in `mwbe`: `/iot/dummy`, `/iot/data`, `/iot/metrics`
- Use `backend` service for dummy generation and Grafana metrics push tests.

## 5. Basic concepts in this starter

### `src/app.js`
- Builds the Fastify instance.
- Enables structured logging.
- Registers plugins and routes.
- Exports a function so app creation stays testable.

### `src/server.js`
- Loads environment variables from `.env`.
- Starts the server using `HOST` and `PORT`.
- Handles startup errors and graceful shutdown (`SIGINT`, `SIGTERM`).

### `src/plugins/index.js`
- Registers:
  - `@fastify/sensible` (helper errors/utilities)
  - `@fastify/helmet` (secure HTTP headers)
  - `@fastify/cors` (cross-origin browser access)
  - Swagger/OpenAPI docs at `/docs`
  - Supabase plugin (`src/plugins/supabase.js`) that decorates `app.supabase`

### `src/routes/root.js`
- `GET /health` for monitoring.
- `GET /` basic starter response.

### `src/routes/users.js`
- `GET /users` list users
- `GET /users/:id` fetch one user
- `POST /users` create user
- `PUT /users/:id` update user
- `DELETE /users/:id` delete user

### `src/routes/devices.js`
- `GET /devices/owned` list the authenticated caller's devices
- `GET /devices/network` list network devices including persisted location fields
- `GET /devices/:deviceId/history?limit=360` fetch historical telemetry for one authenticated caller device
- `PUT /devices/:deviceId/location` update a node's persisted map position
- `POST /devices/provision` mint a Firebase custom token for a device

Claimed device secrets remain a single `deviceSecret` value. Newer secrets can carry an embedded owner hint so hardware clients do not need a separate owner UID environment variable.

Protected owner-scoped routes now require a Firebase user ID token in the `Authorization: Bearer <token>` header. The backend derives the owner from the verified token instead of trusting `ownerUid` from the client.

## 6. Scripts

- `npm run dev`: run with autoreload.
- `npm start`: run normally (production-style startup).
- `npm run dummy-device`: provision a test device and publish Firebase telemetry every second.
- `npm test`: placeholder for Node test runner.

### Dummy device driver

To test the real device flow from your laptop, use [`mwbe/scripts/dummy-device-driver.js`](/home/nicholas/srproj/ESGators_SRProj/mwbe/scripts/dummy-device-driver.js).

Required values:
- `DUMMY_DEVICE_ID`
- `DUMMY_DEVICE_SECRET`
- `DUMMY_DEVICE_FIREBASE_API_KEY`
- `DUMMY_DEVICE_FIREBASE_DATABASE_URL`
- `DUMMY_DEVICE_BACKEND_BASE_URL` (defaults to `http://localhost:3000`)

The script automatically loads [`mwbe/.env.dummy-device.example`](/home/nicholas/srproj/ESGators_SRProj/mwbe/.env.dummy-device.example) as a template pattern and expects your real local values in `mwbe/.env.dummy-device`.

Optional values:
- `DUMMY_DEVICE_INTERVAL_MS=1000`
- `DUMMY_DEVICE_PROFILE=full` for devices with PM
- `DUMMY_DEVICE_PROFILE=basic` for devices without PM
- `DUMMY_DEVICE_LOG_RESPONSES=true`

Example:

```bash
cp .env.dummy-device.example .env.dummy-device
# edit .env.dummy-device with your device credentials
npm run dummy-device
```

If you want to use a different file, run:

```bash
npm run dummy-device -- --env-file .env.some-other-device
```

The script:
- calls `POST /devices/provision`
- exchanges the returned Firebase custom token for a Firebase ID token
- refreshes that token automatically when needed
- writes simulated telemetry every second to the provisioned RTDB device path

## Swagger Docs

Swagger UI is available at:

- `http://localhost:3000/docs`

Raw OpenAPI JSON is available at:

- `http://localhost:3000/documentation/json`

If you deploy behind a public host, set `PUBLIC_API_BASE_URL` in `.env` so the generated server URL in Swagger matches the deployed API origin.

## Docker

### Build and run with Docker

```bash
docker build -t mwbe-api:latest .
docker run --rm -p 3000:3000 --env-file .env mwbe-api:latest
```

### Run with Docker Compose

```bash
cp .env.example .env
# Fill in your real Supabase values in .env
docker compose up --build -d
```

Stop compose:

```bash
docker compose down
```

## Fly.io Deployment

### Prerequisites

1. Install `flyctl`: https://fly.io/docs/flyctl/install/
2. Login:

```bash
fly auth login
```

### First-time setup

1. Create the Fly app (if it does not exist yet):

```bash
fly apps create <your-app-name>
```

2. Update `app` in `fly.toml` to match your Fly app name.

3. Set required secrets:

```bash
fly secrets set SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

### Deploy

```bash
fly deploy
```

### Verify

```bash
fly status
fly logs
```

## 7. Quick API test

Create:

```bash
curl -X POST http://localhost:3000/users \
  -H "content-type: application/json" \
  -d '{"email":"test@example.com","name":"Test User"}'
```

List:

```bash
curl http://localhost:3000/users
```

Read one:

```bash
curl http://localhost:3000/users/<USER_ID>
```

Update:

```bash
curl -X PUT http://localhost:3000/users/<USER_ID> \
  -H "content-type: application/json" \
  -d '{"email":"updated@example.com","name":"Updated Name"}'
```

Delete:

```bash
curl -X DELETE http://localhost:3000/users/<USER_ID>
```

## 8. Why this is a good base for your future scope

When you add Firebase later, keep this pattern:
- `src/plugins/firebase.js`
- `src/routes/iot.js`

This keeps boundaries clear and avoids one large `server.js` file.

## 9. Next suggested upgrade path

1. Add request schemas (`schema` in route options) for payload validation.
2. Add a centralized error handler (`app.setErrorHandler`).
3. Add integration tests (e.g. with `node:test` + `app.inject`).
4. Add separate config module for env validation.
