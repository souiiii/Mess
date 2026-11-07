# API guide

Base URL: `/api/v1`. The development browser uses `http://localhost:5173/api/v1`; direct API clients can use `http://localhost:4000/api/v1`.

The generated OpenAPI spec at `/api/openapi.json` documents request and response fields, validation, HTTP methods and required roles. `/api/docs` provides the local interactive explorer. Concrete response contracts and workflows are also described below.

## Authentication

`POST /auth/login` accepts `email` and `password`. It sets the `mess_session` cookie and returns:

```json
{
  "data": {
    "user": {
      "id": "user-uuid",
      "name": "Aarav Mishra",
      "email": "student@demo.iiit-bh.ac.in",
      "role": "STUDENT",
      "must_change_password": false
    },
    "csrfToken": "session-csrf-token",
    "expiresAt": "2026-11-08T00:00:00.000Z"
  }
}
```

`user` also contains enrolment, room, dietary preference, allergies, active state and creation time. Password hashes never appear in API responses.

Send the cookie on all protected requests. For `POST`, `PATCH` and `DELETE`, also send `X-CSRF-Token`. `GET /auth/me` returns the current user and CSRF token after a page reload. `POST /auth/logout` revokes the current session. `POST /auth/password` accepts `currentPassword` and `newPassword`, revokes every session, and requires a new login.

In Swagger UI, execute login first, copy the returned CSRF token, then enter it in **Authorize → csrfHeader**. Browser cookies are attached automatically to same-origin requests. Do not enter a cookie token manually. Accounts requiring a password change must complete `/auth/password` before other actions.

## Conventions

- Request JSON uses camelCase. Entity response fields use snake_case; aggregate/workflow response fields use the names shown here.
- All monetary fields named `Paise` or `_paise` are integer paise, not rupees.
- All path IDs are UUIDs. Tokens are never accepted in query strings.
- Dates are `YYYY-MM-DD`; months are `YYYY-MM`; timestamps include an offset and are returned in UTC.
- All registered mutation bodies reject unknown properties.
- Most list routes accept `page` (default 1) and `limit` (default 25, maximum 100), returning `{ data: { items, total, page, limit } }`.
- Menu/report date ranges default to today through seven days ahead, allow at most 93 inclusive days, and reject reversed ranges.
- `201` means a creation-style request succeeded. Idempotent replays retain the route's `201` status.

## Endpoint map

| Group | Endpoints |
| --- | --- |
| Identity | `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, `POST /auth/password` |
| Users | `GET /users`, `POST /users`, `PATCH /users/me`, `PATCH /users/{id}/access`, `POST /users/{id}/reset-password` |
| Policy/audit | `GET /settings`, `PATCH /settings`, `GET /audit` |
| Meals | `GET /meals`, `POST /meals`, `PATCH /meals/{id}`, `POST /meals/{id}/publish`, `POST /meals/{id}/cancel` |
| Booking | `GET /bookings`, `GET /bookings/{id}`, `POST /bookings`, `POST /bookings/bulk`, `POST /bookings/{id}/cancel` |
| Extras | `POST /meals/{id}/extras`, `POST /bookings/{id}/extras`, `POST /extra-orders/{id}/cancel` |
| Attendance | `POST /bookings/{id}/pass`, `POST /attendance/scan` |
| Leave | `GET /leaves`, `POST /leaves`, `POST /leaves/{id}/review`, `POST /leaves/{id}/withdraw` |
| Billing | `GET /billing/preview`, `GET /invoices`, `GET /invoices/{id}`, `POST /invoices`, `POST /invoices/bulk` |
| Payments | `POST /invoices/{id}/fake-payment`, `GET /invoices/{id}/payment-attempts`, `POST /invoices/{id}/payments` |
| Feedback | `GET /feedback`, `POST /feedback` |
| Complaints | `GET /complaints`, `POST /complaints`, `GET /complaints/{id}`, `POST /complaints/{id}/replies`, `PATCH /complaints/{id}/status`, `POST /complaints/{id}/reopen` |
| Notices | `GET /announcements`, `POST /announcements`, `DELETE /announcements/{id}` |
| Suppliers | `GET /suppliers`, `POST /suppliers` |
| Stock | `GET /inventory`, `POST /inventory`, `PATCH /inventory/{id}`, `GET /inventory/{id}/movements`, `POST /inventory/{id}/movements` |
| Waste | `POST /meals/{id}/waste` |
| Overview/reports | `GET /dashboard`, `GET /reports/operations`, `GET /reports/billing`, `GET /reports/billing/export` |

## Meal-to-bill workflow

1. Management creates a draft meal using `serviceDate`, `mealType`, `title`, `menu` (array), `allergens` (array), `dietaryType`, `pricePaise`, `capacity`, `startsAt`, `endsAt` and `cutoffAt`.
2. Start and end must fall on `serviceDate` in Asia/Kolkata. The cutoff must be in the future and before the start. Publish with `/meals/{id}/publish`.
3. `GET /meals?from=...&to=...` returns a `data` array with parsed menu/allergen arrays, `booked_count`, `attended_count`, `available`, `my_booking_id`, `my_booking_status` and `extras` for each service. Cancelled services remain visible with status `CANCELLED`; drafts are hidden from students.
4. A student posts `{ "mealId": "uuid" }` to `/bookings`, or `{ "mealIds": ["uuid"] }` to `/bookings/bulk`. A booking stores `id`, `user_id`, `meal_id`, `status`, `price_paise`, `created_at`, and nullable cancellation/attendance fields. Repeating an existing confirmed reservation returns the same booking.
5. Optional extras are created by management for that meal. Students post `extraId` and `quantity` to `/bookings/{id}/extras`. The returned order stores `quantity`, `unit_price_paise`, `booking_id`, `extra_id` and `status`.
6. During the pass window, the student posts to `/bookings/{id}/pass`, receiving `{ token, expiresAt, bookingId }`. The UI can later render this token as a QR payload.
7. Staff posts `{ "token": "opaque-token" }` to `/attendance/scan`. The response includes `bookingId`, student name/roll/hostel, meal type/date, fulfilled extra names/quantities, and `attendedAt`. A second scan is rejected.
8. Students can rate attended meals with `/feedback` using `bookingId`, `taste`, `hygiene`, `portion` (each 1–5) and `comment`. One review is allowed per booking within the configured window.
9. `GET /billing/preview?month=YYYY-MM` returns `{ userId, month, lines, totalPaise, provisional }`. Lines contain `sourceId`, `sourceType`, `description`, `quantity` and `unitPricePaise`.
10. After month close, management posts `{ userId, month, dueOn }` to `/invoices`. Bulk issuance accepts `userIds` instead, up to 100. Responses are invoice records with `lines`, `payments`, `payments_mode`, `paid_paise`, `outstanding_paise` and calculated `status` (`UNPAID`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`). Invoice lines use `source_type`, `source_id`, `description`, `quantity`, and `unit_price_paise`.

### Fake payment example

After login, send this to `/invoices/{id}/fake-payment` with the session cookie and CSRF header:

```json
{
  "amountPaise": 6000,
  "outcome": "SUCCESS",
  "idempotencyKey": "demo-payment-attempt-0001"
}
```

The response is `{ data: { simulated: true, moneyMoved: false, attempt, invoice } }`. The attempt has `id`, `invoice_id`, `initiated_by`, `amount_paise`, `outcome`, `idempotency_key`, nullable `payment_id`, and `created_at`. Successful payment entries use method `FAKE` and a generated `FAKE-...` reference. Use `FAILURE` to simulate a failed transaction. A failed attempt never reduces the balance.

`GET /invoices/{id}/payment-attempts` returns the paginated success/failure history. It is accessible only to that invoice's owner and management.

In `MANUAL` mode only, management's `/invoices/{id}/payments` accepts `amountPaise`, `method` (`CASH`, `UPI`, `BANK_TRANSFER`), unique `reference`, and `idempotencyKey`, returning `{ payment, invoice }`. Neither payment mode contacts a gateway.

## Leave workflow

`POST /leaves` accepts `startsOn`, `endsOn`, `reason`. The response contains its date range, `user_id`, `status`, review fields and creation time. Dates are inclusive.

Management reviews with `{ decision: "APPROVED" | "REJECTED", note }`. The response additionally reports `cancelledBookings` and `avoidedChargesPaise`. An approved request cancels all eligible bookings/extras together. A single locked booking prevents any cancellations. A request is not automatically approved.

`POST /leaves/{id}/withdraw` allows the owner to withdraw a pending or approved future request. It does not automatically restore reservations. Managers can filter `GET /leaves` by `userId` and `status`.

## Inventory workflow

1. Management creates a supplier with `name`, `contact` and a stock item with `name`, `unit`, `lowStockThreshold`. Units are `GRAM`, `MILLILITRE` or `PIECE`; item creation starts at zero stock.
2. A receipt posts `kind: "RECEIVE"`, positive `quantity`, `supplierId`, `reference`, `totalCostPaise`, `reason`, and `idempotencyKey` to `/inventory/{id}/movements`. The cost is the total line cost, not a per-unit rate.
3. Consumption/waste use `CONSUME`/`WASTE` and a negative quantity. Management corrections use `ADJUST` with a signed nonzero quantity and reason. Cost/supplier/reference are accepted only on receipts.
4. The response is `{ movement, item }`. Movement keys are idempotent. A supplier's receipt reference cannot receive the same item twice. The new stock balance cannot be negative.
5. `/inventory?lowStock=true` returns items at or below threshold. `/inventory/{id}/movements` returns the append-only ledger. Serving staff do not receive receipt costs, supplier details or references in ledger responses.
6. After a service ends, `/meals/{id}/waste` accepts `preparedPortions`, `leftoverPortions`, `wasteGrams`, `note`. Leftovers must be consistent with prepared portions and attendance. This is a separate finished-food record and does not subtract ingredients a second time.

## Complaints, feedback and notices

Complaints accept `category` (`FOOD`, `HYGIENE`, `SERVICE`, `BILLING`, `OTHER`), `subject`, `description`. Only the owner and appropriate staff can read a thread. Billing complaints require management. Details return a `replies` array with author names/roles.

Staff reply with `message` and update status/assignment with `status`, nullable `assignedTo`, and a required `note`. State changes add a visible reply. Resolved threads must be reopened before further replies. The owner can reopen with `reason`.

Notice creation accepts `title`, `body`, `priority` (`NORMAL` or `IMPORTANT`), and `expiresAt`. Notice lists return current notices only. All messages are plain text.

## Reporting

`GET /dashboard` returns a role-aware object. Student data includes `provisionalBillPaise`, `outstandingPaise`, `upcomingBookings`, `pendingLeaves`, `openComplaints` and `paymentsMode`. Staff receive today's services, stock alerts and operational complaint counts. Management additionally receives active resident counts, leave queue size and overdue balances.

`GET /reports/operations?from=...&to=...` returns `{ from, to, services }`. Each service includes bookings, attendance, cancellations, extras, residents on approved leave, waste figures, ratings, `feedback_count`, `attendance_percent`, `dietaryCounts` and named extra quantities. `no_shows` is `null` before service ends, then becomes booked minus attended.

`GET /reports/billing?month=YYYY-MM` returns `paymentsMode`, `invoiceCount`, `billedPaise`, `collectedForInvoicesPaise`, `simulatedCollectionsPaise`, `verifiedCollectionsPaise`, `cashReceivedDuringMonthPaise`, `simulatedReceivedDuringMonthPaise`, `procurementCostPaise`, and `outstandingPaise`. The cash-period total excludes fake payments; simulations have a separate period total. `/reports/billing/export` returns CSV rather than the JSON envelope, with explicit payment-mode and simulated-paid columns.

## Errors

| HTTP | Meaning | Typical codes |
| --- | --- | --- |
| 400 | Invalid business request | `INVALID_MEAL_TIMES`, `INVALID_LEAVE_DURATION`, `MONTH_NOT_CLOSED` |
| 401 | Missing/expired credentials | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` |
| 403 | Role, ownership, password-change or CSRF restriction | `FORBIDDEN`, `INVALID_CSRF`, `PASSWORD_CHANGE_REQUIRED`, `INVALID_ORIGIN` |
| 404 | Unknown record/route | `NOT_FOUND`, `ENDPOINT_NOT_FOUND` |
| 409 | State conflict | `MEAL_FULL`, `CUTOFF_PASSED`, `ON_LEAVE`, `INVALID_PASS`, `OVERPAYMENT`, `IDEMPOTENCY_CONFLICT`, `DUPLICATE_RECORD` |
| 413 | Body too large | `PAYLOAD_TOO_LARGE` |
| 422 | Invalid input shape/field | `VALIDATION_FAILED` with field paths |
| 429 | Rate limit | `RATE_LIMITED` |
| 503 | Database contention | `DATABASE_BUSY`, with `Retry-After: 1` |

Use the response's `requestId` to correlate a failure with server logs. Do not display raw internal database or stack messages to students.
