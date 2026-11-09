# IIIT Bhubaneswar Mess Management System

A full-stack campus mess management web application built with React, TypeScript, Express 5 and SQLite (`node:sqlite`). In production, a single Node.js/Express process serves both the compiled React frontend and the `/api/v1` REST API.

Payments default to **FAKE** (`PAYMENTS_MODE=FAKE`), allowing students and evaluators to simulate successful and declined invoice payments safely without an external gateway or real money. Simulated collections are tracked and reported separately from verified payments.

## Run locally

Requires Node.js 22.16 or newer.

```sh
npm ci
cp .env.example .env
npm run db:seed
npm run dev
```

`npm run db:seed` populates an empty development database (`data/mess.sqlite`) with synthetic accounts, 7-day menus, reservations, feedback, a pending leave request, an active complaint thread, pantry inventory, a low-stock alert and previous-month unpaid invoices. Unless `DEMO_PASSWORD` is provided in the environment, `db:seed` generates a strong random password and prints it once to the terminal.

`npm run dev` starts both the Express API and Vite in a single command:

| Service | URL |
| --- | --- |
| Web application | http://localhost:5173 |
| Interactive API explorer | http://localhost:5173/api/docs |
| OpenAPI 3.1 specification | http://localhost:5173/api/openapi.json |
| API health | http://localhost:4000/api/health |

## Core capabilities by role

| Role | Workflows |
| --- | --- |
| **Student** | Personalized dashboard, daily/weekly menu browsing with dietary filters, single & full-day meal booking, extras ordering, booking cancellation before cutoff, expiring QR & pass-code generation, meal ratings, leave requests & withdrawals, itemized monthly statements, simulated payment checkout (`SUCCESS`/`FAILURE`), private complaint threads & campus notices |
| **Staff** | Operations overview, serving desk with live camera QR scanning and manual pass-code check-in, service attendance roster, kitchen stock consumption/waste logging, completed-service food waste recording & non-billing complaint replies |
| **Manager** | Operational dashboard with attendance rate & low-stock alerts, draft menu creation/editing/publishing, service cancellation, extra item offers, resident directory, leave approval/rejection (with atomic booking cancellation), monthly invoice issuance, CSV billing export, operational & financial reports, supplier directory & stock receipts/adjustments |
| **Administrator** | All manager workflows plus user account provisioning (`STUDENT`, `STAFF`, `MANAGER`, `ADMIN`), role & suspension management, temporary password resets, mess policy configuration (booking horizon, minimum leave days, feedback window) and append-only audit journal |

## Production deployment (Ubuntu VPS with Docker)

The application is designed to run on an Ubuntu VPS inside Docker without disrupting other running containers or host services:

- The container binds only to loopback (`127.0.0.1:4000:4000` by default, configurable via `HOST_PORT`), leaving public ports `80`/`443` untouched for the host's existing reverse proxy.
- SQLite data and backups persist across container restarts and image upgrades in named Docker volumes (`iiit-mess-data` mounted at `/app/data` and `iiit-mess-backups` mounted at `/app/backups`).
- A built-in Docker health check probes `http://127.0.0.1:4000/api/health` and `restart: unless-stopped` ensures automatic recovery after host reboots.

### 1. Verify the VPS host environment

Before deploying on the Ubuntu VPS, inspect the host environment to confirm the Ubuntu release, Docker version, and occupied ports:

```sh
lsb_release -a || cat /etc/os-release
docker --version && docker compose version
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}"
ss -tulpn | grep -E ':(80|443|4000)\b' || true
```

If `127.0.0.1:4000` is already used by another local service on the VPS, set a different `HOST_PORT` (for example `HOST_PORT=4010`) in `.env` and update your reverse proxy upstream accordingly.

### 2. Configure environment and start the container

```sh
cp .env.production.example .env
# Edit .env and set APP_ORIGIN=https://<your-domain>
docker compose up -d --build
```

### 3. Initialize synthetic production-demo data (or bootstrap an admin)

Production startup blocks development `@demo.iiit-bh.ac.in` accounts (`server/src/app.ts`) and requires an explicit initialization step on an empty database.

To initialize a **complete production demonstration** with synthetic accounts (`admin@iiit-bh.ac.in`, `manager@iiit-bh.ac.in`, `staff@iiit-bh.ac.in`, `student@iiit-bh.ac.in`, `priya@iiit-bh.ac.in`), menus, bookings, stock, leave, complaints and unpaid invoices without hardcoded credentials:

```sh
docker compose exec iiit-mess node dist/server/cli.js demo-init
```

- `demo-init` refuses to run if the database already contains any users, protecting existing data.
- If `DEMO_PASSWORD` is not passed in the environment, `demo-init` generates a cryptographically random password meeting all complexity rules and prints it once to stdout for secure handoff.

Alternatively, to start with a blank production database and create only the first administrator:

```sh
docker compose exec \
  -e ADMIN_EMAIL=admin@iiit-bh.ac.in \
  -e ADMIN_NAME="Mess Administrator" \
  -e ADMIN_PASSWORD="<strong-password>" \
  iiit-mess node dist/server/cli.js admin
```

### 4. Reverse proxy (HTTPS)

Terminate TLS at your host reverse proxy and forward traffic to `127.0.0.1:4000` with `TRUST_PROXY=1`. Ready-to-use snippets are provided in:

- [`deploy/Caddyfile`](deploy/Caddyfile) (Caddy)
- [`deploy/nginx.conf`](deploy/nginx.conf) (Nginx)

## 10-minute demonstration script

1. **Student workflow (3.5 min)** — Sign in as `student@<domain>`. Review the personalized dashboard (this month's provisional bill, upcoming bookings, outstanding balance, and noticeboard). Open **The menu**, filter by dietary type, and click **Save my seat** on an upcoming service. Open **My bookings** to view the reservation, add an extra item, or generate a 120-second single-use QR/pass code. Visit **Statements**, open the previous month's invoice, and run a simulated **Declined payment** followed by a **Successful payment** (`DEMO CHECKOUT`). Submit a request under **Time away** and open a thread under **Noticeboard -> My conversations**.
2. **Staff workflow (1.5 min)** — Sign in as `staff@<domain>`. Open **Serving desk**, paste a student's active meal pass code (or scan via camera) to redeem attendance, and inspect the service roster.
3. **Manager workflow (3 min)** — Sign in as `manager@<domain>`. Review the **Overview** attendance gauge, service schedule, and pantry low-stock alerts. Create and **Publish** a new menu service in **The menu**. Approve the student's pending leave request in **Leave**. Reply to and update the student's complaint in **Community -> Conversations**. Record a stock delivery in **The kitchen -> The pantry** and inspect **Reports** (daily attendance chart, financial breakdown, and CSV export).
4. **Administrator workflow (2 min)** — Sign in as `admin@<domain>`. Open **People** to provision a new account with a temporary password or manage role/suspension status. Open **Mess settings** (top-right gear icon) to adjust booking/leave policies and inspect the append-only **Activity journal**.

## Verification and maintenance

```sh
npm run check
npm run db:migrate
npm run db:backup
```

`npm run check` runs TypeScript type checking (`tsc --noEmit`), 71 backend integration & persistence tests, 18 React UI workflow tests against real Express/SQLite instances, and the production build.
