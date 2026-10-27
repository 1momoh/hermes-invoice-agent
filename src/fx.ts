// Local-currency → USD conversion. PayPal Invoicing can't issue invoices in NGN (and other local currencies),
// so we bill in the client's currency and settle in USD. Live rates from open.er-api.com (free, no key), cached 1h;
// fixed fallbacks from env (NGN_PER_USD etc.) when the API is unreachable.
export const LOCAL = { NGN: "₦", KES: "KSh", GHS: "GH₵", ZAR: "R", INR: "₹" } as const;
export type Local = keyof typeof LOCAL;
export const SETTLE = "USD";
const FIXED: Record<Local, number> = { NGN: 1500, KES: 129, GHS: 15.6, ZAR: 18.2, INR: 84.1 };
const fixed = (c: Local) => Number(process.env[`${c}_PER_USD`] || FIXED[c]);
let cache: { rates: Record<string, number>; at: number; asOf: string } | null = null;
const TTL = 60 * 60 * 1000;

export async function refresh(force = false) {
  if (!force && cache && Date.now() - cache.at < TTL) return;
  if (process.env.FX_MODE === "fixed") return;
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(4000) });
    const j: any = await r.json();
    if (j.result !== "success") throw new Error(j["error-type"] || "fx error");
    cache = { rates: j.rates, at: Date.now(), asOf: new Date(j.time_last_update_unix * 1000).toISOString() };
  } catch { if (cache) cache.at = Date.now() - TTL + 5 * 60 * 1000; } // keep stale rates, retry in 5 min
}
export function rate(c: string): { rate: number; source: "live" | "fixed"; asOf?: string } {
  if (c === SETTLE) return { rate: 1, source: "fixed" };
  const live = cache?.rates?.[c];
  return live ? { rate: live, source: "live", asOf: cache!.asOf } : { rate: fixed(c as Local), source: "fixed" };
}
export const isLocal = (c: string): c is Local => c in LOCAL;
export function convert(amount: number, currency: string) {
  currency = normalizeCurrency(currency).code;
  const r = rate(currency), usd = Math.round((amount / r.rate) * 100) / 100;
  return { from: currency, symbol: (LOCAL as any)[currency] || "$", amount, usd, settle: SETTLE, rate: r.rate, source: r.source, asOf: r.asOf, converted: currency !== SETTLE };
}
/** Map what a model or user might write ("$", "usd", "dollars", "₦", "naira"…) to a supported code. Empty → USD (assumed). */
const ALIASES: Record<string, string> = { "$": "USD", US$: "USD", USD: "USD", DOLLAR: "USD", DOLLARS: "USD", "US DOLLARS": "USD",
  "₦": "NGN", NAIRA: "NGN", KSH: "KES", SHILLINGS: "KES", "GH₵": "GHS", CEDIS: "GHS", CEDI: "GHS", R: "ZAR", RAND: "ZAR", "₹": "INR", RUPEES: "INR", RUPEE: "INR" };
export function normalizeCurrency(c: unknown): { code: string; assumed: boolean } {
  const k = String(c ?? "").trim().toUpperCase();
  if (!k) return { code: SETTLE, assumed: true };
  return { code: ALIASES[k] || k, assumed: false };
}
export const needsFx = (c: string) => normalizeCurrency(c).code !== SETTLE;
export function snapshot() {
  return { settle: SETTLE, provider: "open.er-api.com", currencies: Object.fromEntries(Object.entries(LOCAL).map(([c, s]) => [c, { symbol: s, ...rate(c) }])),
    reason: "PayPal Invoicing doesn't support NGN, KES, GHS, ZAR or INR, so invoices are converted and settled in USD." };
}
