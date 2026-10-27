// Minimal PayPal REST client (sandbox by default). Never logs credentials.
const BASE = process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
let cached: { token: string; exp: number } | null = null;

async function token(): Promise<string> {
  if (cached && Date.now() < cached.exp) return cached.token;
  const id = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not set");
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`PayPal OAuth failed: ${r.status}`);
  const j: any = await r.json();
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return cached.token;
}

export class PayPalError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function pp(method: string, path: string, body?: unknown): Promise<any> {
  const r = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data: any = text;
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!r.ok) {
    const msg = data?.message || data?.name || text;
    const hint = r.status === 403 ? " (403: enable this feature, e.g. Invoicing, on your app in the PayPal developer dashboard)" : "";
    console.error(`PayPal ${method} ${path} -> ${r.status}: ${typeof msg === "string" ? msg.slice(0, 300) : ""}${hint}`);
    throw new PayPalError(r.status, `PayPal couldn't complete that (HTTP ${r.status}).`);
  }
  return data;
}

import * as FX from "./fx.js";
import { UserError, validateInvoice, validInvoiceRef } from "./security.js";
export const ngnPerUsd = () => FX.rate("NGN").rate;

export interface InvoiceInput { recipient_email: string; recipient_name?: string; description: string; amount: number; currency: string; due_date: string; note?: string; }

export function toUsd(i: InvoiceInput) {
  return FX.convert(i.amount, i.currency).usd;
}

export async function createAndSendInvoice(i: InvoiceInput) {
  await FX.refresh();
  if (!FX.isLocal(i.currency) && i.currency !== "USD") throw new UserError(`${String(i.currency).slice(0, 8)} isn't supported.`);
  const fx = FX.convert(Number(i.amount), i.currency), usd = fx.usd.toFixed(2);
  validateInvoice(i, fx.usd);
  const ngnNote = FX.isLocal(i.currency) ? `Billed as ${i.currency} ${i.amount.toLocaleString()} at ${fx.rate} ${i.currency}/USD (${fx.source} rate). PayPal settles in USD.` : "";
  const draft = await pp("POST", "/v2/invoicing/invoices", {
    detail: { currency_code: "USD", note: [i.note, ngnNote].filter(Boolean).join(" ") || undefined, payment_term: { due_date: i.due_date } },
    primary_recipients: [{ billing_info: { email_address: i.recipient_email, ...(i.recipient_name ? { name: { given_name: i.recipient_name } } : {}) } }],
    items: [{ name: i.description.slice(0, 200), quantity: "1", unit_amount: { currency_code: "USD", value: usd } }],
  });
  const id: string = draft.id || String(draft.href || "").split("/").pop();
  await pp("POST", `/v2/invoicing/invoices/${id}/send`, { send_to_recipient: true });
  const inv = await pp("GET", `/v2/invoicing/invoices/${id}`);
  return { id, status: inv.status, amount_usd: usd, due_date: i.due_date, recipient: i.recipient_email,
    pay_link: inv.detail?.metadata?.recipient_view_url, fx };
}

const PAGE = 100, MAX_PAGES = 50;
const row = (x: any) => ({
  id: x.id, status: x.status, number: x.detail?.invoice_number, recipient: x.primary_recipients?.[0]?.billing_info?.email_address, recipient_name: x.primary_recipients?.[0]?.billing_info?.name?.given_name,
  amount: x.amount?.value, currency: x.amount?.currency_code, due: x.detail?.payment_term?.due_date, paid: x.payments?.paid_amount?.value,
});
/** All invoices, every page (PayPal caps page_size at 100). Stops on a short page, total_pages, or a safety cap. */
export async function listInvoices(status?: string) {
  const out: any[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const j = status
      ? await pp("POST", `/v2/invoicing/search-invoices?page=${page}&page_size=${PAGE}&total_required=true`, { status: [status] })
      : await pp("GET", `/v2/invoicing/invoices?page=${page}&page_size=${PAGE}&total_required=true&fields=amount`);
    const items = j.items || [];
    out.push(...items.map(row));
    const pages = Number(j.total_pages || 0);
    if (items.length < PAGE || (pages && page >= pages)) break;
  }
  return out;
}

export async function getInvoice(ref: string) {
  const id = validInvoiceRef(ref);
  if (id.startsWith("INV2-")) return row(await pp("GET", `/v2/invoicing/invoices/${encodeURIComponent(id)}`));
  const x = (await listInvoices()).find((r) => r.number === id);
  if (!x) throw new UserError(`I couldn't find invoice #${id}.`);
  return x;
}

export async function remind(ref: string, note?: string) {
  // PayPal only accepts reminders for open invoices; check first so the user gets a plain-English reason.
  const inv = await getInvoice(ref);
  if (!["SENT", "UNPAID", "PARTIALLY_PAID"].includes(inv.status)) throw new UserError(`Invoice #${inv.number ?? inv.id} is ${inv.status}, so PayPal won't send a reminder for it.`);
  await pp("POST", `/v2/invoicing/invoices/${encodeURIComponent(inv.id)}/remind`, { subject: "Payment reminder", note: String(note || "Friendly reminder that this invoice is due.").slice(0, 500), send_to_recipient: true });
  return { id: inv.id, number: inv.number, reminded: true, recipient: inv.recipient };
}

export async function cancel(ref: string, note?: string) {
  const inv = await getInvoice(ref);
  await pp("POST", `/v2/invoicing/invoices/${encodeURIComponent(inv.id)}/cancel`, { subject: "Invoice cancelled", note: String(note || "This invoice has been cancelled.").slice(0, 500), send_to_recipient: true });
  return { id: inv.id, number: inv.number, cancelled: true };
}

export async function cashflow() {
  const all = await listInvoices();
  const today = new Date().toISOString().slice(0, 10);
  const sum = (f: (x: any) => boolean) => all.filter(f).reduce((a: number, x: any) => a + Number(x.amount || 0), 0);
  const open = (x: any) => ["SENT", "UNPAID", "PARTIALLY_PAID", "SCHEDULED"].includes(x.status);
  return {
    count: all.length,
    paid_usd: sum((x) => x.status === "PAID" || x.status === "MARKED_AS_PAID").toFixed(2),
    outstanding_usd: sum(open).toFixed(2),
    overdue_usd: sum((x) => open(x) && x.due && x.due < today).toFixed(2),
    overdue: all.filter((x: any) => open(x) && x.due && x.due < today),
    cancelled_usd: sum((x) => x.status === "CANCELLED").toFixed(2),
    by_status: all.reduce((a: Record<string, number>, x: any) => ({ ...a, [x.status]: (a[x.status] || 0) + 1 }), {}),
    note: "Live data from PayPal; it supersedes any earlier statuses in the conversation.",
    ngn_per_usd: ngnPerUsd(),
  };
}
