# Backend API

Express backend for:
- ingesting IoT sensor data
- pulling sensor rows from an MWBE API that fronts the DB
- exporting Prometheus metrics for scraping and optionally remote-writing them to Grafana Cloud
- flagging threshold-based anomalies for Grafana dashboards
- calculating ESG environmental scores from a rolling buffer or latest streaming values

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` and fill what you need.

Required for Grafana remote write:
- `GRAFANA_USERNAME`
- `GRAFANA_API_KEY`
- `GRAFANA_PUSH_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional for Prometheus scraping:
- scrape `GET /iot/metrics` from your Prometheus server

Optional MWBE sync config:
- `MWBE_API_URL`
- `MWBE_API_METHOD`
- `MWBE_API_TIMEOUT_MS`
- `MWBE_API_HEADERS_JSON`
- `MWBE_API_BODY_JSON`
- `MWBE_API_RESPONSE_PATH`
- `MWBE_API_SENSOR_ID_FIELD`
- `MWBE_API_METRIC_FIELD`
- `MWBE_API_VALUE_FIELD`
- `MWBE_API_TIMESTAMP_FIELD`
- `MWBE_SOURCE_NAME`
- `MWBE_SYNC_INTERVAL_MS`
- `MWBE_SYNC_ON_START`

Optional Firebase RTDB sync config:
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `FIREBASE_DATABASE_URL`
- `VITE_FIREBASE_PROJECT_ID`
- `FIREBASE_DEVICE_ROOT_PATH`
- `FIREBASE_SOURCE_NAME`

Optional threshold override:
- `SENSOR_THRESHOLDS_JSON`

Optional ESG score config:
- `ESG_SCORE_MODE` (`buffered` or `streaming`)
- `ESG_BUFFER_SIZE`
- `ESG_WINDOW_MS`
- `ESG_METRIC_WEIGHTS_JSON`

Example:

```dotenv
PORT=5000
GRAFANA_USERNAME=123456
GRAFANA_API_KEY=glc_xxx
GRAFANA_PUSH_URL=https://prometheus-prod-xx.grafana.net/api/prom/push

MWBE_API_URL=http://localhost:3000/api/sensors/latest
MWBE_API_METHOD=GET
MWBE_API_RESPONSE_PATH=data.items
MWBE_API_SENSOR_ID_FIELD=sensor_id
MWBE_API_METRIC_FIELD=metric_type
MWBE_API_VALUE_FIELD=value
MWBE_API_TIMESTAMP_FIELD=timestamp
MWBE_SYNC_INTERVAL_MS=60000
MWBE_SYNC_ON_START=false

FIREBASE_DATABASE_URL=https://senior-project-esgators-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=senior-project-esgators
FIREBASE_DEVICE_ROOT_PATH=devices
FIREBASE_SOURCE_NAME=firebase-rtdb

SENSOR_THRESHOLDS_JSON={"temperature":{"min":18,"max":28},"humidity":{"min":30,"max":60}}
```

3. Run server:

```bash
npm run dev
```

## Running tests

- `POST /iot/dummy`
- `POST /iot/data`
- `GET /iot/metrics`
- `GET /iot/export/day`
- `GET /iot/export/week`
- `GET /iot/export/month`

### Sensor export

`POST /iot/data` stores sensor samples in Supabase table `sensor_readings`.

Assumed table shape:

```sql
create table sensor_readings (
  id uuid primary key default gen_random_uuid(),
  sensor_id text not null,
  metric_type text not null,
  value double precision not null,
  recorded_at timestamptz not null,
  created_at timestamptz not null default now()
);
```

CSV download examples:

```bash
curl -L "http://localhost:5000/iot/export/day" -o sensor-readings-day.csv
curl -L "http://localhost:5000/iot/export/week?sensor_id=sensor-a" -o sensor-readings-week.csv
curl -L "http://localhost:5000/iot/export/month?metric_type=temperature" -o sensor-readings-month.csv
```

If Supabase has no matching rows yet, the export API returns fallback `th` sample data
(`th-01`, `th-02` with `temperature` and `humidity`) so frontend download testing can proceed.

### Quick dummy test

```bash
npm install
```

Run the full backend test suite:

```bash
npm test
```

Run only the ESG score-related test file:

```bash
node --test test/app.test.js
```

The ESG score test is in `backend/test/app.test.js`.
It starts the Express server in-process, sends sample sensor data to `POST /iot/data/batch`, and verifies the calculated ESG values in the response.
It also clears Grafana remote write env vars inside the test, so no separate Grafana setup is required for the test to pass.

## Default thresholds

These are used for anomaly detection unless overridden:

- `air_quality`: green `0-100`, yellow `100-150`, red `150+`
- `no2`: green `0-100`, yellow `100-150`, red `150+`
- `temperature`: red `<18`, green `18-28`, yellow `28-35`, red `35+`
- `humidity`: red `<30`, green `30-60`, yellow `60-80`, red `80+`
- `noise_levels`: green `0-75`, yellow `75-90`, red `90+`

Samples in yellow are marked as `warning`.
Samples in red are marked as `critical`.

## Endpoints

- `GET /iot/metrics`: Prometheus scrape endpoint
- `GET /firebase/status`: Firebase sync config and last sync state
- `GET /firebase/preview/:deviceId`: raw Firebase payload plus normalized Prometheus samples
- `POST /firebase/sync`: sync all Firebase devices or one device via `deviceId`
- `POST /firebase/sync/:deviceId`: sync one Firebase device into Prometheus metrics
- `POST /iot/data`: manually ingest one sample
- `POST /iot/data/batch`: ingest a batch of samples in one request
- `POST /iot/dummy`: generate dummy sensor batches around the configured threshold ranges
- `GET /iot/anomalies`: latest anomaly state and recent MWBE samples
- `GET /iot/thresholds`: current thresholds
- `PUT /iot/thresholds`: update thresholds at runtime
- `GET /esg/status`: current ESG score mode, buffer state, and latest score
- `GET /mwbe/status`: current MWBE sync config and sync status
- `PUT /mwbe/config`: update MWBE API config at runtime
- `POST /mwbe/sync`: trigger one immediate MWBE fetch and Prometheus push

Manual ingest example:

```bash
curl -X POST http://localhost:5000/iot/data \
  -H "Content-Type: application/json" \
  -d '{"sensor_id":"sensor-1","metric_type":"temperature","value":31.2,"source":"manual"}'
```

Runtime threshold update example:

```bash
curl -X PUT http://localhost:5000/iot/thresholds \
  -H "Content-Type: application/json" \
  -d '{"temperature":{"min":17,"max":27},"noise_levels":{"min":35,"max":70}}'
```

Runtime MWBE config update example:

```bash
curl -X PUT http://localhost:5000/mwbe/config \
  -H "Content-Type: application/json" \
  -d '{
    "url":"http://localhost:3000/api/sensors/latest",
    "method":"GET",
    "responsePath":"data.items",
    "sensorIdField":"sensor_id",
    "metricField":"metric_type",
    "valueField":"value",
    "timestampField":"timestamp",
    "syncIntervalMs":30000,
    "syncOnStart":true
  }'
```

Manual MWBE sync example:

```bash
curl -X POST http://localhost:5000/mwbe/sync
```

Firebase preview example:

```bash
curl http://localhost:5000/firebase/preview/dev_472584440bca1b56b0518a6620641d39
```

Firebase sync example:

```bash
curl -X POST http://localhost:5000/firebase/sync/dev_472584440bca1b56b0518a6620641d39
```

Current Firebase device mapping:

- `sht30.latest.temperatureC` -> `temperature`
- `sht30.latest.humidityPct` -> `humidity`
- `no2.latest.raw` -> `no2`
- `sound.latest.raw` -> `noise_levels`
- `pms5003.latest.aqi` or `pms5003.latest.airQuality` -> `air_quality`

If a Firebase `updatedAtMs` value is not an absolute Unix timestamp, the backend falls back to the current server time before sending the sample to Prometheus.

If `backend/firebase-key.json` or `FIREBASE_SERVICE_ACCOUNT_JSON` is not available yet, the backend falls back to read-only Firebase REST GET using `FIREBASE_DATABASE_URL` or `VITE_FIREBASE_PROJECT_ID`.
That fallback only works when RTDB security rules allow read access for the requested path.

## Prometheus metrics for Grafana

This backend sends ESG and sensor values to Prometheus in the standard way by exposing `GET /iot/metrics`.
Prometheus should scrape that endpoint, and Grafana should query the Prometheus datasource.

If `GRAFANA_USERNAME`, `GRAFANA_API_KEY`, and `GRAFANA_PUSH_URL` are also configured, the backend additionally performs remote write to Grafana Cloud.
If those values are missing, ingestion still succeeds and the API response includes `pushResult.skipped=true`.

Main metrics:

- `sensor_data_metric{sensor_id,metric_type,source,owner_uid,owner_email,device_name}`
- `sensor_data_threshold_min{metric_type,unit}`
- `sensor_data_threshold_max{metric_type,unit}`
- `sensor_data_anomaly_flag{sensor_id,metric_type,source,owner_uid,owner_email,device_name,severity}`
- `sensor_data_anomaly_score{sensor_id,metric_type,source,owner_uid,owner_email,device_name}`
- `sensor_data_anomaly_total{sensor_id,metric_type,source,owner_uid,owner_email,device_name,severity}`
- `sensor_data_last_timestamp_ms{sensor_id,metric_type,source,owner_uid,owner_email,device_name}`
- `esg_environment_score{scope}`
- `esg_environment_metric_score{metric_type}`
- `esg_sensor_score{sensor_id,owner_uid,owner_email,device_name}`
- `esg_buffer_size`
- `mwbe_sync_runs_total{status}`
- `mwbe_sync_duration_seconds`
- `mwbe_last_sync_timestamp_ms`
- `mwbe_last_sync_sample_count`

Prometheus scrape example:

```yaml
scrape_configs:
  - job_name: esg-backend
    metrics_path: /iot/metrics
    static_configs:
      - targets:
          - localhost:5000
```

## Grafana panel ideas

Use these PromQL examples directly in Grafana:

Current sensor values:

```promql
sensor_data_metric
```

Current sensor values for the logged-in owner and selected device/metric:

```promql
sensor_data_metric{owner_uid="$owner_uid",sensor_id=~"$sensor_id",metric_type=~"$metric_type"}
```

Current ESG overall score:

```promql
esg_environment_score{scope="overall"}
```

ESG score by metric:

```promql
esg_environment_metric_score
```

ESG score by sensor:

```promql
esg_sensor_score
```

ESG score by sensor for the logged-in owner:

```promql
esg_sensor_score{owner_uid="$owner_uid",sensor_id=~"$sensor_id"}
```

Active anomalies only:

```promql
sensor_data_anomaly_flag > 0
```

Critical anomalies by sensor:

```promql
sensor_data_anomaly_flag{severity="critical"} > 0
```

Anomaly count over 1 hour:

```promql
increase(sensor_data_anomaly_total[1h])
```

Latest anomaly score:

```promql
sensor_data_anomaly_score
```

MWBE sync failures:

```promql
increase(mwbe_sync_runs_total{status="error"}[15m])
```

Average temperature over 15 minutes:

```promql
avg_over_time(sensor_data_metric{metric_type="temperature"}[15m])
```

Average temperature over 15 minutes for the logged-in owner:

```promql
avg_over_time(sensor_data_metric{owner_uid="$owner_uid",metric_type="temperature",sensor_id=~"$sensor_id"}[15m])
```

Latest critical anomaly count by sensor:

```promql
sum by (sensor_id) (sensor_data_anomaly_flag{severity="critical"})
```

## Dummy load test script

`npm run dummy -- ...` sends repeated requests to `/iot/dummy`.

Example:

```bash
npm run dummy -- --count 60 --interval 1
```

Useful options:

- `--count`: number of requests to send
- `--interval`: seconds between requests
- `--payload-count`: number of sensor groups generated per request
- `--target local|fly`
- `--base-url <url>`
- `--seed <value>`

## Anomaly test script

`npm run anomaly -- ...` sends out-of-threshold samples to `/iot/data/batch`.

Example:

```bash
npm run anomaly
```

Useful options:

- `--count`: number of request cycles
- `--interval`: seconds between request cycles
- `--input-mode random|remote`: default `random`
- `--input-url <url>`: remote source URL used when `--input-mode remote`
- `--input-method GET|POST`: remote source method, default `GET`
- `--response-path <dot.path>`: remote payload path to the sample array
- `--sensor-id-field <name>`
- `--metric-field <name>`
- `--value-field <name>`
- `--timestamp-field <name>`
- `--input-headers <json>`
- `--payload-count`: number of sensor ids generated per cycle, default `1`
- `--metric-type all|temperature|humidity|air_quality|no2|noise_levels`
- `--severity warning|critical`
- `--direction high|low`
- `--pattern <csv>`: default `normal,anomaly`
- `--sensor-prefix <prefix>`: default `dummy-sensor`, so generated ids match the existing dummy format
- `--source <label>`
- `--target local|fly`
- `--base-url <url>`

The script first calls `GET /iot/thresholds`, then sends batch payloads to `POST /iot/data/batch`.
Default behavior is:
- 5 total sends
- 5 second interval
- `dummy-sensor-1`
- all 5 metric types
- repeating pattern: `normal, anomaly`
- values are randomized inside the selected normal/anomaly range on every cycle
- each cycle logs the actual values it sent, and backend forwards timestamped samples to Prometheus remote write

Remote mode example:

```bash
npm run anomaly -- --input-mode remote --input-url https://example.com/api/sensors --response-path data.items
```

Random mode example:

```bash
npm run anomaly -- --input-mode random --base-url https://your-backend.example.com --metric-type temperature --severity critical --direction high
```

## ESG scoring

This backend now supports two ESG scoring modes:

- `buffered`: keep an in-memory rolling buffer and calculate the score from the recent window
- `streaming`: keep only the latest value for each sensor/metric series and calculate immediately

The current implementation uses an in-memory buffer only, so it survives requests but not process restarts.
That fits the current architecture where the sensor node sends data to backend and backend forwards metrics directly to Prometheus.
If you later need long-term ESG history, a real database or time-series store should be added before Prometheus remote write.

Threshold definitions are also stored in English JSON here:
- `backend/sensor-thresholds.json`

## Notes

- MWBE response parsing is intentionally field/path based so the upstream API shape can be changed without code edits.
- Runtime overrides from `PUT /mwbe/config` and `PUT /iot/thresholds` stay in memory until the process restarts.
- MWBE polling stays disabled until `MWBE_API_URL` is configured.
- If Grafana credentials are missing, ingestion still works but remote write is skipped.
- GitHub Actions runs `backend` tests on backend-related pushes and pull requests.
- Fly.io deployment runs automatically only when `main` receives a push that changes `backend/**`.
- Set the GitHub repository secret `FLY_API_TOKEN` before expecting automatic deployment.
- A local `git commit` alone does not deploy anything. The deployment trigger is the GitHub `push` event.
