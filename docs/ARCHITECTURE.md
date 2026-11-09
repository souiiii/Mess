# Architecture and operations

## Application boundary

React communicates only with `/api/v1`. In development, Vite proxies `/api` to Express. In production, Express serves the compiled React build itself. Frontend routes never bypass backend role or ownership checks.

The API is implemented in TypeScript with Express 5. Zod validates inputs and supplies the request schemas for generated OpenAPI 3.1 documentation. Swagger UI is served from installed local assets. Domain services handle booking and billing, while route modules handle feature permissions, validation and orchestration.

SQLite is accessed through Node's built-in `node:sqlite` driver. It uses strict tables, foreign keys, uniqueness and check constraints, WAL mode, full synchronous durability and a five-second busy timeout. No native npm database binding or separate database server is required. Node 22 currently reports its SQLite module as experimental; run a supported, patched Node release.

## Data relationships

| Entity | Relationship and responsibility |
| --- | --- |
| User | Student/staff/manager/admin; owns sessions, bookings, leave and complaints |
| Meal service | One dated meal type, immutable after publication; has a menu, capacity, price and service window |
| Booking | Unique `(user, meal)`; retains its identity across cancellation/rebooking and stores its price snapshot |
| Meal pass | Hashed token tied to a booking, with expiry and redemption time |
| Extra / extra order | An offer belongs to one meal; each order belongs to its booking, with quantity and price snapshot |
| Leave request | Date interval with review state; approved leave cancels eligible bookings in one transaction |
| Invoice / line | Unique `(user, month)`; immutable line snapshots reference their original bookings/orders |
| Payment | Append-only collection with a globally unique reference and idempotency key |
| Payment attempt | Append-only fake success/failure record; successful attempts link to a `FAKE` payment |
| Supplier / inventory item | Contact details and current item quantities in an integer base unit |
| Stock movement | Append-only signed quantity, cost for receipts, reason, actor and idempotency key |
| Service waste | Prepared/leftover portions and waste weight for one completed service |
| Feedback | One review per attended booking |
| Complaint / reply | Private issue thread, assignment and resolution state |
| Announcement | Expiring notice |
| Audit log | Append-only actor, action, entity, structured details and timestamp |

Migrations are numbered and applied under `BEGIN IMMEDIATE`. Future schema changes must append a new migration rather than editing an applied migration. Migrations are run before the HTTP server accepts traffic.

## Transaction boundaries

Mutations that depend on state use `BEGIN IMMEDIATE`. Their checks, writes and audit record commit together. A thrown validation or business-rule error rolls everything back. Transaction callbacks are synchronous and contain no network work or asynchronous password hashing.

This protects the following operations:

- Counting and allocating meal or extra capacity.
- Cancelling a booking and all of its extras.
- Approving leave and cancelling every affected reservation.
- Redeeming a pass and recording attendance/extra fulfilment once.
- Creating an invoice and its immutable line items.
- Checking an outstanding balance and adding a payment.
- Recording a fake attempt and, for success, its corresponding payment.
- Inserting a stock movement and adjusting the cached stock balance.

Database triggers reject updates and deletions to invoice headers, invoice lines, payments, fake attempts, audit logs and stock movements. Corrections to stock are new reasoned movements. Financial reversals/credit notes have not been introduced; a future real-money release must add an explicit audited reversal model rather than editing existing records.

## Permissions

| Capability | Student | Staff | Manager | Admin |
| --- | --- | --- | --- | --- |
| Profile, menu, notices | Own/read | Own/read | Own/read | Own/read |
| Book/cancel, extras, meal pass | Own | — | — | — |
| Attendance redemption | — | Yes | Yes | Yes |
| Leave request/withdrawal | Own | — | — | — |
| Leave decisions | — | — | Yes | Yes |
| Billing, invoice, payment history | Own | — | All | All |
| Fake payment | Own | — | — | — |
| Manual payment entry | — | — | MANUAL mode | MANUAL mode |
| Publish menus/extras/notices | — | — | Yes | Yes |
| Complaint threads | Own | Non-billing | All | All |
| Feedback | Own attended meals | Own history | All | All |
| Stock levels and consumption/waste | — | Yes | Yes | Yes |
| Procurement and stock corrections | — | — | Yes | Yes |
| Reports | Own dashboard | Operations | Operations/finance | Operations/finance |
| User directory | — | — | Read | Read |
| Account provisioning, access, resets | — | — | — | Yes |
| Policy changes and audit history | — | — | — | Yes |

Inactive accounts are rejected by session lookup. Role changes, password changes and resets revoke existing sessions. Accounts with a temporary password can access only identity, password change and logout until they set a new password. There is no public registration or client-supplied role assignment.

## Security controls

Passwords use salted asynchronous scrypt. Random 256-bit session tokens and meal-pass tokens are stored as SHA-256 hashes. Session cookies are HttpOnly, SameSite Strict, and Secure in production. Sessions expire after 12 hours; pass tokens expire after at most 120 seconds. Passes and expired sessions are periodically removed.

Authenticated mutations require the session's CSRF token. Requests with a foreign Origin or cross-site fetch metadata are rejected. There is no permissive CORS setup. API clients without an Origin still need their session cookie and CSRF token. Frontend credentials and CSRF state are not stored in localStorage.

Helmet sets security headers and a restrictive content security policy. The React application renders text normally and does not inject complaint/announcement HTML. Query values use SQL bind parameters. Body size is limited to 64 KB. Sensitive data is excluded from password/secret responses and request logs. Structured request logs use generated correlation IDs; audit records avoid password and token fields. Database constraint details and internal error stacks are not returned to clients.

The default rate limits are 300 API requests/minute/IP, 20 failed logins/15 minutes/IP and 10 password-change requests/15 minutes/IP. The limiter uses process memory, so restarting the server resets its counters. This matches the single-instance deployment; a multi-instance deployment requires a shared limiter and tuned limits for campus NAT traffic. SSO, MFA and a durable account-based brute-force control are future extensions.

## Dates, amounts and reporting

Calendar dates and billing month boundaries are evaluated in Asia/Kolkata. Timestamps are UTC ISO strings. Money is integer INR paise; stock is integer grams, millilitres or pieces. No floating-point currency or implicit server-timezone arithmetic is used.

Financial reports distinguish collections against a billing month's invoices from cash received during a calendar month. They also identify simulated and verified collections separately. Procurement totals use receipt costs only; they are not a profit-and-loss report or inventory valuation. Food wastage is tracked separately from raw-stock wastage to avoid subtracting the same ingredients twice.

CSV export escapes quotes/newlines and neutralises spreadsheet formula prefixes. Billing exports are restricted to management and limited to 10,000 invoices per month in this version.

## Deployment limits

The intended deployment is one Node process for one campus mess, with SQLite on a persistent local disk. Synchronous SQLite queries are bounded and short; password hashing runs asynchronously. This is a practical academic-project deployment, not a demonstrated multi-campus load target. No load test has been performed.

For horizontal scaling, move persistence behind repository interfaces to PostgreSQL, use database transactions/locking for capacity and payment checks, move rate limiting to a shared store, and add a job queue for bulk invoicing and notifications. SQLite WAL files must not be shared over a network filesystem.

Production requires a built React application, an HTTPS public origin, a fresh database without demo accounts, a correctly configured proxy and a persistent volume. The app handles termination by stopping new requests, allowing in-flight requests to finish and closing the database. The container adds an HTTP health check and runs without root privileges.

## Verification

The integration tests exercise real Express middleware, cookies, SQLite constraints and transactions. Time is injected, allowing exact-cutoff, expiry, month-close and overdue tests without waiting. They include competing HTTP requests for the last meal seat and for a remaining invoice balance. The persistence suite reopens a file database and verifies a restored online backup with `PRAGMA integrity_check`.

The React integration suite (`client/test/workflows.test.tsx`) exercises end-to-end student, staff, manager and administrator workflows—including booking, cancellation, simulated payments, leave requests, menu publication, stock movements, pass check-in, complaints, account provisioning and policy updates—against isolated in-memory Express and SQLite instances.

Primary references: [Node SQLite API](https://nodejs.org/api/sqlite.html), [Express production security](https://expressjs.com/en/advanced/best-practice-security.html), [Zod to OpenAPI](https://github.com/asteasolutions/zod-to-openapi).
