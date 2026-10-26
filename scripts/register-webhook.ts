// Run ONCE when the app has a public HTTPS URL:  PUBLIC_URL=https://your-app.example npx tsx scripts/register-webhook.ts
// Then put the printed webhook id in PAYPAL_WEBHOOK_ID.
import "dotenv/config";
import { pp } from "../src/paypal.js";
import { WEBHOOK_EVENTS } from "../src/events.js";
const base = process.env.PUBLIC_URL;
if (!base?.startsWith("https://")) { console.error("Set PUBLIC_URL to a public https URL first."); process.exit(1); }
const r = await pp("POST", "/v1/notifications/webhooks", { url: `${base.replace(/\/$/, "")}/api/paypal/webhook`, event_types: WEBHOOK_EVENTS.map((name) => ({ name })) });
console.log("Webhook registered. PAYPAL_WEBHOOK_ID=" + r.id);
