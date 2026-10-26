import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { step, resolve, agentMode, type Msg } from "./agent.js";
import { cashflow, listInvoices } from "./paypal.js";
import { sse, webhook, startPolling, pollOnce } from "./events.js";

const app = express();
app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf.toString("utf8"); } }));
app.use("/vendor/ag-grid", express.static("node_modules/ag-grid-community/dist"));
app.get("/dashboard", (_q, r) => r.sendFile("dashboard.html", { root: "public" }));
app.get("/api/events", sse);
app.post("/api/paypal/webhook", webhook);
app.post("/api/poll", async (_q, r) => { try { r.json(await pollOnce()); } catch (e: any) { r.status(500).json({ error: e.message }); } });
app.use(express.static("public"));
const sessions = new Map<string, { history: Msg[]; pending?: { tool: string; args: any } }>();
const sess = (id?: string) => { const k = id || randomUUID(); if (!sessions.has(k)) sessions.set(k, { history: [] }); return [k, sessions.get(k)!] as const; };

function out(s: any, k: string, r: any) {
  if (r.kind === "confirm") s.pending = { tool: r.tool, args: r.args };
  return { session: k, ...r };
}
app.post("/api/chat", async (req, res) => {
  const [k, s] = sess(req.body.session);
  try { s.pending = undefined; s.history.push({ role: "user", content: String(req.body.message || "") }); res.json(out(s, k, await step(s.history))); }
  catch (e: any) { res.status(500).json({ session: k, error: e.message }); }
});
app.post("/api/confirm", async (req, res) => {
  const [k, s] = sess(req.body.session);
  if (!s.pending) return res.status(400).json({ error: "nothing pending" });
  const p = s.pending; s.pending = undefined;
  try { const { result, next } = await resolve(s.history, p.tool, p.args, !!req.body.approve); res.json({ result, ...out(s, k, next) }); }
  catch (e: any) { res.status(500).json({ session: k, error: e.message }); }
});
app.get("/api/invoices", async (_q, r) => { try { r.json(await listInvoices()); } catch (e: any) { r.status(500).json({ error: e.message }); } });
app.get("/api/cashflow", async (_q, r) => { try { r.json(await cashflow()); } catch (e: any) { r.status(500).json({ error: e.message }); } });
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`HermesPay on http://localhost:${port}`, agentMode()));
startPolling();
