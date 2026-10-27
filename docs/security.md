# Security model

## Access
- **Public sandbox demo (default, `PAYPAL_ENV=sandbox`).** You don't need to sign in. Anyone can chat, open the dashboard and approve actions. Without the owner key, mutating actions run only when **every** recipient is on `DEMO_ALLOWED_DOMAINS` (default `example.com`). Remind and cancel run only on invoices billed to those domains. Refused actions show a friendly card and are never sent to PayPal.
- **Owner.** Open the site with `?key=<APP_TOKEN>` (stored in localStorage and stripped from the URL) or use the header "Owner" link. Requests carry `Authorization: Bearer`, which is compared with `timingSafeEqual`. Owners have no demo restrictions.
- **Live (`PAYPAL_ENV=live`).** Every route except `/api/health`, `/api/fx` and the signed PayPal webhook needs the owner token. If `APP_TOKEN` is unset, the API returns 503 (fail closed).
- **SSE.** `/api/events` needs a short-lived HMAC token (`?t=`, 10 min) from `POST /api/events/token`. The number of clients is capped by `MAX_SSE_CLIENTS`.

## Abuse limits
- Rate limits per IP per minute: chat `RATE_CHAT_PER_MIN` (20), confirm 10, poll 6, auth 10. Owners skip them.
- Sessions are server-issued UUIDs bound to owner or public. They have a TTL (`SESSION_TTL_MIN`), an LRU cap (`MAX_SESSIONS`) and 40 history turns. Unknown or expired sessions get 409 `{expired:true}`.
- The JSON body limit is 64 kB. The webhook known-set holds at most 5000 entries.

## Hardening
- helmet with a strict CSP (`script-src 'self'`, no inline scripts). `x-powered-by` is off.
- Clients get generic errors; details are logged on the server.
- Invoice refs must match `^INV2-[A-Z0-9-]+$` or be an invoice number, and are `encodeURIComponent`-ed.
- Amounts must be > 0, at least USD 0.01 and at most `MAX_INVOICE_USD` (10000). The due date must be an ISO date that isn't in the past. Emails are validated.
- `listInvoices` is paginated (100 per page, up to 50 pages).
- `WEBHOOK_DEV_SKIP_VERIFY` takes effect only when `NODE_ENV=development`.
- Mutations always need an explicit confirm. This is covered by tests (`npm test`) and CI (`.github/workflows/ci.yml`).
