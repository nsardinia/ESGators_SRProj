# ESGators

ESGators is a full-stack demo that connects IoT-based ESG monitoring with dashboard exports and Kalshi demo trading. The frontend handles authentication and user workflows, while the backend ingests sensor data, calculates ESG scores, exports CSV snapshots, and proxies Kalshi APIs.

## Repository Overview

- `frontend/`: React app for authentication, dashboard flows, node views, and Kalshi demo trading
- `backend/`: Express API for IoT ingest, ESG scoring, CSV export, Grafana integration, and Kalshi routes
- `mwbe/`: Fastify service used for supporting API experiments
- `hardware scripts/`: device provisioning and hardware-side helpers

## Use Cases

### 1. Sign in and open the dashboard

1. Open the app and sign in with Firebase Auth email/password credentials.
2. After a successful login, the user is redirected to `/app/dashboard`.
3. The dashboard becomes the main entry point for exporting sensor data and opening the live monitoring dashboard.

### 2. Export CSV data from the Dashboard page

On the Dashboard page, users can download CSV snapshots by time range:

- `Export Day CSV`: downloads one day of sensor readings
- `Export Week CSV`: downloads one week of sensor readings
- `Export Month CSV`: downloads one month of sensor readings

The frontend calls `GET /iot/export/:range` on the backend. If the database does not have matching rows yet, the backend returns fallback sample data so the export workflow can still be demonstrated.

### 3. Open the monitoring dashboard

The `Open Grafana Dashboard` button opens the live Grafana dashboard in a new browser tab.

- The frontend appends the logged-in user's `uid` and `email` as dashboard query parameters.
- This lets Grafana panels filter metrics for the current owner.
- If `VITE_GRAFANA_DASHBOARD_URL` is missing, the app shows an inline setup message instead of opening a broken link.

### 4. View the current ESG score on the Kalshi API page

The Kalshi API page combines live ESG status with public Kalshi market data.

- `Overall score` shows the latest ESG score calculated from buffered or synced sensor readings.
- `Metric scores` break the score down by environmental categories such as temperature, humidity, air quality, NO2, and noise.
- `Refresh ESG` updates the latest score display.
- Demo scenario buttons can seed strong, mixed, or weak ESG sample data to show how the score changes in real time.

### 5. Preview and place demo trades on the Kalshi API page

The Kalshi API page also supports an ESG-driven demo trading workflow.

- Users can load Kalshi markets and inspect the selected market's status, close time, prices, and orderbook.
- The app requests an ESG-based quote from `GET /kalshi/esg/trade-plan`, which recommends a `buy/sell`, `yes/no`, contract count, limit price, and rationale.
- Users can manually adjust the action, side, and contract count before submitting.
- Clicking `Place ... order` sends the signed demo trade request to `POST /kalshi/esg/trade-order`.
- After submission, the page refreshes the portfolio balance, recent orders, and latest trade result so the user can confirm the order status.
- Public market browsing works with public Kalshi data, but signed demo trading requires both the Kalshi API key and private key to be configured.

## Additional Documentation

- Backend setup and API details: [backend/README.md](backend/README.md)
