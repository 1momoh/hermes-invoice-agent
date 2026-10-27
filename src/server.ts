import "dotenv/config";
import express from "express";
import compression from "compression";
import { randomUUID } from "node:crypto";
import { step, resolve, agentMode, type Msg, type Action } from "./agent.js";
import { cashflow, listInvoices } from "./paypal.js";
import * as FX from "./fx.js";
import { sse, webhook, startPolling, pollOnce } from "./events.js";

const app = express();
app.use(compression({ filter: (q, r) => q.path !== "/api/events" && compression.filter(q, r) }));
app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf.toString("utf8"); } }));
app.use("/vendor/ag-grid", express.static("node_modules/ag-grid-community/dist", { maxAge: "7d" }));
app.get("/dashboard", (_q, r) => r.sendFile("dashboard.html", { root: "public" }));
app.get("/api/health", (_q, r) => r.json({ ok: true, service: "hermes-invoice-agent", paypal_configured: !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET), llm_base_url_set: !!process.env.LLM_BASE_URL, webhook_id_set: !!process.env.PAYPAL_WEBHOOK_ID, time: new Date().toISOString() }));
app.get("/api/events", sse);
app.get("/api/fx", async (_q, r) => { await FX.refresh(); r.json(FX.snapshot()); });
app.post("/api/paypal/webhook", webhook);
app.post("/api/poll", async (_q, r) => { try { r.json(await pollOnce()); } catch (e: any) { r.status(500).json({ error: e.message }); } });
app.use(express.static("public"));
const sessions = new Map<string, { history: Msg[]; pending?: Action[] }>();
const sess = (id?: string) => { const k = id || randomUUID(); if (!sessions.has(k)) sessions.set(k, { history: [] }); return [k, sessions.get(k)!] as const; };

function out(s: any, k: string, r: any) {
  if (r.kind === "confirm") s.pending = r.actions;
  return { session: k, ...r };
}
app.post("/api/chat", async (req, res) => {
  const [k, s] = sess(req.body.session);
  try { s.pending = undefined; s.history.push({ role: "user", content: String(req.body.message || "") }); const trace: any[] = []; res.json({ ...out(s, k, await step(s.history, trace)), trace }); }
  catch (e: any) { res.status(500).json({ session: k, error: e.message }); }
});
app.post("/api/confirm", async (req, res) => {
  const [k, s] = sess(req.body.session);
  if (!s.pending?.length) return res.status(409).json({ session: k, error: "This request has expired (the server may have restarted). Nothing was sent. Ask again and I'll prepare a fresh one." });
  const p = s.pending; s.pending = undefined;
  try { const trace: any[] = []; const { result, outcomes, next } = await resolve(s.history, p, !!req.body.approve, trace); res.json({ result, outcomes, approved: !!req.body.approve, ...out(s, k, next), trace }); }
  catch (e: any) { res.status(500).json({ session: k, error: e.message }); }
});
app.get("/api/invoices", async (_q, r) => { try { r.json(await listInvoices()); } catch (e: any) { r.status(500).json({ error: e.message }); } });
app.get("/api/cashflow", async (_q, r) => { try { r.json(await cashflow()); } catch (e: any) { r.status(500).json({ error: e.message }); } });
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Hermes Invoice Agent on http://localhost:${port}`, agentMode()));
startPolling();
