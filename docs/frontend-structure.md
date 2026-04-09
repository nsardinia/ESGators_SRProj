# Frontend Structure

This page documents the `frontend` application, a Vite and React client that handles authentication, route protection, device views, and configuration workflows for ESGators.

## Purpose

The frontend provides:

- public entry pages such as splash and authentication
- authenticated dashboard and profile navigation
- device ownership and monitoring views
- radio network configuration screens
- Firebase authentication and Realtime Database subscriptions

## Technology stack

- Vite for development and bundling
- React for UI composition
- React Router for page routing
- Firebase Web SDK for auth and realtime data
- plain fetch plus shared API base URL helpers for backend calls
- Tailwind-based utility styling plus page-specific CSS files

## Top-level structure

```text
frontend/
├── public/              # Static assets
├── src/
│   ├── main.jsx         # React entry point
│   ├── App.jsx          # Route tree
│   ├── index.css        # Global styles and theme tokens
│   ├── components/      # Shared layout and UI pieces
│   ├── hooks/           # Reusable data hooks
│   ├── lib/             # Firebase, API, and utility helpers
│   ├── pages/           # Route-level screens
│   └── setupTests.js    # Test setup
├── index.html
├── package.json
└── vite.config.js
```

## Application bootstrap

`src/main.jsx` mounts the app into `#root` and wraps it in `React.StrictMode`.

`src/App.jsx` is the routing hub. It:

- wraps the app with `AuthProvider`
- uses `BrowserRouter`
- lazy-loads most route-level screens
- groups authenticated routes behind `ProtectedRoute`

## Route map

### Public routes

| Path | Component | Purpose |
| --- | --- | --- |
| `/` | `SplashPage` | Landing page |
| `/auth` | `AuthPage` | Authentication flow |

### Authenticated app routes

These routes render inside `AppShell`:

| Path | Component | Purpose |
| --- | --- | --- |
| `/app/dashboard` | `DashboardPage` | Main dashboard |
| `/app/node-map` | `NodeMapPage` | Current user's devices and map-oriented view |
| `/app/global-node-map` | `GlobalNodeMap` | Network-wide view |
| `/app/hardware` | `HardwarePage` | Hardware and provisioning workflows |
| `/app/configuration` | `ConfigurationPage` | Radio network configuration |

### Authenticated profile routes

These routes render inside `ProfileShell`:

| Path | Component | Purpose |
| --- | --- | --- |
| `/profile/account` | `AccountPage` | Account settings |
| `/profile/preferences` | `PreferencesPage` | User preferences |
| `/profile/billing` | `BillingPage` | Billing placeholder page |
| `/profile/security` | `SecurityPage` | Security settings |

## Folder responsibilities

### `src/components`

Shared UI and layout components live here.

- `AppShell.jsx`: sidebar shell for the main authenticated app
- `ProfileShell.jsx`: settings-oriented shell for profile pages
- `ProtectedRoute.jsx`: redirects unauthenticated users to `/auth`
- `AuthContext.jsx`: central auth state provider
- `NodeNetwork.jsx`: node and network visualization component
- `components/ui/*`: shared low-level UI primitives such as buttons, inputs, cards, and textareas

### `src/pages`

Each file is a route-level screen that composes hooks, API calls, and shared components.

- `SplashPage.jsx`: public landing page
- `AuthPage.jsx`: login and authentication UX
- `DashboardPage.jsx`: primary application dashboard
- `NodeMapPage.jsx`: user-owned device monitoring
- `GlobalNodeMap.jsx`: broader network map
- `HardwarePage.jsx`: hardware lifecycle and provisioning UI
- `ConfigurationPage.jsx`: configuration editor for radio networks
- `pages/profile/*`: profile subsection pages

### `src/hooks`

- `useOwnedNodes.js`: the main domain hook for syncing the signed-in user, loading owned devices from the API, and subscribing to live Firebase updates per device

### `src/lib`

- `api.js`: chooses the backend base URL from Vite environment variables
- `firebase.js`: initializes Firebase Auth and Realtime Database and surfaces configuration status
- `utils.js`: shared helper utilities such as class name merging

## Auth flow

Authentication is centered around `AuthContext.jsx` and `ProtectedRoute.jsx`.

1. `AuthProvider` subscribes to Firebase auth state with `onAuthStateChanged`.
2. Protected routes wait for auth loading to finish.
3. Unauthenticated users are redirected to `/auth`.
4. If Firebase environment variables are missing, the app disables auth-backed flows and notifies the user.

Important detail:

- route protection is a client-side UX guard, while sensitive enforcement is still expected from backend and Firebase rules

## Data flow for owned devices

`useOwnedNodes.js` is the clearest example of the frontend's core data flow.

1. Read the current Firebase user from auth context.
2. `POST /users` to ensure a matching owner exists in Supabase.
3. `GET /devices/owned?ownerUid=<firebase uid>` to fetch the user's devices.
4. Subscribe to `users/<firebase_uid>/devices/<deviceId>` in Firebase Realtime Database for live telemetry.
5. Merge API metadata and live telemetry into the local node model consumed by pages.

This means the frontend uses the backend for durable ownership metadata and Firebase for low-latency live updates.

## Layout shells

### `AppShell.jsx`

This shell provides:

- collapsible sidebar navigation
- sign-out entry point
- link to profile settings
- nested `<Outlet />` rendering for authenticated app pages

### `ProfileShell.jsx`

This shell provides:

- separate settings navigation
- return link back to the main app
- sign-out action
- nested `<Outlet />` rendering for profile pages

## Environment variables

The frontend expects Vite-prefixed variables in `frontend/.env.example`.

### Firebase configuration

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_DATABASE_URL`

### Backend targeting

- `VITE_API_TARGET`
- `VITE_API_LOCAL_BASE_URL`
- `VITE_API_PRODUCTION_BASE_URL`
- optionally `VITE_API_BASE_URL` to override all automatic selection

`src/lib/api.js` resolves the base URL in this order:

1. `VITE_API_BASE_URL`
2. production target override
3. local target override
4. hardcoded fallback values

## Testing

The frontend uses Vitest.

Common commands from `frontend/`:

```bash
npm install
npm run dev
npm run test
```

Current test coverage in the repository includes `src/pages/DashboardPage.test.jsx` plus shared test setup in `src/setupTests.js`.

## Maintenance notes

When adding new frontend features, keep these conventions consistent:

- add new route-level screens under `src/pages`
- keep shared data access in hooks or `src/lib`
- place auth-dependent sections behind `ProtectedRoute`
- update `App.jsx` whenever a new page becomes part of the route tree
