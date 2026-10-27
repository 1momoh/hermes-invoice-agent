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
    throw new Error(`PayPal ${method} ${path} -> ${r.status}: ${msg}${hint}`);
  }
  return data;
}

import * as FX from "./fx.js";
export const ngnPerUsd = () => FX.rate("NGN").rate;

export interface InvoiceInput { recipient_email: string; recipient_name?: string; description: string; amount: number; currency: string; due_date: string; note?: string; }

export function toUsd(i: InvoiceInput) {
  return FX.convert(i.amount, i.currency).usd;
}

export async function createAndSendInvoice(i: InvoiceInput) {
  await FX.refresh();
  const fx = FX.convert(i.amount, i.currency), usd = fx.usd.toFixed(2);
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

export async function listInvoices(status?: string) {
  const j = status
    ? await pp("POST", "/v2/invoicing/search-invoices?page_size=50&total_required=true", { status: [status] })
    : await pp("GET", "/v2/invoicing/invoices?page_size=50&total_required=true&fields=amount");
  return (j.items || []).map((x: any) => ({
    id: x.id, status: x.status, number: x.detail?.invoice_number, recipient: x.primary_recipients?.[0]?.billing_info?.email_address, recipient_name: x.primary_recipients?.[0]?.billing_info?.name?.given_name,
    amount: x.amount?.value, currency: x.amount?.currency_code, due: x.detail?.payment_term?.due_date, paid: x.payments?.paid_amount?.value,
  }));
}

export async function remind(id: string, note?: string) {
  // PayPal only accepts reminders for open invoices; check first so the user gets a plain-English reason.
  const inv = await pp("GET", `/v2/invoicing/invoices/${encodeURIComponent(id)}`);
  const status = inv.status, number = inv.detail?.invoice_number;
  if (!["SENT", "UNPAID", "PARTIALLY_PAID"].includes(status)) throw new Error(`Invoice #${number ?? id} is ${status}, so PayPal won't send a reminder for it.`);
  await pp("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/remind`, { subject: "Payment reminder", note: note || "Friendly reminder that this invoice is due.", send_to_recipient: true });
  return { id, number, reminded: true, recipient: inv.primary_recipients?.[0]?.billing_info?.email_address };
}

export const cancel = (id: string, note?: string) =>
  pp("POST", `/v2/invoicing/invoices/${id}/cancel`, { subject: "Invoice cancelled", note: note || "This invoice has been cancelled.", send_to_recipient: true }).then(() => ({ id, cancelled: true }));

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
