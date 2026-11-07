# IIIT Bhubaneswar Mess Management System

A backend-first, full-stack mess management project with a React verification workspace. The backend is implemented; the complete student, kitchen and administration UI is the next phase.

Payments default to **FAKE**. Successful and failed payments can be simulated without a gateway, credentials or real money. Fake collections are identified separately in reports.

## Run locally

Use Node.js 22.16 or newer. Node 22 may print an experimental warning for its built-in SQLite driver.

```sh
npm ci
cp .env.example .env
npm run db:seed
npm run dev
```

After the initial installation and optional seed, **`npm run dev` starts both the API and React with one command**. Stopping it stops both processes. Development reloads both server and client changes.

| Service | URL |
| --- | --- |
| React workspace | http://localhost:5173 |
| Interactive API explorer | http://localhost:5173/api/docs |
| OpenAPI 3.1 specification | http://localhost:5173/api/openapi.json |
| API health | http://localhost:4000/api/health |

The Vite proxy keeps browser requests on one origin. There is no separate database service to start. Migrations run automatically and SQLite persists in `data/mess.sqlite`.

### Demo accounts

All demo accounts use **`MessDemo2026!`**. These are synthetic accounts, not institute accounts.

| Role | Email |
| --- | --- |
| Administrator | admin@demo.iiit-bh.ac.in |
| Mess manager | manager@demo.iiit-bh.ac.in |
| Serving/kitchen staff | staff@demo.iiit-bh.ac.in |
| Student | student@demo.iiit-bh.ac.in |
| Second student | priya@demo.iiit-bh.ac.in |

The seed creates upcoming menus, bookings, stock, a low-stock alert, a notice, and an unpaid invoice from the previous month for each student. The dates are relative to the day the seed runs. Seeding requires an empty database and never deletes existing data. It is disabled in production; production startup also rejects databases containing demo accounts.

To use a fresh database alongside the demo database, change `DATABASE_PATH`. Do not delete a database containing records you need.

## What the backend handles

| Area | Implemented behavior |
| --- | --- |
| Accounts | Admin-provisioned accounts, temporary passwords, forced password changes, suspension, role changes, session revocation, dietary preferences and allergies |
| Menus | Date-specific breakfast/lunch/snacks/dinner services, draft publication, locked published menus, prices, allergens, capacity, service windows and cutoffs |
| Bookings | Capacity checks inside write transactions, idempotent booking, atomic multi-meal booking, cancellations, rebooking and leave checks |
| Extras | Per-meal quantities, stock reservation, price snapshots, cancellations and fulfilment at attendance |
| Attendance | Random meal passes, 120-second expiry, pass rotation, single-use redemption by staff and service-window checks |
| Leave | Pending/approved/rejected/withdrawn states, overlap detection, configurable minimum duration, atomic booking and extra cancellation |
| Billing | Live monthly previews, immutable closed-month invoices, itemised lines, bulk issuance, partial settlement, due dates, overdue balances and CSV export |
| Fake payments | Student-owned success/failure simulation, persistent attempts, idempotent replay, overpayment prevention and clearly marked fake ledger entries |
| Inventory | Suppliers, grams/millilitres/pieces, receipts, consumption, waste, corrections, low-stock thresholds and append-only stock history |
| Food waste | Prepared and leftover portions, measured waste, attendance consistency checks and one record per completed service |
| Support | Private complaint conversations, assignments, resolution/reopening, attendance-backed feedback and expiring announcements |
| Management | Role-aware dashboards, dietary headcounts, extras demand, no-shows, ratings, procurement costs and append-only audit history |

### Proposed project policies

These are project assumptions, **not verified IIIT Bhubaneswar policies**. Confirm them with the mess administration before using the system operationally.

1. This version bills **booked meals**, rather than a flat subscription. Students explicitly reserve meals, individually or in a batch. Confirmed no-shows remain billable because the kitchen has already planned for them.
2. Prices are stored in integer INR paise and locked at booking/order time. Published meal pricing, times and menus cannot be edited silently.
3. Booking and cancellation close at the meal's cutoff. The default seed uses a cutoff three hours before service; managers choose each real service's cutoff.
4. Students can book up to 14 days ahead by default. Administrators can change this to 1–60 days.
5. Leave starts after today, covers at least two days by default, and requires approval. Pending leave blocks new bookings. Approval cancels eligible bookings and extras; it does not invent a credit for meals that were never booked. Approval fails atomically if any affected cancellation cutoff has passed.
6. Future leave can be withdrawn. Previously cancelled meals are rebooked explicitly, subject to the usual capacity and cutoff rules.
7. Invoices can be finalised only after the month ends. Cancellations and approved leave have already removed their charges. Issued invoices and recorded payments cannot be edited or deleted through the API.
8. Attendance is allowed only during the published service window. Passes can be generated from 15 minutes before service; each new pass invalidates the previous one.
9. All calendar dates use Asia/Kolkata independently of the machine timezone. API timestamps are normalised to UTC.

## Fake payment workflow

`PAYMENTS_MODE=FAKE` is the default in development and production for this project. It makes no external payment requests.

1. Sign in as a seeded student.
2. Get their previous-month invoice with `GET /api/v1/invoices`.
3. Call `POST /api/v1/invoices/{id}/fake-payment` with `amountPaise`, `outcome` (`SUCCESS` or `FAILURE`), and a unique `idempotencyKey` of 16–100 letters, digits, hyphens or underscores.
4. `SUCCESS` records a payment with method `FAKE`. `FAILURE` records an attempt and leaves the balance unchanged. Both return `simulated: true` and `moneyMoved: false`.
5. Retry the exact same request with the same key to safely retrieve the same attempt. Use a new key for a new attempt. Reusing a key with different values is rejected.

For a full ₹60 seeded invoice, `amountPaise` is `6000`. Failed attempts can be followed by a successful attempt with a new key.

The optional `MANUAL` mode enables management to record independently verified cash/bank/UPI receipts and disables student fake payments. It is not a gateway integration. Keep the default `FAKE` for the current project phase.

## API development

The [API guide](docs/API.md) includes authentication, endpoint groups, response shapes, and common workflows. The live `/api/docs` explorer runs from local assets and has no CDN dependency.

Successful responses use `{ "data": ... }`. Errors use `{ "error": { "code", "message", "requestId", "details"? } }`. Lists generally use `{ "items", "total", "page", "limit" }` inside `data`. Menus and bounded operation reports return arrays or grouped records.

Session tokens are held in HttpOnly cookies, not browser storage. After login or `GET /auth/me`, send the returned `csrfToken` in `X-CSRF-Token` for authenticated mutations. User creation and password reset return accounts requiring an initial password change.

## Production

```sh
npm ci
npm run build
```

Set these in the deployment environment or an untracked `.env`:

```dotenv
NODE_ENV=production
APP_ORIGIN=https://mess.example.edu
PORT=4000
DATABASE_PATH=./data/production.sqlite
PAYMENTS_MODE=FAKE
TRUST_PROXY=1
```

Use the actual public HTTPS origin. Set `TRUST_PROXY=1` only when there is exactly one trusted reverse proxy. The application requires HTTPS for its production origin and uses secure session cookies.

Bootstrap the first administrator against a fresh production database. Set `ADMIN_EMAIL`, `ADMIN_NAME` and `ADMIN_PASSWORD` as environment variables; the password must have 12–128 characters, uppercase and lowercase letters, and a number. Keep these values out of source control and command history. Then run:

```sh
npm run admin:create
npm start
```

**In production, one Express process serves both `/api/*` and the compiled React assets.** SPA navigation falls back to React; unknown API routes and missing assets stay 404. Hashed client assets receive long-lived immutable caching; API responses use `no-store`.

Use a TLS reverse proxy and a persistent local volume for the database. This deployment is intended for a single application instance. Do not share a SQLite file across machines or use an ephemeral serverless filesystem. [Architecture and operations](docs/ARCHITECTURE.md) covers this tradeoff and migration boundaries.

### Container option

```sh
docker build -t iiit-mess .
docker run --name iiit-mess -p 4000:4000 -e APP_ORIGIN=https://mess.example.edu -e TRUST_PROXY=1 -v mess-data:/app/data -v mess-backups:/app/backups iiit-mess
```

The container runs as a non-root user. For first-admin bootstrap inside the container, inject `ADMIN_EMAIL`, `ADMIN_NAME` and `ADMIN_PASSWORD` through your deployment's secret mechanism, then execute `node dist/server/cli.js admin`. The final image does not need TypeScript or Vite.

## Verification and maintenance

```sh
npm run check
npm run db:migrate
npm run db:backup
```

`check` runs strict TypeScript checking, the integration suite and the production build. Tests use isolated databases and an injected clock; they do not depend on the seeded database or the current date. CI runs the same checks on pushes and pull requests.

The backup command uses SQLite's online backup API rather than copying a live WAL database. Backups are written to `backups/`. For a restore, stop the application, choose a new database path, place the backup there, and point `DATABASE_PATH` at it. Do not overwrite a database while the application is running. The integration suite verifies backup integrity and restored records.

## Project layout

```text
client/                 React verification workspace and Vite proxy
server/src/app.ts       HTTP application and middleware
server/src/api.ts       Route registration and generated OpenAPI
server/src/auth.ts      Passwords, sessions and CSRF integration
server/src/migrations.ts Versioned database schema
server/src/routes/      Validated feature APIs and permissions
server/src/services/    Booking and billing rules
server/src/seed.ts      Explicit development-only sample data
server/src/cli.ts       Migration, bootstrap, seed and backup commands
server/test/            HTTP integration and persistence tests
docs/                   API contracts, policies and architecture
```

The full UI, QR rendering/scanning interface, real payment integration, institute SSO and outbound email are not included in this backend phase. No source-code comments are used.
