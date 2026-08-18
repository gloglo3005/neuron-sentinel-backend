# Neuron Sentinel — Backend

REST API for **Neuron Sentinel**, a flood risk prediction and early-warning system for Lomé
(Togo). Serves both the authority dashboard (`../neuron-sentinel`) and the citizen PWA
(`../citizen-pwa`) from a single API.

## Role

- Authenticates both dashboard authorities (ANPC / Mairie / GNSP) and citizens, with two
  separate, mutually exclusive role gates (`requireDashboardAccess` vs `requireCitizenAccess`)
- Owns the PostgreSQL data model (users, zones, environmental data, predictions, alerts,
  incidents, interventions, damage reports) via Prisma
- Wraps three external providers behind a common **MOCK / real** switch, so the app is always
  usable even when a provider isn't configured yet:
  - **Weather** — OpenWeatherMap (real) or deterministic per-zone/per-hour synthetic data (mock)
  - **AI predictions** — a teammate's remote flood-prediction service (real) or a transparent
    scoring function (mock)
  - **SMS** — a real provider (not yet implemented) or console logging (mock)
- Emits realtime events over Socket.IO (`alert.created`, `alert.updated`, `alert.dispatched`,
  `incident.created`, `intervention.updated`, `prediction.updated`) so both frontends update
  live

## Tech stack

- Node.js (ESM, `"type": "module"`) + Express
- Prisma ORM + PostgreSQL
- JWT auth (`jsonwebtoken`), `bcryptjs` for password hashing
- `zod` for request validation
- `socket.io` for realtime events
- `helmet`, `express-rate-limit`, `cors`, `morgan`

> Note: despite some earlier documentation mentioning PostGIS, no PostGIS extension is used —
> zone geometry is a plain JSONB GeoJSON column, and point-in-polygon lookups are done in
> application code (`src/services/zoneLookupService.js`).

## Setup

```bash
npm install
cp .env.example .env   # then fill in the required values below
npx prisma generate
npx prisma migrate deploy   # applies existing migrations as-is (see note below)
npm run seed                # optional: demo accounts + zones
npm run dev
```

The server listens on `http://localhost:4000` by default.

> `migrate deploy` vs `migrate dev`: use `migrate deploy` to apply migrations that already exist
> in `prisma/migrations/` without generating new ones. Use `migrate dev` only when *you* change
> `schema.prisma` yourself and want Prisma to generate and apply a new migration automatically —
> running it against migrations someone else already wrote by hand can create duplicates or
> conflicts.

## Environment variables

See `.env.example` for the full list. Required:

```env
DATABASE_URL=       # PostgreSQL connection string
JWT_SECRET=
PORT=4000
CORS_ORIGIN="http://localhost:5173"
```

Optional — each empty value means the corresponding provider runs in **MOCK** mode:

```env
WEATHER_API_KEY=     # OpenWeatherMap
SATELLITE_API_KEY=   # not implemented yet even when set — see satelliteService.js
SMS_PROVIDER=MOCK
SMS_API_KEY=
SMS_API_SECRET=
SMS_SENDER=NeuronSentinel
AI_API_URL=          # only variable required to enable the real AI provider
AI_API_KEY=          # optional — only needed if your provider requires auth (sent as Bearer token)
```

## Project structure

```text
backend/
├── prisma/
│   ├── schema.prisma
│   ├── seed.js
│   └── migrations/
├── scripts/
│   └── geocodeZones.js     → one-shot CLI helper, real coordinates via OSM/Nominatim
├── src/
│   ├── config/              → env.js, db.js (Prisma client)
│   ├── controllers/         → one file per resource
│   ├── routes/               → one file per resource, mounted under /api
│   ├── middleware/          → auth.js (JWT + role gates), rateLimit.js, errorHandler.js
│   ├── services/             → external-provider wrappers (weather, AI, SMS, geo, satellite)
│   ├── realtime/io.js        → Socket.IO setup + emit()
│   ├── validators/           → zod schemas
│   ├── dto/                  → response shapes for the citizen PWA (never raw Prisma models)
│   ├── utils/                → asyncHandler, permissions matrix
│   ├── app.js                → Express app (middleware, CORS, routing)
│   └── server.js             → HTTP server + Socket.IO + periodic weather sync
├── test-db.js                 → standalone DB connectivity check (`node test-db.js`)
├── .env.example
└── package.json
```

## API routes

```text
POST /api/auth/login
GET  /api/auth/me
POST /api/auth/logout

POST /api/citizen/auth/register
POST /api/citizen/auth/login
GET  /api/citizen/auth/me
POST /api/citizen/location
GET  /api/citizen/zone/current
GET  /api/citizen/alerts
POST /api/citizen/alerts/:alertId/acknowledge
POST /api/citizen/reports
GET  /api/citizen/reports/mine

# Everything below requires a dashboard authority session
# (CIVIL_PROTECTION / AUTHORITY / EMERGENCY_SERVICE)
GET    /api/zones
GET    /api/zones/:id
GET    /api/zones/:id/predictions
POST   /api/zones/sync-geometry

GET    /api/environmental-data
POST   /api/environmental-data/sync

GET    /api/predictions
GET    /api/predictions/:id
POST   /api/predictions/generate

GET    /api/alerts
GET    /api/alerts/:id
GET    /api/alerts/:id/timeline
POST   /api/alerts
POST   /api/alerts/:id/confirm
POST   /api/alerts/:id/request-verification
POST   /api/alerts/:id/reject
POST   /api/alerts/:id/dispatch
POST   /api/alerts/:id/field-engage
POST   /api/alerts/:id/resolve
POST   /api/alerts/:id/close

GET    /api/incidents
POST   /api/incidents
POST   /api/incidents/:id/verify

GET    /api/interventions
POST   /api/interventions
POST   /api/interventions/:id/status

GET    /api/reports
POST   /api/reports

GET    /api/dashboard/summary
```

## Authorization model

- `requireAuth` — verifies the JWT and loads the active user
- `requireDashboardAccess` — only `CIVIL_PROTECTION` / `AUTHORITY` / `EMERGENCY_SERVICE` may
  reach dashboard routes; `ADMIN` and `CITIZEN` are rejected outright
- `requireCitizenAccess` — the mirror image, only `CITIZEN` accounts reach `/api/citizen/*`
- `requireCapability(name)` — fine-grained action gate checked against
  `src/utils/permissions.js`'s server-side capability matrix (the source of truth; any
  frontend button visibility is a UX nicety, not the real authorization boundary)
- Login is hardened on both sides: 5 failed attempts locks an account for 15 minutes, every
  attempt is written to `AuditLog` with the source IP

## Known gaps

- `SATELLITE_API_KEY` has no real implementation behind it yet — setting it does nothing; the
  provider always returns a `MOCK`-tagged placeholder observation
- `SMS_PROVIDER` other than `MOCK` has no real implementation either — dispatching with a real
  provider configured will throw
- The remote AI provider's `flood_probability` scale (0–1 vs 0–100) isn't pinned down by its
  OpenAPI schema, so `aiService.js` handles both defensively rather than assuming one
- The remote AI provider doesn't return a `rainfall_6h` figure; it's approximated as
  `rainfall_1h * 6` (flat extrapolation) until `EnvironmentalData` aggregates a real rolling sum
- `NotificationAcknowledgement` has no unique constraint on `(notificationId, userId)`, so a
  citizen double-tapping "acknowledge" can create duplicate ack rows — harmless for a read
  receipt, not worth a migration on its own