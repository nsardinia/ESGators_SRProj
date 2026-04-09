# ESGators Documentation

This MkDocs site documents the two parts of the repository that developers interact with most often:

- the `mwbe` backend API that powers account, device, and configuration workflows
- the `frontend` Vite and React application that consumes that API and renders the user experience

## Repository overview

The repository contains multiple services and supporting assets:

```text
ESGators_SRProj/
├── backend/           # Express telemetry and ESG scoring service
├── frontend/          # Vite + React web application
├── mwbe/              # Fastify REST API for users, devices, and configuration
├── hardware scripts/  # Embedded and provisioning scripts
├── firebase-rtdb.rules.json
└── mkdocs.yml
```

## Documentation map

### Backend API

Use the [Backend API](backend-api.md) page for:

- service purpose
- route groups and endpoint summaries
- required environment variables
- integration points with Supabase and Firebase
- links to generated Swagger docs in local development

### Frontend Structure

Use the [Frontend Structure](frontend-structure.md) page for:

- application entry points
- routing and shell layout
- folder responsibilities
- auth and data flow
- environment variable usage

## Serving the docs locally

Install MkDocs in your Python environment, then run:

```bash
mkdocs serve
```

By default the site will be available at `http://127.0.0.1:8000`.
