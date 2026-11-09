# The Mess frontend

The React application follows `DESIGN.md`: an editorial masthead, a white canvas, black typography, square controls, hairline dividers, restrained copy and a photographic lead. Playfair Display, Lora and Manrope are self-hosted substitutes for the brief's proprietary display, reading and interface typefaces.

## Screens

| Access | Screens and actions |
| --- | --- |
| Student | Daily overview, seven-day menus, single and daily booking, extras, cancellation, expiring QR passes, meal ratings, leave, itemised statements, partial fake payments, payment attempts, private conversations and profile |
| Staff | Operations overview, camera and manual-code check-in, service roster, ingredient consumption/waste, stock ledger, completed-service waste and complaint resolution |
| Manager | Menu drafts/publication/cancellation, extras, resident directory, leave review, invoice issuance, financial reports, CSV export, suppliers, stock receipts/corrections, notices and complaint assignments |
| Administrator | Manager workflows plus account provisioning, suspension, roles, temporary-password resets, policy settings and audit journal |

All screen data comes from the existing API. Only the seeded demo accounts and the explicitly simulated payments are artificial. The food photograph is illustrative, not a photograph of a specific published menu.

## Interaction and resilience

- TanStack Query caches requests, refreshes after mutations and rechecks on focus. Routes are split into separate bundles; the camera library loads only for the serving desk.
- Cookie sessions and in-memory CSRF tokens use the same-origin API. Protected routes follow the signed-in role, while the backend enforces every permission.
- Forms retain input after failure, show server validation, prevent repeated submission and keep an in-flight form's dialog open.
- Payment and stock retries retain their idempotency key after uncertain failures. A completed attempt releases its key for a genuinely new action.
- Native dialogs provide focus containment and Escape handling. Forms have accessible labels; navigation, errors, loading and notifications have appropriate semantics. Motion respects reduced-motion preferences.
- Meal cutoffs and pass eligibility update while a screen remains open. QR passes count down and check for redemption. The serving desk supports a manually entered pass code when a camera is unavailable.
- Dates and service times use Asia/Kolkata. Money remains integer paise at the API boundary.

## Run and verify

`npm run dev` starts the existing API and Vite together. `npm run build` produces the server and React assets. In production, Express serves both the API and the built frontend.

`npm run test:ui` runs React interaction tests in a DOM environment against isolated instances of the real Express/SQLite backend, including authentication, CSRF, permissions, bookings, payments, stock, leave, support and administration. No persistent development data is changed by these tests. `npm run check` includes these tests, the backend tests, type checking and the production build.

Camera access requires localhost or HTTPS and a browser camera permission. Physical-camera scanning and rendered desktop/mobile layout require a real-browser review. The automation browser host was unavailable during this implementation; DOM integration tests do not establish visual correctness or camera-device compatibility.
