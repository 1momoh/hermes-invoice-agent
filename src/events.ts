import type { Request, Response } from "express";
import { listInvoices, pp } from "./paypal.js";

// ---- SSE hub ----------------------------------------------------------------
const clients = new Set<Response>();
export const MAX_SSE = Number(process.env.MAX_SSE_CLIENTS || 100);
export const sseCount = () => clients.size;
export function sse(req: Request, res: Response) {
  if (clients.size >= MAX_SSE) return res.status(503).json({ error: "Too many live connections. Try again shortly." });
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(": connected\n\n");
  clients.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  const maxAge = setTimeout(() => res.end(), 30 * 60_000); // client reconnects with a fresh token
  const done = () => { clearInterval(ping); clearTimeout(maxAge); clients.delete(res); };
  req.on("close", done); res.on("error", done);
}
export function broadcast(type: string, data: unknown) {
  for (const c of clients) c.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ---- status-change detection (shared by webhook + poller, de-duplicated) ----
const known = new Map<string, string>();
const MAX_KNOWN = 5000;
function remember(id: string, status: string) {
  known.delete(id); known.set(id, status); // re-insert = most recent
  while (known.size > MAX_KNOWN) known.delete(known.keys().next().value!);
}
const who = (x: any) => x.recipient_name || (x.recipient ? x.recipient.split("@")[0].replace(/^./, (c: string) => c.toUpperCase()) : "A client");

export function message(x: any, status: string): string {
  const amt = `$${Number(x.amount || 0).toFixed(2)}`;
  switch (status) {
    case "PAID": case "MARKED_AS_PAID": return `${who(x)} just paid ${amt} for invoice #${x.number}.`;
    case "PARTIALLY_PAID": return `${who(x)} made a partial payment on invoice #${x.number}.`;
    case "CANCELLED": return `Invoice #${x.number} to ${who(x)} was cancelled.`;
    case "REFUNDED": case "PARTIALLY_REFUNDED": case "MARKED_AS_REFUNDED": return `Invoice #${x.number} to ${who(x)} was refunded.`;
    default: return `Invoice #${x.number} to ${who(x)} is now ${status}.`;
  }
}

function onStatus(x: any, source: "webhook" | "poll") {
  const prev = known.get(x.id);
  remember(x.id, x.status);
  if (prev === x.status) return;
  if (prev === undefined && source === "poll") return; // first sighting: seed only
  broadcast("invoice", { id: x.id, status: x.status, previous: prev, source, text: message(x, x.status) });
}

// ---- polling fallback -------------------------------------------------------
export async function pollOnce() {
  const list = await listInvoices();
  for (const x of list) onStatus(x, "poll");
  broadcast("invoices", list);
  return list;
}
export function startPolling() {
  const mins = Number(process.env.POLL_MINUTES || "2");
  if (!(mins > 0)) return;
  const run = () => pollOnce().catch((e) => console.error("poll failed:", e.message));
  run();
  setInterval(run, mins * 60_000);
  console.log(`Polling PayPal invoices every ${mins} min`);
}

// ---- webhook listener -------------------------------------------------------
export const WEBHOOK_EVENTS = [
  "INVOICING.INVOICE.PAID", "INVOICING.INVOICE.CANCELLED", "INVOICING.INVOICE.REFUNDED",
  "INVOICING.INVOICE.UPDATED", "INVOICING.INVOICE.CREATED", "INVOICING.INVOICE.SCHEDULED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "PAYMENT.PAYOUTS-ITEM.FAILED",
];

async function verify(req: Request): Promise<boolean> {
  if (process.env.WEBHOOK_DEV_SKIP_VERIFY === "1" && process.env.NODE_ENV === "development") return true; // dev-only bypass
  const id = process.env.PAYPAL_WEBHOOK_ID;
  if (!id) return false;
  const h = (k: string) => req.header(k) || "";
  const r = await pp("POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: h("paypal-auth-algo"), cert_url: h("paypal-cert-url"), transmission_id: h("paypal-transmission-id"),
    transmission_sig: h("paypal-transmission-sig"), transmission_time: h("paypal-transmission-time"),
    webhook_id: id, webhook_event: JSON.parse((req as any).rawBody || "{}"),
  });
  return r.verification_status === "SUCCESS";
}

export async function webhook(req: Request, res: Response) {
  let ok = false;
  try { ok = await verify(req); } catch (e: any) { console.error("verify error:", e?.message); }
  const ev0: any = req.body;
  console.log("webhook", ev0?.event_type, ev0?.resource?.invoice?.id || ev0?.resource?.id, "verified=" + ok);
  if (!ok) return res.status(400).json({ error: "signature verification failed" });
  const ev: any = req.body;
  res.status(200).json({ received: true }); // ack fast; PayPal retries non-2xx
  const inv = ev?.resource?.invoice || ev?.resource;
  if (ev?.event_type?.startsWith("INVOICING.") && inv?.id) {
    onStatus({
      id: inv.id, status: inv.status || ev.event_type.split(".").pop(), number: inv.detail?.invoice_number,
      recipient: inv.primary_recipients?.[0]?.billing_info?.email_address,
      recipient_name: inv.primary_recipients?.[0]?.billing_info?.name?.given_name,
      amount: inv.amount?.value,
    }, "webhook");
    pollOnce().catch(() => {});
  } else broadcast("event", { type: ev?.event_type, text: `PayPal event: ${ev?.event_type}` });
}
