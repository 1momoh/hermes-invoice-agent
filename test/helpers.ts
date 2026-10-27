import { vi } from "vitest";
export type Call = { method: string; url: string; body?: any };
/** A fake PayPal: records every call, serves invoices from an in-memory list (paged). */
export function fakePayPal(invoices: any[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: any, init: any = {}) => {
    const u = new URL(String(url)), method = init.method || "GET", body = init.body ? (() => { try { return JSON.parse(init.body); } catch { return init.body; } })() : undefined;
    calls.push({ method, url: u.pathname + u.search, body });
    const json = (j: any, status = 200) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });
    if (u.hostname === "open.er-api.com") return json({ result: "error" });
    if (u.pathname === "/v1/oauth2/token") return json({ access_token: "t", expires_in: 3600 });
    if (u.pathname === "/v2/invoicing/invoices" && method === "GET") {
      const page = Number(u.searchParams.get("page") || 1), size = Number(u.searchParams.get("page_size") || 20);
      return json({ items: invoices.slice((page - 1) * size, page * size), total_items: invoices.length, total_pages: Math.ceil(invoices.length / size) });
    }
    const m = u.pathname.match(/^\/v2\/invoicing\/invoices\/([^/]+)(\/\w+)?$/);
    if (m && method === "GET") { const x = invoices.find((i) => i.id === decodeURIComponent(m[1])); return x ? json(x) : json({ name: "RESOURCE_NOT_FOUND" }, 404); }
    if (m && method === "POST") return new Response(null, { status: 204 });
    if (u.pathname === "/v2/invoicing/invoices" && method === "POST") { const x = { ...inv(99, body?.primary_recipients?.[0]?.billing_info?.email_address, "SENT"), id: "INV2-NEW1-AAAA" }; invoices.push(x); return json({ id: x.id }, 201); }
    return json({ name: "UNHANDLED" }, 500);
  });
  return { fn, calls };
}
export const inv = (n: number, email = "ada@example.com", status = "SENT", amount = "10.00") => ({
  id: `INV2-TEST-${String(n).padStart(4, "0")}`, status, detail: { invoice_number: String(n).padStart(4, "0"), payment_term: { due_date: "2099-01-01" } },
  primary_recipients: [{ billing_info: { email_address: email } }], amount: { value: amount, currency_code: "USD" },
});
