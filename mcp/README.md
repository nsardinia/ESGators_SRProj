# ESGators MCP Integration

This MCP server exposes your IoT dashboard data to ChatGPT or other MCP clients.

It supports:
- realtime Firebase RTDB device reads
- historical Supabase sensor reads
- anomaly and ESG context
- ChatGPT-friendly `search` and `fetch` tools

## What ChatGPT Needs

For ChatGPT custom connectors using MCP, you should run this server over a remote HTTP transport instead of local stdio.

Recommended transport:
- `http` with stateless mode enabled for hosted deployments

Also exposed:
- `streamable-http`
- `sse`
- `stdio` for local testing

## Local Test

From the repo root:

```bash
./.venv/bin/python mcp/testmcp.py
```

To test a specific device:

```bash
MCP_TEST_DEVICE_ID=your-device-id ./.venv/bin/python mcp/testmcp.py
```

## Run For ChatGPT

Start your backend first:

```bash
npm --prefix backend run dev
```

Then start the MCP server in HTTP mode:

```bash
./.venv/bin/python mcp/mcpserver.py \
  --transport http \
  --host 0.0.0.0 \
  --port 8000 \
  --path /mcp \
  --stateless-http
```

If you prefer env vars, add these to `backend/.env`:

```dotenv
MCP_BACKEND_BASE_URL=http://localhost:5000
MCP_TRANSPORT=http
MCP_HOST=0.0.0.0
MCP_PORT=8000
MCP_PATH=/mcp
FASTMCP_STATELESS_HTTP=true
```

## Expose It Publicly

ChatGPT needs a remotely reachable HTTPS URL for custom MCP connectors.

Examples:
- deploy the server behind your own HTTPS domain
- expose your local server with a secure HTTPS tunnel

Your final connector URL should look like:

```text
https://your-public-domain.example/mcp
```

## Hosting Option

One straightforward hosting option is to deploy the MCP server as a Docker container on Render, Railway, Fly.io, or any VPS/container platform.

This repo now includes:
- [`mcp/Dockerfile`](/home/nicholas/srproj/ESGators_SRProj/mcp/Dockerfile)
- [`mcp/requirements.txt`](/home/nicholas/srproj/ESGators_SRProj/mcp/requirements.txt)

Build and run it locally:

```bash
docker build -f mcp/Dockerfile -t esgators-mcp .
docker run --rm -p 8000:8000 \
  -e MCP_BACKEND_BASE_URL=https://your-backend.example \
  -e SUPABASE_URL=https://your-project.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
  -e FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com \
  -e FIREBASE_PROJECT_ID=your-firebase-project-id \
  -e FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com \
  -e FIREBASE_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n' \
  -e FIREBASE_DEVICE_ROOT_PATH='users/{owner_uid}/devices' \
  esgators-mcp
```

After you publish it behind HTTPS, your connector URL should look like:

```text
https://your-mcp.example/mcp
```

Notes:
- the hosted MCP service needs network access to your backend, Supabase, and Firebase RTDB
- hosted platforms often inject `PORT`; `mcpserver.py` now respects that automatically
- for production, prefer setting secrets in the hosting platform instead of baking them into the image
- for OpenAI-hosted MCP clients, prefer FastMCP `http` transport with stateless mode instead of stateful `streamable-http`
- your RTDB rules in [`firebase-rtdb.rules.json`](/home/nicholas/srproj/ESGators_SRProj/firebase-rtdb.rules.json) only allow authenticated reads under `users/<firebase_uid>/...`, so hosted MCP should use Firebase Admin credentials instead of anonymous REST reads
- the MCP server now supports `FIREBASE_SERVICE_ACCOUNT_JSON` or the split env vars `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`
- if your data lives at `users/<firebase_uid>/devices/<deviceId>`, set `FIREBASE_DEVICE_ROOT_PATH=users/{owner_uid}/devices`

## Fly.io Secrets

To deploy the hosted MCP server on Fly with Firebase Admin access, set these secrets on the Fly app:

```bash
set -a
source backend/.env
set +a

fly secrets set -a your-mcp-app-name-winter-thunder-1708 \
  MCP_BACKEND_BASE_URL=https://backend-bitter-morning-1805.fly.dev \
  SUPABASE_URL="$SUPABASE_URL" \
  SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  FIREBASE_DATABASE_URL="$FIREBASE_DATABASE_URL" \
  FIREBASE_PROJECT_ID="$FIREBASE_PROJECT_ID" \
  FIREBASE_CLIENT_EMAIL="$FIREBASE_CLIENT_EMAIL" \
  FIREBASE_PRIVATE_KEY="$FIREBASE_PRIVATE_KEY" \
  FIREBASE_DEVICE_ROOT_PATH='users/{owner_uid}/devices' \
  MCP_TRANSPORT=http \
  MCP_HOST=0.0.0.0 \
  MCP_PORT=8000 \
  MCP_PATH=/mcp \
  FASTMCP_STATELESS_HTTP=true
```

If you prefer a single secret instead of split vars, you can also set `FIREBASE_SERVICE_ACCOUNT_JSON` to the full JSON service account payload.

## ChatGPT Setup

In ChatGPT, create a custom MCP connector and point it at your public MCP endpoint.

Use:
- Server URL: `https://your-public-domain.example/mcp`

ChatGPT can then call these tools:
- `search`
- `fetch`
- `get_device_latest`
- `get_device_history`
- `get_device_inference_context`
- `list_devices`
- `get_backend_status`
- `get_mcp_context`

For end-to-end retrieval inside ChatGPT, start with:
- `search("greenhouse")`
- `fetch("device:dev_...")`

That gives ChatGPT both a searchable entrypoint and detailed device context for inference.

## OpenAI API Demo

The same remote MCP server can also be used through the OpenAI Responses API.

Set:

```bash
export OPENAI_API_KEY=your-openai-api-key
export OPENAI_MCP_SERVER_URL=https://your-public-domain.example/mcp
```

Then run:

```bash
python3 mcp/openai_responses_demo.py
```

Optional:

```bash
export OPENAI_MODEL=gpt-5
export OPENAI_MCP_PROMPT="Use the ESGators MCP tools to analyze device dev_123 and explain any anomalies."
```

## Suggested ChatGPT Prompt

After connecting the server, try:

```text
Use the ESGators MCP tools to inspect my greenhouse device. Summarize the latest readings, compare them with the last 24 hours of historical values, identify anomalies, and explain any likely environmental issues conservatively.
```

## Notes

- realtime reads come from Firebase RTDB
- history reads come from Supabase `sensor_readings`
- owner and device metadata are enriched from Supabase `devices` and `users`
- `get_backend_status` expects the Express backend to be running

## Devices Page Setup

To enable the devices-page assistant in the frontend:

1. Host the MCP server and copy its public HTTPS URL, for example `https://your-mcp.example/mcp`.
2. Add these values to [`backend/.env`](/home/nicholas/srproj/ESGators_SRProj/backend/.env):

```dotenv
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-5
OPENAI_MCP_SERVER_URL=https://your-mcp.example/mcp
OPENAI_MCP_SERVER_LABEL=esgators
```

3. Start the backend with `npm --prefix backend run dev`.
4. Start the frontend with `npm --prefix frontend run dev`.
5. Open the Configuration / Your Devices page and use the new Device Assistant panel.
