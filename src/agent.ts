import OpenAI from "openai";
import * as P from "./paypal.js";
import * as FX from "./fx.js";

const client = new OpenAI({ baseURL: process.env.LLM_BASE_URL || "http://127.0.0.1:8642/v1", apiKey: process.env.LLM_API_KEY || "none" });
const MODEL = process.env.LLM_MODEL || "hermes-agent";
// "tools" = native OpenAI tool-calling; "json" = JSON-action fallback (needed for Hermes, which ignores client tools).
const MODE = process.env.AGENT_MODE || (MODEL === "hermes-agent" ? "json" : "tools");

const TOOLS: Record<string, { description: string; parameters: any; mutating: boolean }> = {
  create_and_send_invoice: { mutating: true, description: "Create a PayPal invoice and email it to the client. Set currency from the user's symbol or words: ₦/naira/NGN → NGN, KSh/shillings/KES → KES, GH₵/cedis/GHS → GHS, R/rand/ZAR → ZAR, ₹/rupees/INR → INR, $/dollars → USD. Keep the amount in that currency; the app converts it to USD. '50k' = 50000.",
    parameters: { type: "object", required: ["recipient_email", "description", "amount", "currency", "due_date"], properties: {
      recipient_email: { type: "string" }, recipient_name: { type: "string" }, description: { type: "string" }, amount: { type: "number" },
      currency: { type: "string", enum: ["USD", "NGN", "KES", "GHS", "ZAR", "INR"] }, due_date: { type: "string", description: "YYYY-MM-DD" }, note: { type: "string" } } } },
  list_invoices: { mutating: false, description: "List invoices and their status. Optional status filter: DRAFT, SENT, PAID, CANCELLED, UNPAID, PARTIALLY_PAID.",
    parameters: { type: "object", properties: { status: { type: "string" } } } },
  send_reminder: { mutating: true, description: "Send a payment reminder for one invoice id. To remind several invoices (e.g. 'remind all' / 'yes' after listing unpaid ones), call this once per invoice in the SAME turn, using the exact ids from list_invoices for every invoice you listed.", parameters: { type: "object", required: ["invoice_id"], properties: { invoice_id: { type: "string" }, note: { type: "string" } } } },
  cancel_invoice: { mutating: true, description: "Cancel a sent invoice by id.", parameters: { type: "object", required: ["invoice_id"], properties: { invoice_id: { type: "string" }, note: { type: "string" } } } },
  cashflow_summary: { mutating: false, description: "Totals of paid, outstanding and overdue invoices.", parameters: { type: "object", properties: {} } },
};

export async function runTool(name: string, a: any): Promise<any> {
  switch (name) {
    case "create_and_send_invoice": return P.createAndSendInvoice(a);
    case "list_invoices": return P.listInvoices(a.status);
    case "send_reminder": return P.remind(a.invoice_id, a.note);
    case "cancel_invoice": return P.cancel(a.invoice_id, a.note);
    case "cashflow_summary": return P.cashflow();
  }
  throw new Error(`unknown tool ${name}`);
}

export function describe(name: string, a: any, inv?: Action["invoice"]): string {
  const label = inv ? `invoice #${inv.number ?? "?"} to ${inv.client ?? "client"} (${inv.currency ?? "USD"} ${inv.amount ?? "?"})` : `invoice ${a.invoice_id}`;
  if (name === "create_and_send_invoice") {
    const f = FX.convert(Number(a.amount), a.currency || "USD"), usd = f.usd.toFixed(2);
    const src = FX.isLocal(f.from) ? `${f.from} ${f.amount.toLocaleString()} → USD ${usd} (at ${f.rate.toFixed(2)} ${f.from}/USD, ${f.source})` : `USD ${usd}`;
    return `Send invoice to ${a.recipient_email} for "${a.description}": ${src}, due ${a.due_date}.`;
  }
  if (name === "send_reminder") return `Send a payment reminder for ${label}.`;
  if (name === "cancel_invoice") return `Cancel ${label} and notify the recipient.`;
  return `${name} ${JSON.stringify(a)}`;
}

function system() {
  const d = new Date();
  return `You are Hermes Invoice Agent, an invoicing assistant for freelancers and small businesses anywhere in the world. Today is ${d.toDateString()} (${d.toISOString().slice(0, 10)}). Resolve relative dates like "Friday" to the next such date as YYYY-MM-DD. PayPal invoices settle in USD; local-currency amounts (NGN, KES, GHS, ZAR, INR) are converted by the app at live rates. Be brief. Never invent invoice ids; list invoices first if needed. When acting on several invoices, request one action per invoice in the same turn, covering every invoice you listed. Plain markdown (bold, lists, small tables) is fine.`;
}

function jsonInstructions() {
  const spec = Object.entries(TOOLS).map(([n, t]) => `- ${n}: ${t.description} Args schema: ${JSON.stringify(t.parameters.properties)}`).join("\n");
  return `\n\nIMPORTANT: Do NOT use any of your own built-in tools (no web search, terminal, code). You control these application actions only:\n${spec}\n\nReply with ONLY one JSON object, no prose, no code fences:\n{"action":"<action name>","args":{...}} to request an action, or {"action":"reply","text":"..."} to answer the user. To request several mutating actions at once (e.g. a reminder for each unpaid invoice) reply {"actions":[{"action":"send_reminder","args":{...}}, ...]}.`;
}

export type Msg = { role: "user" | "assistant" | "system" | "tool"; content: string; tool_call_id?: string; tool_calls?: any };
export type Action = { tool: string; args: any; summary: string; call_id?: string; invoice?: { number?: string; client?: string; amount?: string; currency?: string; status?: string; due?: string } };
export type Step = { kind: "reply"; text: string } | { kind: "confirm"; tool: string; args: any; summary: string; fx?: any; actions: Action[] };
export type Outcome = { tool: string; ok: boolean; summary: string; invoice?: Action["invoice"]; result?: any; error?: string };
export type Trace = { k: "think" | "tool" | "guard" | "fx" | "act"; label: string; detail?: string; ms?: number }[];
const ms = (t: number) => Math.round(performance.now() - t);
const OPEN = ["SENT", "UNPAID", "PARTIALLY_PAID", "SCHEDULED"];
/** Look up invoice number/client/amount so cards show something humans recognise, not just a raw id. */
async function enrich(calls: { tool: string; args: any; call_id?: string }[]): Promise<Action[]> {
  let list: any[] = [];
  if (calls.some((c) => c.args?.invoice_id)) { try { list = await P.listInvoices(); } catch {} }
  return calls.map((c) => {
    const x = c.args?.invoice_id ? list.find((i) => i.id === c.args.invoice_id || i.number === c.args.invoice_id) : undefined;
    if (x && c.args.invoice_id !== x.id) c.args.invoice_id = x.id; // model passed the number; normalise to the id
    const invoice = x ? { number: x.number, client: x.recipient_name || x.recipient, amount: x.amount, currency: x.currency, status: x.status, due: x.due } : undefined;
    return { ...c, invoice, summary: describe(c.tool, c.args, invoice) };
  });
}
async function confirmBatch(calls: { tool: string; args: any; call_id?: string }[], trace: Trace): Promise<Step> {
  const actions = await enrich(calls);
  const first = actions[0];
  let fx;
  if (first.tool === "create_and_send_invoice") { fx = FX.convert(Number(first.args.amount), first.args.currency || "USD"); if (FX.isLocal(fx.from)) trace.push({ k: "fx", label: `Convert ${fx.from} → USD`, detail: `${fx.amount.toLocaleString()} ÷ ${fx.rate.toFixed(2)} = ${fx.usd.toFixed(2)} (${fx.source} rate)` }); }
  trace.push({ k: "guard", label: `Paused for your signature${actions.length > 1 ? ` (${actions.length} actions)` : ""}`, detail: `${[...new Set(actions.map((a) => a.tool))].join(", ")} changes money or emails a client, so it needs approval` });
  return { kind: "confirm", tool: first.tool, args: first.args, summary: actions.map((a) => a.summary).join("\n"), fx, actions };
}
function parseJson(s: string): any {
  const m = s.replace(/```(json)?/g, "").match(/\{[\s\S]*\}/);
  if (!m) return { action: "reply", text: s };
  try { return JSON.parse(m[0]); } catch {}
  // LLMs often put raw newlines/tabs inside JSON strings; escape control chars that sit inside string literals.
  let out = "", inStr = false, esc = false;
  for (const ch of m[0]) {
    if (inStr && !esc && ch === "\n") { out += "\\n"; continue; }
    if (inStr && !esc && ch === "\r") { out += "\\r"; continue; }
    if (inStr && !esc && ch === "\t") { out += "\\t"; continue; }
    if (ch === '"' && !esc) inStr = !inStr;
    esc = !esc && ch === "\\";
    out += ch;
  }
  try { return JSON.parse(out); } catch { return { action: "reply", text: s }; }
}

/** Runs the loop until a reply, or until a mutating action needs confirmation. history is mutated. */
export async function step(history: Msg[], trace: Trace = []): Promise<Step> {
  await FX.refresh();
  for (let i = 0; i < 6; i++) {
    if (MODE === "json") {
      const t0 = performance.now();
      const r = await client.chat.completions.create({ model: MODEL, messages: [{ role: "system", content: system() + jsonInstructions() }, ...(history as any)] });
      const raw = r.choices[0].message.content || "";
      let j = parseJson(raw);
      if (Array.isArray(j.actions)) {
        const calls = j.actions.filter((x: any) => TOOLS[x?.action]?.mutating).map((x: any) => ({ tool: x.action, args: x.args || {} }));
        history.push({ role: "assistant", content: JSON.stringify(j) });
        if (calls.length) { trace.push({ k: "think", label: `${MODEL} decided: ${calls.length} actions`, ms: ms(t0) }); return confirmBatch(calls, trace); }
        j = j.actions[0] || { action: "reply", text: raw }; history.pop();
      }
      history.push({ role: "assistant", content: JSON.stringify(j) });
      trace.push({ k: "think", label: `${MODEL} decided: ${j.action || "reply"}`, ms: ms(t0) });
      if (!j.action || j.action === "reply" || !TOOLS[j.action]) return { kind: "reply", text: j.text || raw };
      trace.push({ k: "tool", label: `Call ${j.action}`, detail: JSON.stringify(j.args || {}) });
      if (TOOLS[j.action].mutating) return confirmBatch([{ tool: j.action, args: j.args || {} }], trace);
      const t1 = performance.now(); const out = await safe(j.action, j.args || {}); trace.push({ k: "act", label: `${j.action} returned`, detail: brief(out), ms: ms(t1) });
      history.push({ role: "user", content: `ACTION RESULT for ${j.action}: ${JSON.stringify(out)}` });
    } else {
      const t0 = performance.now();
      const r = await client.chat.completions.create({ model: MODEL, messages: [{ role: "system", content: system() }, ...(history as any)],
        tools: Object.entries(TOOLS).map(([name, t]) => ({ type: "function" as const, function: { name, description: t.description, parameters: t.parameters } })) });
      const m = r.choices[0].message;
      history.push({ role: "assistant", content: m.content || "", tool_calls: m.tool_calls });
      trace.push({ k: "think", label: m.tool_calls?.length ? `${MODEL} chose ${m.tool_calls.map((x: any) => x.function.name).join(", ")}` : `${MODEL} wrote a reply`, ms: ms(t0) });
      if (!m.tool_calls?.length) return { kind: "reply", text: m.content || "" };
      for (const tc of m.tool_calls as any[]) trace.push({ k: "tool", label: `Call ${tc.function.name}`, detail: tc.function.arguments });
      const muts = (m.tool_calls as any[]).filter((tc) => TOOLS[tc.function.name]?.mutating);
      if (muts.length) return confirmBatch(muts.map((tc) => ({ tool: tc.function.name, args: parseArgs(tc.function.arguments), call_id: tc.id })), trace);
      for (const tc of m.tool_calls as any[]) { const t1 = performance.now(); const o = await safe(tc.function.name, parseArgs(tc.function.arguments)); trace.push({ k: "act", label: `${tc.function.name} returned`, detail: brief(o), ms: ms(t1) }); history.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(o) }); }
    }
  }
  return { kind: "reply", text: "Stopped after too many steps." };
}

function parseArgs(s?: string) { try { return JSON.parse(s || "{}"); } catch { return {}; } }
function brief(o: any) { if (Array.isArray(o)) return `${o.length} items`; if (o?.error) return "error: " + o.error; const s = JSON.stringify(o); return s.length > 120 ? s.slice(0, 117) + "…" : s; }
async function safe(name: string, a: any) { try { return await runTool(name, a); } catch (e: any) { return { error: e.message }; } }

/** After the user confirms or declines pending action(s). Runs every action, never throws for a single failure. */
export async function resolve(history: Msg[], actions: Action[], approved: boolean, trace: Trace = []): Promise<{ result: any; outcomes: Outcome[]; next: Step }> {
  trace.push({ k: "guard", label: approved ? "You signed" : "You declined", detail: actions.map((a) => a.tool).join(", ") });
  const outcomes: Outcome[] = [];
  for (const a of actions) {
    if (!approved) { outcomes.push({ tool: a.tool, ok: false, summary: a.summary, invoice: a.invoice, result: { declined: true } }); continue; }
    const t1 = performance.now();
    const r = await safe(a.tool, a.args);
    trace.push({ k: "act", label: `PayPal ${a.tool}${a.invoice?.number ? " #" + a.invoice.number : ""}`, detail: brief(r), ms: ms(t1) });
    outcomes.push({ tool: a.tool, ok: !r?.error, summary: a.summary, invoice: a.invoice, result: r, error: r?.error });
  }
  const noteFor = (i: number) => `ACTION RESULT for ${actions[i].tool} (${approved ? "user approved" : "user declined"}): ${JSON.stringify(outcomes[i].result)}`;
  const last: any = history[history.length - 1];
  if (MODE !== "json" && last?.tool_calls?.length) {
    for (const tc of last.tool_calls) {
      const i = actions.findIndex((a) => a.call_id === tc.id);
      history.push({ role: "tool", tool_call_id: tc.id, content: i >= 0 ? noteFor(i) : '{"skipped":true}' });
    }
  } else history.push({ role: "user", content: actions.map((_, i) => noteFor(i)).join("\n") });
  let next: Step;
  try { next = await step(history, trace); }
  catch (e: any) { next = { kind: "reply", text: "" }; trace.push({ k: "think", label: "Follow-up reply failed", detail: e.message }); }
  return { result: approved ? (actions.length === 1 ? outcomes[0].result : outcomes.map((o) => o.result)) : { declined: true }, outcomes, next };
}
export const agentMode = () => ({ MODE, MODEL });
