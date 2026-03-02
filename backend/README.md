# Backend API

Express backend for IoT dummy generation and Grafana Cloud metrics push.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Fill required values in `.env`:
- `PORT` (default: `5000`)
- `GRAFANA_USERNAME`
- `GRAFANA_API_KEY`
- `GRAFANA_PUSH_URL`

4. Run server:

```bash
npm run dev
```

## IoT Test Endpoints

- `POST /iot/dummy`
- `POST /iot/data`
- `GET /iot/metrics`

### Quick dummy test

```bash
curl -X POST http://localhost:5000/iot/dummy \
  -H "Content-Type: application/json" \
  -d '{"count":1,"min":10,"max":20}'
```

## Dummy load test script

`npm run dummy -- ...` supports request scheduling.

### Example (requested format)

```bash
npm run dummy -- --count 60 --interval 1 --min 10 --max 100
```

### Useful options

- `--count`: number of requests to send
- `--interval`: seconds between requests
- `--min`, `--max`: value range for generated data
- `--payload-count`: number of sensor groups generated per request (default: 5)
- `--target local|fly`: choose base URL from env (`DUMMY_BASE_URL_LOCAL`, `DUMMY_BASE_URL_FLY`)
- `--base-url <url>`: explicit URL override
- `--seed <value>`: fixed seed for deterministic test values

### Local / Fly split

Set these in `.env`:

```dotenv
DUMMY_BASE_URL_LOCAL=http://localhost:5000
DUMMY_BASE_URL_FLY=https://your-fly-app.fly.dev
```

Run local:

```bash
npm run dummy -- --target local --count 10 --interval 1
```

Run fly:

```bash
npm run dummy -- --target fly --count 10 --interval 1
```
