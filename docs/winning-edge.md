# Winning edge

## The two differentiators built

### 1. Agent trace: you can see why the agent did each thing
A panel next to the chat logs every step as it happens:
- **MODEL**: the model chose a tool, with latency
- **CALL**: the exact arguments
- **FX**: the conversion maths with its rate source (`12,000 ÷ 129.87 = 92.40 (live rate)`)
- **GATE**: paused for your signature, then "You signed"
- **PAYPAL**: the Invoicing API call and its result, with latency

**Why this one:** agentic commerce only works if people trust an agent that moves money. Judges can watch the safety gate hold before anything touches PayPal, and they can check the FX maths themselves. It's real data from the `/api/chat` and `/api/confirm` responses, not a mock. Most entries will be a black-box chat.

### 2. Get paid where your clients already are: WhatsApp share
A sent invoice has two buttons:
- **Send on WhatsApp** opens wa.me with a prefilled message containing the amount in both currencies and the PayPal pay link.
- **Copy pay link** copies the link.

**Why this one:** in markets that bill in ₦, KSh, GH₵, R or ₹, clients pay after a chat message, not after an email. It's cheap, and it turns a PayPal invoice into something people actually click on. It also widens PayPal's reach into markets where the currency itself can't be invoiced.

**Skipped:** voice input. The Web Speech API is unreliable across browsers and risky in a live demo.

## Demo storyline (about 2 min 40 s)
1. **0:00–0:20, the problem.** "PayPal can't invoice in naira, shillings, cedis, rand or rupees. Freelancers there still want PayPal's reach." Point at the header chip: `$1 = ₦1,334.30 · live · open.er-api.com`.
2. **0:20–1:00, ask in plain words.** Type `Bill wanjiru@example.com KSh 12,000 for a site audit due next Monday`. A draft receipt appears with `KSh 12,000 → $92.40 USD · rate 129.87 · live`. In the trace, MODEL, CALL and FX each appear, and GATE shows "Paused for your signature".
3. **1:00–1:30, trust.** "Nothing has gone to PayPal yet." Click **Sign and send**. The SENT stamp lands, and the trace shows the PAYPAL call (around 1.4 s) with a real sandbox invoice ID.
4. **1:30–1:55, get paid.** Click **Send on WhatsApp** to show the prefilled message with the pay link. Open the pay link to show PayPal's sandbox pay page.
5. **1:55–2:25, the ledger.** Go to `/dashboard` to see Collected, Open and Past due in USD and naira, with overdue rows in red. Pay in sandbox, and the webhook or poll triggers the toast "… just paid" and updates the row live.
6. **2:25–2:40, close.** "It bills in your currency, gets paid through PayPal, and the agent never moves money without your signature."

## Mapping to the judging criteria
| Criterion | How Hermes answers it |
|---|---|
| Use of PayPal APIs | Invoicing v2 (create, send, list, search, remind, cancel), verified webhooks, the sandbox pay link |
| Agentic AI / innovation | Tool-calling agent; approval gate on every money-moving tool; visible trace |
| Real-world impact | Unblocks PayPal invoicing for currencies it doesn't support; WhatsApp delivery |
| Technical execution | Live FX with cache and fallback, SSE live updates, typed backend, Lighthouse 96–100 |
| UX / design | Receipt metaphor, AA contrast, keyboard access, every state designed (see design-audit.md) |
| Safety and trust | Human-in-the-loop gate, FX maths shown, webhook signature verification, no secrets in the client |
