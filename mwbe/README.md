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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## 4-1. Configure Grafana Cloud (required for metrics push)

If you use IoT endpoints (`/iot/data`, `/iot/dummy`) and want data to be pushed to Grafana Cloud, these `.env` values are required:

- `GRAFANA_USERNAME`
- `GRAFANA_API_KEY`
- `GRAFANA_PUSH_URL` (example: `https://prometheus-prod-49-prod-ap-northeast-0.grafana.net/api/prom/push`)

Without these values, the API still runs, but Grafana push is skipped.

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

## 6. Scripts

- `npm run dev`: run with autoreload.
- `npm start`: run normally (production-style startup).
- `npm test`: placeholder for Node test runner.

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

If you use Grafana metrics push in Fly, set these secrets too:

```bash
fly secrets set GRAFANA_USERNAME=YOUR_INSTANCE_ID GRAFANA_API_KEY=YOUR_GRAFANA_TOKEN GRAFANA_PUSH_URL=https://prometheus-prod-49-prod-ap-northeast-0.grafana.net/api/prom/push
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
