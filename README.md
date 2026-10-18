# StageConnect API

Artist booking API implemented with Node.js, TypeScript, Express 5, **Sequelize 6**, and PostgreSQL. It includes the four requested endpoints, JWT authentication, a booking state machine, concurrency protection, and integration tests against real PostgreSQL.

For the app already configured on this computer, see [LOCAL_SETUP.md](LOCAL_SETUP.md). Use the instructions below for a fresh installation.

## Run locally

Requirements: Node.js 22+ and PostgreSQL 14+ with the `btree_gist` extension available. The included Compose file uses PostgreSQL 18 and exposes it on **localhost:5433**, avoiding the usual local PostgreSQL port.

```sh
npm ci
cp .env.example .env
docker compose up -d db
```

If PostgreSQL is already installed, create separate development and test databases and set their URLs in `.env` instead of starting Docker. The test database name must end in `_test`.

Generate a signing secret and paste it into `JWT_SECRET` in `.env`:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Set `SEED_PASSWORD` in `.env` to a development-only password of 12 or more characters, no more than 72 UTF-8 bytes. Then run:

```sh
npm run db:migrate
npm run db:seed
npm run dev
```

The API listens on `http://localhost:3000`. `GET /health` checks database connectivity. The seed command prints the IDs of `artist@stageconnect.test` and `client@stageconnect.test`; both use your chosen `SEED_PASSWORD`. Re-running the seed does not overwrite existing credentials. Seeding is disabled outside development.

No registration or review-writing endpoints are added to the assignment. Accounts can be provisioned by a separate trusted process; the development seed supplies accounts for trying the four APIs.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server with restart on changes |
| `npm run typecheck` | Strict TypeScript checks |
| `npm test` | Compile and run the Jest integration, middleware, logging, and input-validation suites |
| `npm run test:compile` | Clean and compile application/test sources into `.test-dist` |
| `npm run build` | Compile the server and administrative scripts |
| `npm start` | Run the compiled server |
| `npm run check` | Typecheck, test, then build |
| `npm run db:migrate` | Apply pending transactional migrations |
| `npm run db:rollback` | Revert the latest migration; destructive, development only |
| `npm run db:migrate:prod` | Run compiled migrations in the production image |
| `npm run db:seed` | Create development accounts and an artist profile |

The initial rollback drops the application tables, so it must only be used on disposable development data. The script refuses rollback with `NODE_ENV=production`.

## Architecture and design patterns

```text
HTTP request
  -> shared middleware: request IDs, security headers, limits, JSON parsing
  -> JWT authentication on protected routes
  -> controller: request schema + HTTP contract
  -> domain service: authorization, workflow and transaction orchestration
  -> repository: Sequelize models and parameterized queries
  -> PostgreSQL constraints
```

- **Controller–Service–Repository:** HTTP handling, business decisions, and persistence have separate responsibilities.
- **Dependency injection:** `app/container.ts` is the composition root. Services receive explicit collaborators; there are no database or service singletons.
- **Finite state machine:** `app/domain/booking-state-machine.ts` owns the permitted transitions, actors, and time guards.
- **Unit of work:** managed Sequelize transactions commit booking changes and audit history together, or roll both back.
- **Response DTOs:** explicit allowlists keep internal model fields out of API responses.
- **Central error translation:** application errors, request parsing failures, and database conflicts use the same response envelope.

```text
app/
  app.ts                     Express application factory and routes
  server.ts                  Startup and graceful shutdown
  container.ts               Dependency composition
  config.ts                  Validated environment settings
  controllers/               HTTP handlers for authentication, bookings and reviews
  middleware/                Request logging and reusable authentication middleware
  routes/v1/                 Version 1 API router mounted at /api/v1
  models/                    Sequelize models and associations
  services/                  Authentication and booking/review business rules
  repositories/              Sequelize queries and persistence
  dto/                       Explicit API response allowlists
  domain/                    Roles and booking transition policy
  shared/                    Validation and response/error handling
  db/
    connection.ts            Sequelize connection pool and transactions
    migrator.ts              Transactional migration runner and ledger
    migrations/              Versioned schema changes
scripts/                     Migration and development seed commands
tests/                       Real PostgreSQL integration tests
```

Sequelize is used for **all database connections and queries**. PostgreSQL-specific constraints and review aggregates use parameterized `sequelize.query` calls where explicit SQL expresses the operation clearly. There is no direct `pg` client in application code and no `sequelize.sync()` or automatic schema mutation at startup.

Migrations run inside a managed transaction, take a database advisory lock, and record successful versions in `schema_migrations`. A failed migration rolls back its schema changes and ledger entry. Apply migrations as a separate deployment step with a database owner account; use a less privileged database account for the API in production.

## Data model

- `users`: UUID, unique normalized email, bcrypt hash, role, active flag, timestamps.
- `artist_profiles`: one per artist; standard fields plus JSONB for variable metadata.
- `bookings`: client, artist, scheduled interval, notes, status and timestamps.
- `reviews`: one per booking; integer score 1–5, comment and creation time.
- `booking_status_history`: prior status, next status, actor and time.

Composite foreign keys use generated role columns to ensure that an artist reference actually points to an artist and a client reference points to a client. Those internal columns are not exposed by the API. Reviews derive the artist through their booking. Referential constraints restrict deleting records that are still referenced.

## Why PostgreSQL instead of MySQL or MongoDB?

**PostgreSQL fits StageConnect because its most important rule is preventing two reservations for the same artist at overlapping times.** Users, artist profiles, bookings, reviews, and status history also have clear relationships. PostgreSQL combines relational constraints, transactions, flexible JSONB metadata, and a database constraint specifically suited to scheduling. This is a choice based on this application's requirements; it is not a claim that PostgreSQL is universally faster or better.

### Booking correctness under concurrent requests

Suppose two pending requests for the same artist cover 18:00–20:00 and 19:00–21:00 on the same day. Two API instances could both check availability before either commits. A validation query by itself would let both confirmations succeed. Checking only when creating the pending requests is also insufficient, because availability can change before approval.

Our service serializes those operations by locking the artist row and rechecking availability inside the transaction. PostgreSQL adds an independent safeguard: the migration defines this exclusion constraint:

```sql
CONSTRAINT bookings_no_reserved_overlap EXCLUDE USING gist (
  artist_id WITH =,
  tstzrange(event_start, event_end, '[)') WITH &&
) WHERE (status IN ('confirmed', 'in_progress', 'completed'))
```

With the `btree_gist` extension, this rejects overlapping reserved intervals for the same artist, including conflicting writes that bypass the service's lock protocol. The `[)` boundary permits adjacent events such as 18:00–20:00 and 20:00–22:00. These range and exclusion features are the decisive advantage for this application. See [PostgreSQL range constraints](https://www.postgresql.org/docs/current/rangetypes.html#RANGETYPES-CONSTRAINT).

Pending requests remain outside the constraint and depend on the service's lock and availability check. Keeping completed and in-progress intervals reserved is this implementation's documented extension of the assignment's confirmed-only minimum.

### How the alternatives compare

| Requirement | PostgreSQL, our choice | MySQL with InnoDB | MongoDB |
| --- | --- | --- | --- |
| Related users, bookings, and reviews | Foreign keys and relational queries | Also supports foreign keys and relational queries | Embedding or document references; cross-collection reference integrity needs application logic |
| Prevent overlapping reservations | Range exclusion constraint plus service transactions | Transaction and locking protocol, or a different reservation model; no equivalent PostgreSQL-style exclusion constraint | Coordinated document updates or a different reservation model; no equivalent range exclusion constraint |
| Flexible artist profiles | Standard columns plus JSONB metadata | Standard columns plus native JSON | Native flexible documents |
| Booking update and audit history | One transaction | One transaction | Multi-document transactions on supported deployments |
| Required Sequelize integration | Supported | Supported | Not a supported Sequelize dialect; requires a different persistence library |

**MySQL is a viable alternative.** Its transactions and locking reads can implement safe booking approval: every scheduling writer must lock the same artist row first, recheck availability using a current locking read, and write within that transaction. A unique key on artist/start/end only rejects identical intervals; a row-level check cannot compare arbitrary overlapping bookings. PostgreSQL lets us additionally express that rule as a declarative constraint. MySQL also has native JSON, so profile flexibility alone does not distinguish these two databases. See [InnoDB locking reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html), [MySQL check constraints](https://dev.mysql.com/doc/refman/8.4/en/create-table-check-constraints.html), and [MySQL JSON](https://dev.mysql.com/doc/refman/8.4/en/json.html).

**MongoDB can implement this application**, including transactions and review aggregation. However, separate documents for users, bookings, and reviews require deliberate reference management. A transaction alone does not make an availability query followed by inserts into different documents mutually exclusive; the design would need shared coordination, such as updating a common artist-calendar document with transaction retries. See [MongoDB data modeling](https://www.mongodb.com/docs/manual/data-modeling/) and [MongoDB transactions](https://www.mongodb.com/docs/manual/core/transactions/). MongoDB would also require replacing Sequelize with its native driver or another ODM; [Sequelize's supported dialects](https://sequelize.org/docs/v6/getting-started/) include PostgreSQL and MySQL.

### Why profiles and reviews stay in PostgreSQL

Artist profiles already store stable fields as columns and variable metadata in JSONB. Attributes such as instruments or portfolio links can fit that metadata without introducing another database. JSONB supports indexing if future query patterns justify it; we do not add speculative indexes. See [PostgreSQL JSON types](https://www.postgresql.org/docs/current/datatype-json.html).

Reviews reference their bookings. The review endpoint joins completed bookings, calculates the global average/count/distribution, and reads the requested page in one statement. This directly matches the requirement and avoids maintaining duplicated booking status in a separate reviews database. Keeping these records together also simplifies migrations, backups, and consistency management.

### Tradeoffs and when to choose differently

Choose MySQL if an existing platform and team expertise make it the operational standard, while preserving and testing the shared locking protocol. Consider MongoDB when independently accessed, evolving documents dominate the workload and its access patterns justify that model; flexible artist profiles alone are insufficient reason to add it here.

The cost of our choice is PostgreSQL-specific SQL, constraints, and the `btree_gist` dependency. Switching databases requires rewriting those migrations and queries and revalidating concurrency behavior; changing Sequelize's `dialect` setting alone is insufficient. Performance decisions would require representative benchmarks rather than a blanket SQL-versus-NoSQL assumption.

## API contract

The API uses URL-based major versioning. The business API base URL is `http://localhost:3000/api/v1` for a fresh setup, or `http://localhost:3001/api/v1` for this computer's configured app. `GET /health` remains an unversioned operational readiness probe.

`app/routes/v1/index.ts` defines the v1 routes; `app/app.ts` mounts that router at `/api/v1`. Breaking contract changes should be introduced through a separate `/api/v2` router, while compatible changes can stay in v1. Authentication, authorization, error envelopes, and request IDs apply as before. HTTP logs retain the complete versioned route template and include `api_version: "v1"` for requests handled by the v1 router.

Clients must update their endpoint URLs to include `/api/v1`. Unversioned business paths and unsupported versions return the standard 404 response for otherwise well-formed requests; there are no redirects or legacy aliases. Unsupported methods on a known v1 endpoint return 405 with `Allow`. The OpenAPI `servers` entries remain host URLs, and its business `paths` already contain `/api/v1`, so API clients must not add the prefix twice.

Import `docs/openapi.json` into an OpenAPI-compatible API client or documentation viewer for the full contract.

```json
{"success":true,"data":{},"error":""}
```

```json
{"success":false,"data":{},"error":"A descriptive message."}
```

All business endpoint responses use this envelope. HTTP HEAD and CORS preflight responses follow their normal bodyless semantics. Request IDs are returned in `X-Request-ID`.

| Endpoint | Access | Successful result |
| --- | --- | --- |
| `POST /api/v1/auth/login` | Public | `200`: token, expiry and user identity |
| `POST /api/v1/bookings` | Client | `201`: `data.booking` with status `pending` |
| `PATCH /api/v1/bookings/:id/status` | Booking participants, subject to transition rules | `200`: updated `data.booking` |
| `GET /api/v1/artists/:id/reviews` | Any authenticated user | `200`: reviews, global summary and pagination |

Send JSON with `Content-Type: application/json`. Protected routes require `Authorization: Bearer <token>`. Extra body fields and extra pagination query parameters are rejected.

Example IDs, timestamps, tokens, and responses below are illustrative. Use the IDs returned by your own login/booking requests and choose future event dates. Responses include `X-Request-ID` for log correlation and `Cache-Control: no-store`.

### Login

`POST /api/v1/auth/login` — public; no Bearer token required.

Both fields are required: a valid email string (maximum 254 characters after normalization) and a nonempty password string (maximum 72 UTF-8 bytes, no NUL).

```json
{"email":"client@stageconnect.test","password":"your development password"}
```

Successful response — `200 OK`:

```json
{
  "success": true,
  "data": {
    "access_token": "<signed-jwt>",
    "token_type": "Bearer",
    "expires_in": 900,
    "user": {
      "id": "22222222-2222-4222-8222-222222222222",
      "role": "client"
    }
  },
  "error": ""
}
```

Use `data.access_token` in subsequent requests. Login as the seeded artist separately to obtain an artist token and the artist's user ID.

Email is trimmed and lowercased consistently. Passwords are never trimmed or normalized. Invalid credentials and disabled accounts all return `401` with `Invalid email or password.` An unknown email still performs bcrypt comparison against a precomputed dummy hash. Malformed requests return `400`.

JWTs use HS256 with explicit algorithm verification and `sub`, `role`, `iat`, `exp`, `iss`, and `aud` claims. The default lifetime is 900 seconds. Protected requests also check that the current database account is active and still has the token's role. No sessions, cookies, refresh tokens or logout endpoint are introduced.

### Authentication middleware

`app/middleware/auth.middleware.ts` exports `createAuthMiddleware(authService)`. The v1 router creates it through dependency injection and attaches it before the controller on `POST /api/v1/bookings`, `PATCH /api/v1/bookings/:id/status`, and `GET /api/v1/artists/:id/reviews` (including its implicit HEAD handler). Login and health checks are public.

For each protected request, the middleware reads `Authorization: Bearer <token>`, calls `AuthService.authenticate`, and stores the verified `{ id, role }` in that response's `res.locals.principal`. The service verifies the JWT and checks the current database account on every call. No authenticated identity is shared between requests or cached in the middleware.

Authentication must succeed before `next()` passes control to a controller. A failure calls `next(error)` and returns immediately, allowing the central error handler to preserve the response envelope. Credential failures return 401 with `WWW-Authenticate: Bearer`; database connection failures remain 503 and unexpected failures remain 500. Role, ownership, and booking-transition rules stay in the business layer. See [Express middleware](https://expressjs.com/en/guide/using-middleware/) and [Express error handling](https://expressjs.com/en/guide/error-handling/).

### HTTP request logging

`app/middleware/request-logging.middleware.ts` runs before CORS, rate limits, body parsing, authentication, and routes. It generates a UUID for each request, returns it in `X-Request-ID`, and binds the same value as `request_id` on a Pino child logger. Client-supplied request IDs are replaced. Allowed browser origins can read the response header through CORS.

Every HTTP access log includes `request_id`, `log_scope: "http"`, method, route template, duration in milliseconds, and the final status. For example, the following structured fields appear together on one JSON log line:

```json
{"level":30,"request_id":"89333f00-3f59-4e94-ae44-ab4a0b3ca5d1","method":"POST","log_scope":"http","api_version":"v1","event":"http_request_completed","route":"/api/v1/bookings","status":201,"duration_ms":18,"msg":"HTTP request completed"}
```

Search your logs for the response's `X-Request-ID` to find its access log and related events. Controllers and middleware use `requestLogger(res)` from `app/shared/logger.ts`; the request ID is automatically included rather than manually repeated at each log call. Authenticated requests also carry the verified user ID and role. Logger state is kept in `res.locals`, so concurrent requests do not share identities or IDs.

| Level | Events |
| --- | --- |
| info | Successful HTTP requests, successful login, committed booking creation and status changes |
| warn | Rejected requests (including authentication, permission, validation, and overlap failures), rate limits, interrupted responses |
| error | Server/database failures and their HTTP access logs |
| debug | Successful authentication and review pagination details |

`LOG_LEVEL=info` is the default; use `LOG_LEVEL=debug` when investigating request flow. Each request produces one terminal access event: `http_request_completed`, or `http_request_aborted` if the response cannot finish. Aborted responses do not claim a final HTTP status. Booking success events are emitted after the service transaction commits. Status history in PostgreSQL remains the durable booking audit trail.

Logs deliberately exclude passwords, JWTs, email addresses, request/response bodies, booking notes, review comments, SQL parameters, raw error messages, and query strings. Paths are logged as route templates (for example `/api/v1/bookings/:id/status`); unmatched paths use `unmatched`. The shared logger also redacts known sensitive fields if accidentally included. Keep log messages static and use explicit safe fields. Startup and command-line output are outside the HTTP request context and have no HTTP request ID. See [Pino child loggers](https://github.com/pinojs/pino/blob/main/docs/child-loggers.md) and [Pino redaction](https://github.com/pinojs/pino/blob/main/docs/redaction.md).

### Create booking

`POST /api/v1/bookings` — requires a client Bearer token.

| Required field | Type | Validation |
| --- | --- | --- |
| `artist_id` | UUID string | Must identify an active artist |
| `event_start` | RFC 3339 string | Explicit timezone; not in the past |
| `event_end` | RFC 3339 string | Explicit timezone; strictly after `event_start` |
| `notes` | String | 1–5,000 characters after trimming; no NUL |

```json
{
  "artist_id":"11111111-1111-4111-8111-111111111111",
  "event_start":"2030-12-10T18:00:00+05:30",
  "event_end":"2030-12-10T20:00:00+05:30",
  "notes":"Acoustic performance for a private event."
}
```

Successful response — `201 Created`. Timestamps are returned in UTC:

```json
{
  "success": true,
  "data": {
    "booking": {
      "id": "33333333-3333-4333-8333-333333333333",
      "artist_id": "11111111-1111-4111-8111-111111111111",
      "client_id": "22222222-2222-4222-8222-222222222222",
      "event_start": "2030-12-10T12:30:00.000Z",
      "event_end": "2030-12-10T14:30:00.000Z",
      "notes": "Acoustic performance for a private event.",
      "status": "pending",
      "created_at": "2030-12-01T10:00:00.000Z",
      "updated_at": "2030-12-01T10:00:00.000Z"
    }
  },
  "error": ""
}
```

Choose dates in the future when exercising the API. Dates must be real RFC 3339 timestamps with explicit timezone and at most three fractional digits. End must be strictly after start. Notes must contain 1–5,000 characters after trimming and must not contain NUL. Client identity and initial status come from the server.

Endpoint-specific failures: `400` for invalid fields or extra properties (including a supplied `client_id` or `status`); `403` for an artist caller; `404` for a missing, inactive, or non-artist account; `409` for a reserved overlap; `422` for a past start or an end that is not after the start. Missing or invalid authentication returns `401` before controller validation.

Intervals are half-open: `[start, end)`. Back-to-back events are allowed. Pending requests may overlap each other; they do not reserve availability. Confirmed, in-progress and completed bookings retain their scheduled intervals. Keeping the reservation as status advances is an explicit strengthening of the assignment's minimum confirmed-only rule. This prevents premature slot release and historical overlaps from late approvals.

Both creation and status changes lock the same artist row. Status changes then lock and reload the booking. Confirmation rechecks availability, and a GiST exclusion constraint independently prevents overlapping reserved intervals from being committed. A pending insert is outside that constraint, so it is protected by the shared artist lock and availability check. No in-memory lock is used.

Transactions use READ COMMITTED with short lock and statement timeouts. Only deadlock and serialization failures, which establish rollback, receive bounded retries. Unknown commit/network outcomes are never automatically retried.

### Booking status

`PATCH /api/v1/bookings/:id/status` — requires a participant's Bearer token and a valid booking UUID in `:id`. The only body field is the required string `status`.

```json
{"status":"confirmed"}
```

Successful response — `200 OK`, with the same complete `data.booking` structure shown above. For this example, `status` becomes `confirmed` and `updated_at` reflects the committed change; the booking ID, participants, event times, notes, and creation time stay the same.

| From | To | Actor | Time guard |
| --- | --- | --- | --- |
| pending | confirmed | Assigned artist | Availability rechecked |
| confirmed | in_progress | Assigned artist | Scheduled start has arrived |
| in_progress | completed | Assigned artist | Scheduled end has arrived |
| pending | cancelled | Assigned artist or owning client | None |
| confirmed | cancelled | Assigned artist or owning client | None |

Unknown status strings, self-transitions, skipped states, and transitions out of terminal states return `422`. A valid transition forbidden to the actor returns `403`. Unrelated callers receive `404` before any state is disclosed. Missing status or invalid input types return `400`.

For example, requesting `completed` while a booking is still `pending` returns `422 Unprocessable Entity` and leaves the booking and history unchanged:

```json
{
  "success": false,
  "data": {},
  "error": "Cannot transition booking from pending to completed. Allowed next statuses: confirmed, cancelled."
}
```

Confirmation can also return `409` if another reservation occupies the interval. Missing or invalid authentication returns `401`; malformed UUIDs and extra body properties return `400`. A missing booking returns `404`.

Time is sampled from PostgreSQL after locks are acquired. There is no automatic progression, late-approval expiry, or extra cancellation deadline. If a confirmed booking is updated late, it still progresses through `in_progress` before `completed`.

### Reviews

`GET /api/v1/artists/:id/reviews?page=1&limit=20`

Requires an artist or client Bearer token and a valid artist UUID in `:id`. No request body is required.

Only reviews joined to completed bookings are eligible. The summary covers **all eligible reviews**, not just the selected page. The page and summary use one SQL statement and one database snapshot. Ordering is `created_at DESC, id DESC`.

- `page`: positive safe integer, default 1.
- `limit`: integer 1–100, default 20.
- Repeated, fractional, empty, unknown or overflowing query parameters are rejected.
- Average score is a decimal string such as `"4.50"` to preserve two decimal places.
- Distribution always contains keys `1` through `5`.
- No reviews: empty list, average `"0.00"`, count 0, all distribution counts 0, total pages 0.
- Page beyond the available data: empty list with the unchanged global summary.
- Unknown artist or ID belonging to a client: `404`.

Successful response — `200 OK`, showing two eligible reviews:

```json
{
  "success": true,
  "data": {
    "artist_id": "11111111-1111-4111-8111-111111111111",
    "reviews": [
      {
        "id": "44444444-4444-4444-8444-444444444444",
        "score": 5,
        "comment": "Great performance.",
        "created_at": "2030-12-11T10:00:00.000Z"
      },
      {
        "id": "55555555-5555-4555-8555-555555555555",
        "score": 4,
        "comment": "Enjoyed the event.",
        "created_at": "2030-12-11T09:00:00.000Z"
      }
    ],
    "summary": {
      "average_score": "4.50",
      "total_count": 2,
      "score_distribution": {"1": 0, "2": 0, "3": 0, "4": 1, "5": 1}
    },
    "pagination": {"page": 1, "limit": 20, "total_pages": 1}
  },
  "error": ""
}
```

Endpoint-specific failures: `400` for a malformed artist UUID or invalid pagination; `401` for missing or invalid authentication; `404` when the artist does not exist. Each review's `comment` can be `null`.

### Curl examples

These commands target the configured app on port 3001. Use port 3000 for a fresh setup with the default port. Replace the placeholder credentials, tokens, and IDs with your own values; the login password is the local `SEED_PASSWORD` value for seeded accounts. Running the booking commands creates or changes records.

```sh
API_BASE_URL='http://localhost:3001/api/v1'

# Login as a client. Repeat with artist@stageconnect.test for the artist token.
curl -i "$API_BASE_URL/auth/login" \
  -H 'Content-Type: application/json' \
  --data '{"email":"client@stageconnect.test","password":"replace-with-your-development-password"}'

CLIENT_TOKEN='paste-client-access-token'
ARTIST_TOKEN='paste-artist-access-token'
ARTIST_ID='paste-artist-user-id-from-login'

# Create a booking using future dates.
curl -i "$API_BASE_URL/bookings" \
  -H "Authorization: Bearer $CLIENT_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @- <<JSON
{
  "artist_id": "$ARTIST_ID",
  "event_start": "2030-12-10T18:00:00+05:30",
  "event_end": "2030-12-10T20:00:00+05:30",
  "notes": "Acoustic performance for a private event."
}
JSON

BOOKING_ID='paste-data.booking.id-from-create-response'

# Confirm using the token of the artist assigned to this booking.
curl -i -X PATCH "$API_BASE_URL/bookings/$BOOKING_ID/status" \
  -H "Authorization: Bearer $ARTIST_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"status":"confirmed"}'

# Read reviews; the newly confirmed booking is not yet review-eligible.
curl -i "$API_BASE_URL/artists/$ARTIST_ID/reviews?page=1&limit=20" \
  -H "Authorization: Bearer $CLIENT_TOKEN"
```

### Health check

`GET /health` — public and unversioned. It returns `200` with `{"success":true,"data":{"status":"ok"},"error":""}` when the database is reachable, or `503` when unavailable. The global request rate limit also applies (`429`). This is outside the `/api/v1` base path: use `http://localhost:3001/health` for the configured app.

### Error status codes

`400` malformed request; `401` invalid authentication; `403` forbidden action; `404` unavailable resource; `405` unsupported method; `409` occupied interval; `413` oversized body; `415` unsupported content type; `422` invalid transition or business input; `429` rate limited; `500` unexpected failure; `503` temporarily unavailable database.

Shared handling: malformed JSON returns `400`; JSON bodies over 32 KB return `413`; POST/PATCH requests without a supported JSON content type return `415`. Authentication failures include `WWW-Authenticate: Bearer`; unsupported methods include `Allow`; temporary service failures include `Retry-After: 1`. Error responses keep `data: {}` and a nonempty error message.

## Testing

Tests use **Jest** with explicit imports from `@jest/globals`, Jest `expect` assertions, and Supertest for HTTP requests. Set `TEST_DATABASE_URL` in `.env` to a dedicated PostgreSQL database ending in `_test`, then:

```sh
npm test

# Run the complete verification used by CI: typecheck, Jest, production build.
npm run check
```

`npm test` first removes and recompiles `.test-dist` using `tsconfig.test.json`, then runs Jest serially with `--runInBand`. The tests execute native ES modules with Node's `--experimental-vm-modules` flag, as described in [Jest's ESM documentation](https://jestjs.io/docs/ecmascript-modules). `jest.config.mjs` uses the Node environment and disables transforms because TypeScript has already compiled the sources. Test artifacts are separate from the production `dist` output and excluded from version control and Docker build context. The existing CI workflow invokes the same Jest suite through `npm run check`.

To run only the required invalid-transition test:

```sh
npm test -- --testNamePattern='required: pending -> completed'
```

Tests apply real migrations. They create uniquely identified fixtures and clean up only their own rows; they do not truncate tables or use SQLite. The required test is named:

> required: pending -> completed returns 422 with descriptive error and no database mutation

It authenticates the assigned artist through the login endpoint, sends the invalid transition, checks the error envelope and message, and proves that both booking state and status history were unchanged.

Additional tests cover credentials, JWT verification on every protected endpoint, middleware error propagation, isolation of client identities during concurrent requests, ownership, calendar validation, overlap boundaries, time gates, review summaries, pagination, and two independent application instances concurrently approving conflicting bookings. The database exclusion constraint is tested separately from the service checks.

## Production notes

- Run `npm run build`, apply migrations, then `npm start`, or build the included Dockerfile. The image runs as a non-root user.
- The Compose credentials are local-development values only. Store production secrets separately and use TLS for ingress and database connections as required by your hosting provider.
- Set `TRUST_PROXY_HOPS` to your actual proxy topology. Do not blindly trust forwarded client IP headers.
- Set `CORS_ORIGINS` to an explicit comma-separated allowlist. With no origins configured, cross-origin browser access is disabled.
- Rate limits default to 300 requests per IP per 15 minutes globally and 20 login attempts per IP per 15 minutes. Their current store is per process; use a shared store or gateway limiter before deploying multiple instances. Database concurrency correctness already works across instances.
- Keep original profile images/videos in object storage if uploads are introduced; JSONB stores their metadata, not the files.
- Logs omit authorization headers, passwords, request bodies, SQL parameters, and private notes. Responses do not expose stack traces or database errors.
- Optional idempotency keys, notifications, caching, registration and review creation are outside this implementation. Retrying a successful booking POST can create another pending request. Repeating a completed status transition returns `422` by contract.
- The lockfile includes a targeted Sequelize `uuid` override to a compatible CommonJS-capable patched version. Dependency audit and integration tests should be rerun when updating it.
- Jest's development tooling uses a targeted `js-yaml` 4 override for `@istanbuljs/load-nyc-config`, avoiding its older `argparse`/`sprintf-js` dependency chain. YAML configuration loading and the Jest suite were verified with this override; review it when updating Jest.

## Reference documentation

- [Sequelize managed transactions](https://sequelize.org/docs/v6/other-topics/transactions/)
- [Sequelize TypeScript support](https://sequelize.org/docs/v6/other-topics/typescript/)
- [PostgreSQL range exclusion constraints](https://www.postgresql.org/docs/current/rangetypes.html)
- [JWT security practices](https://www.rfc-editor.org/rfc/rfc8725.html)
