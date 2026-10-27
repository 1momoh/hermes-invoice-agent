import express from "express";
import compression from "compression";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { step, resolve, type Action } from "./agent.js";
import { cashflow, getInvoice, listInvoices } from "./paypal.js";
import * as FX from "./fx.js";
import * as S from "./sessions.js";
import { sse, webhook, pollOnce } from "./events.js";
import { access, isLive, isDemoRecipient, DEMO_REFUSAL, signSse, demoDomains } from "./security.js";

const fail = (res: express.Response, e: any, where: string) => { console.error(`${where} failed:`, e?.message); res.status(500).json({ error: "Something went wrong on our side. Nothing was sent." }); };
const EXPIRED = "This request has expired (the server may have restarted). Nothing was sent. Ask again and I'll prepare a fresh one.";

/** Demo-mode policy: without the owner key, actions may only reach demo recipients, and never in live mode. */
export async function demoGuard(a: Action): Promise<string | null> {
  if (isLive()) return "Owner sign-in is required for live PayPal.";
  if (a.tool === "create_and_send_invoice") return isDemoRecipient(a.args?.recipient_email) ? null : DEMO_REFUSAL();
  if (a.tool === "send_reminder" || a.tool === "cancel_invoice") {
    const inv = await getInvoice(String(a.args?.invoice_id ?? ""));
    return isDemoRecipient(inv.recipient) ? null : `Invoice #${inv.number ?? "?"} isn't addressed to a demo client, so the public demo can't touch it. ${DEMO_REFUSAL()}`;
  }
  return "That action isn't available in the demo.";
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 1)); // Render/Cloudflare in front; rate limits key on the client IP
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"], imgSrc: ["'self'", "data:"], connectSrc: ["'self'"],
      objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"],
    } },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(compression({ filter: (q, r) => q.path !== "/api/events" && compression.filter(q, r) }));
  app.use(express.json({ limit: "64kb", verify: (req: any, _res, buf) => { req.rawBody = buf.toString("utf8"); } }));
  app.use(access);

  const limit = (max: number) => rateLimit({ windowMs: 60_000, limit: max, standardHeaders: "draft-7", legacyHeaders: false,
    skip: (req) => (req as any).owner, message: { error: "Slow down a little: too many requests. Try again in a minute." } });
  const chatLimit = limit(Number(process.env.RATE_CHAT_PER_MIN || 20)), confirmLimit = limit(10), pollLimit = limit(6), authLimit = limit(10);

  app.use("/vendor/ag-grid", express.static("node_modules/ag-grid-community/dist", { maxAge: "7d" }));
  app.get("/dashboard", (_q, r) => r.sendFile("dashboard.html", { root: "public" }));
  app.get("/api/health", (_q, r) => r.json({ ok: true, service: "hermes-invoice-agent", mode: isLive() ? "live" : "sandbox-demo", time: new Date().toISOString() }));
  app.get("/api/fx", async (_q, r) => { await FX.refresh(); r.json(FX.snapshot()); });
  app.post("/api/paypal/webhook", webhook);
  app.post("/api/auth", authLimit, (req, r) => (req as any).owner ? r.json({ owner: true }) : r.status(401).json({ error: "That code didn't work." }));
  app.get("/api/me", (req, r) => r.json({ owner: !!(req as any).owner, mode: isLive() ? "live" : "sandbox-demo", demo_domains: demoDomains() }));
  app.post("/api/events/token", (req, r) => r.json({ token: signSse(!!(req as any).owner) }));
  app.get("/api/events", sse);
  app.post("/api/poll", pollLimit, async (_q, r) => { try { r.json(await pollOnce()); } catch (e) { fail(r, e, "poll"); } });
  app.use(express.static("public"));

  const out = (s: S.Session, k: string, r: any) => { if (r.kind === "confirm") s.pending = r.actions; S.trim(s.history); return { session: k, ...r }; };

  app.post("/api/chat", chatLimit, async (req, res) => {
    const owner = !!(req as any).owner;
    let k = req.body?.session, s = S.get(k);
    if (k && (!s || s.owner !== owner)) return res.status(409).json({ expired: true, error: EXPIRED });
    if (!s) [k, s] = S.create(owner);
    const msg = String(req.body?.message ?? "").slice(0, 2000).trim();
    if (!msg) return res.status(400).json({ session: k, error: "Type a message first." });
    try { s.pending = undefined; s.history.push({ role: "user", content: msg }); const trace: any[] = []; res.json({ ...out(s, k, await step(s.history, trace)), trace }); }
    catch (e) { fail(res, e, "chat"); }
  });
  app.post("/api/confirm", confirmLimit, async (req, res) => {
    const owner = !!(req as any).owner, k = req.body?.session, s = S.get(k);
    if (!s || s.owner !== owner || !s.pending?.length) return res.status(409).json({ expired: true, error: EXPIRED });
    const p = s.pending; s.pending = undefined;
    try {
      const trace: any[] = [];
      const { result, outcomes, next } = await resolve(s.history, p, !!req.body?.approve, trace, owner ? undefined : demoGuard);
      res.json({ result, outcomes, approved: !!req.body?.approve, ...out(s, k, next), trace });
    } catch (e) { fail(res, e, "confirm"); }
  });
  app.get("/api/invoices", async (_q, r) => { try { r.json(await listInvoices()); } catch (e) { fail(r, e, "invoices"); } });
  app.get("/api/cashflow", async (_q, r) => { try { r.json(await cashflow()); } catch (e) { fail(r, e, "cashflow"); } });
  app.use("/api", (_q, r) => r.status(404).json({ error: "Not found." }));
  app.use((e: any, _q: express.Request, r: express.Response, _n: express.NextFunction) => { console.error("request error:", e?.message); r.status(e?.status === 400 ? 400 : 500).json({ error: e?.status === 400 ? "Bad request." : "Something went wrong." }); });
  return app;
}
