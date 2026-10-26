# HermesPay

Chat-first invoicing agent for freelancers and small businesses. Type
`bill tunde@example.com 50k naira for logo design due Friday` and HermesPay drafts a PayPal invoice,
shows a confirmation card, and on approval creates and emails it via the PayPal Invoicing v2 API.

## Features
- Create + send invoices, list/search status, send reminders, cancel, cashflow summary (paid / outstanding / overdue)
- Confirmation step before anything that sends an invoice, reminder or cancellation
- Naira amounts converted to USD (`NGN_PER_USD`), since PayPal invoices do not support NGN
- Any OpenAI-compatible LLM: native tool-calling (`AGENT_MODE=tools`) or a JSON-action fallback (`AGENT_MODE=json`) for agents like Hermes that do not honor client-side tools

## Setup
1. Node 22+. `npm install`
2. PayPal: create a sandbox REST app at https://developer.paypal.com/dashboard/applications/sandbox and **enable the Invoicing feature** (and Payouts if needed). Without it Invoicing calls return 403.
3. `cp .env.example .env` and fill in PayPal credentials and the LLM settings.
4. Hermes (optional default): `ssh -i ~/.ssh/hermes_vps -N -L 8642:127.0.0.1:8642 root@<vps>`, put the API key in `LLM_API_KEY`.
   Or use e.g. `LLM_BASE_URL=https://api.deepseek.com/v1 LLM_MODEL=deepseek-chat AGENT_MODE=tools`.
5. `npm run dev` and open http://localhost:3000

## API
- `POST /api/chat {message, session?}` returns a reply or a `confirm` step
- `POST /api/confirm {session, approve}` executes or declines the pending action
- `GET /api/invoices`, `GET /api/cashflow`

## PayPal endpoints used
`POST /v1/oauth2/token`, `POST /v2/invoicing/invoices`, `POST /v2/invoicing/invoices/{id}/send`,
`GET /v2/invoicing/invoices[/{id}]`, `POST /v2/invoicing/search-invoices`, `POST /v2/invoicing/invoices/{id}/remind`,
`POST /v2/invoicing/invoices/{id}/cancel`

## License
MIT
