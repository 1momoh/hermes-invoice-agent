// Access control. Two tiers:
//  - owner: Bearer APP_TOKEN. Everything allowed.
//  - public sandbox demo (no token, PAYPAL_ENV != live): anyone may chat and approve, but money/email actions
//    only reach demo recipients (@example.com, or DEMO_ALLOWED_DOMAINS).
// With PAYPAL_ENV=live the demo is off: every /api/* except health, fx and the PayPal webhook needs the owner
// token, and if APP_TOKEN is unset the API fails closed (503).
import type { NextFunction, Request, Response } from "express";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const isLive = () => process.env.PAYPAL_ENV === "live";
const appToken = () => process.env.APP_TOKEN || "";
const PUBLIC = new Set(["/api/health", "/api/fx", "/api/paypal/webhook"]);

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  if (x.length !== y.length || x.length === 0) return false;
  return timingSafeEqual(x, y);
}
export function isOwner(req: Request): boolean {
  const t = appToken(), h = req.header("authorization") || "";
  return !!t && h.startsWith("Bearer ") && safeEqual(h.slice(7).trim(), t);
}

// Short-lived signed tokens for SSE (EventSource can't send headers). Key derives from APP_TOKEN, or a per-boot random key.
const bootKey = randomBytes(32);
const key = () => (appToken() ? createHmac("sha256", appToken()).update("hia-sse").digest() : bootKey);
export function signSse(owner: boolean, ttlMs = 10 * 60_000): string {
  const body = Buffer.from(JSON.stringify({ o: owner ? 1 : 0, exp: Date.now() + ttlMs })).toString("base64url");
  return `${body}.${createHmac("sha256", key()).update(body).digest("base64url")}`;
}
export function verifySse(tok: string): { owner: boolean } | null {
  const [body, sig] = String(tok || "").split(".");
  if (!body || !sig || !safeEqual(sig, createHmac("sha256", key()).update(body).digest("base64url"))) return null;
  try { const j = JSON.parse(Buffer.from(body, "base64url").toString()); return j.exp > Date.now() ? { owner: j.o === 1 } : null; } catch { return null; }
}

/** Sets req.owner; enforces live-mode lockdown. */
export function access(req: Request, res: Response, next: NextFunction) {
  (req as any).owner = isOwner(req);
  if (!req.path.startsWith("/api/") || PUBLIC.has(req.path)) return next();
  if (req.path === "/api/events") {
    const v = verifySse(String(req.query.t || ""));
    if (!v) return res.status(401).json({ error: "Event stream token missing or expired." });
    (req as any).owner = v.owner;
  }
  if (!isLive()) return next();
  if (!appToken()) return res.status(503).json({ error: "This server isn't configured for live use." });
  if (!(req as any).owner) return res.status(401).json({ error: "Owner sign-in required." });
  next();
}

// ---- demo-mode policy -------------------------------------------------------
export const demoDomains = () => (process.env.DEMO_ALLOWED_DOMAINS || "example.com").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
export const isDemoRecipient = (email?: string) => {
  const m = String(email || "").toLowerCase().match(/^[^@\s]+@([^@\s]+)$/);
  return !!m && demoDomains().includes(m[1]);
};
export const DEMO_REFUSAL = () => `This is the public sandbox demo, so Hermes only sends to ${demoDomains().map((d) => "@" + d).join(", ")} addresses. Try a client like ada@${demoDomains()[0]}.`;

// ---- input validation -------------------------------------------------------
export const ID_RE = /^INV2-[A-Z0-9-]{4,60}$/;
export const NUMBER_RE = /^[A-Za-z0-9-]{1,25}$/;
export const EMAIL_RE = /^[^\s@<>"',;]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}$/;
export const MAX_USD = Number(process.env.MAX_INVOICE_USD || 10000);
export class UserError extends Error {} // safe to show to the client

export function validInvoiceRef(id: unknown): string {
  const s = String(id ?? "").trim();
  if (!ID_RE.test(s) && !NUMBER_RE.test(s)) throw new UserError(`"${s.slice(0, 40)}" isn't a valid invoice id or number.`);
  return s;
}
export function validateInvoice(a: any, usd: number, today = new Date().toISOString().slice(0, 10)) {
  if (!EMAIL_RE.test(String(a.recipient_email || ""))) throw new UserError("That client email doesn't look right.");
  const amt = Number(a.amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new UserError("The amount must be more than zero.");
  if (!(usd >= 0.01)) throw new UserError("That amount is less than one US cent after conversion, and PayPal won't accept it.");
  if (usd > MAX_USD) throw new UserError(`That's over the $${MAX_USD.toLocaleString()} per-invoice limit.`);
  const d = String(a.due_date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d + "T00:00:00Z")) || new Date(d + "T00:00:00Z").toISOString().slice(0, 10) !== d) throw new UserError("The due date must be a real date (YYYY-MM-DD).");
  if (d < today) throw new UserError("The due date is in the past.");
  if (!String(a.description || "").trim()) throw new UserError("The invoice needs a description.");
}
