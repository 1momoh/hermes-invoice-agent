import OpenAI from "openai";
import * as P from "./paypal.js";

const client = new OpenAI({ baseURL: process.env.LLM_BASE_URL || "http://127.0.0.1:8642/v1", apiKey: process.env.LLM_API_KEY || "none" });
const MODEL = process.env.LLM_MODEL || "hermes-agent";
// "tools" = native OpenAI tool-calling; "json" = JSON-action fallback (needed for Hermes, which ignores client tools).
const MODE = process.env.AGENT_MODE || (MODEL === "hermes-agent" ? "json" : "tools");

const TOOLS: Record<string, { description: string; parameters: any; mutating: boolean }> = {
  create_and_send_invoice: { mutating: true, description: "Create a PayPal invoice and email it to the client. Use currency NGN when the user says naira/k naira/₦ (it is converted to USD), else USD. '50k' = 50000.",
    parameters: { type: "object", required: ["recipient_email", "description", "amount", "currency", "due_date"], properties: {
      recipient_email: { type: "string" }, recipient_name: { type: "string" }, description: { type: "string" }, amount: { type: "number" },
      currency: { type: "string", enum: ["USD", "NGN"] }, due_date: { type: "string", description: "YYYY-MM-DD" }, note: { type: "string" } } } },
  list_invoices: { mutating: false, description: "List invoices and their status. Optional status filter: DRAFT, SENT, PAID, CANCELLED, UNPAID, PARTIALLY_PAID.",
    parameters: { type: "object", properties: { status: { type: "string" } } } },
  send_reminder: { mutating: true, description: "Send a payment reminder for an invoice id.", parameters: { type: "object", required: ["invoice_id"], properties: { invoice_id: { type: "string" }, note: { type: "string" } } } },
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

export function describe(name: string, a: any): string {
  if (name === "create_and_send_invoice") {
    const usd = P.toUsd(a).toFixed(2);
    const src = a.currency === "NGN" ? `NGN ${Number(a.amount).toLocaleString()} → USD ${usd} (at ${P.ngnPerUsd()} NGN/USD)` : `USD ${usd}`;
    return `Send invoice to ${a.recipient_email} for "${a.description}": ${src}, due ${a.due_date}.`;
  }
  if (name === "send_reminder") return `Send a payment reminder for invoice ${a.invoice_id}.`;
  if (name === "cancel_invoice") return `Cancel invoice ${a.invoice_id} and notify the recipient.`;
  return `${name} ${JSON.stringify(a)}`;
}

function system() {
  const d = new Date();
  return `You are HermesPay, an invoicing assistant for freelancers and small businesses (often in Nigeria). Today is ${d.toDateString()} (${d.toISOString().slice(0, 10)}). Resolve relative dates like "Friday" to the next such date as YYYY-MM-DD. PayPal invoices are issued in USD; naira amounts are converted at ${P.ngnPerUsd()} NGN per USD. Be brief. Never invent invoice ids; list invoices first if needed.`;
}

function jsonInstructions() {
  const spec = Object.entries(TOOLS).map(([n, t]) => `- ${n}: ${t.description} Args schema: ${JSON.stringify(t.parameters.properties)}`).join("\n");
  return `\n\nIMPORTANT: Do NOT use any of your own built-in tools (no web search, terminal, code). You control these application actions only:\n${spec}\n\nReply with ONLY one JSON object, no prose, no code fences:\n{"action":"<action name>","args":{...}} to request an action, or {"action":"reply","text":"..."} to answer the user.`;
}

export type Msg = { role: "user" | "assistant" | "system" | "tool"; content: string; tool_call_id?: string; tool_calls?: any };
export type Step = { kind: "reply"; text: string } | { kind: "confirm"; tool: string; args: any; summary: string };

function parseJson(s: string): any {
  const m = s.replace(/```(json)?/g, "").match(/\{[\s\S]*\}/);
  if (!m) return { action: "reply", text: s };
  try { return JSON.parse(m[0]); } catch { return { action: "reply", text: s }; }
}

/** Runs the loop until a reply, or until a mutating action needs confirmation. history is mutated. */
export async function step(history: Msg[]): Promise<Step> {
  for (let i = 0; i < 6; i++) {
    if (MODE === "json") {
      const r = await client.chat.completions.create({ model: MODEL, messages: [{ role: "system", content: system() + jsonInstructions() }, ...(history as any)] });
      const raw = r.choices[0].message.content || "";
      const j = parseJson(raw);
      history.push({ role: "assistant", content: JSON.stringify(j) });
      if (!j.action || j.action === "reply" || !TOOLS[j.action]) return { kind: "reply", text: j.text || raw };
      if (TOOLS[j.action].mutating) return { kind: "confirm", tool: j.action, args: j.args || {}, summary: describe(j.action, j.args || {}) };
      const out = await safe(j.action, j.args || {});
      history.push({ role: "user", content: `ACTION RESULT for ${j.action}: ${JSON.stringify(out)}` });
    } else {
      const r = await client.chat.completions.create({ model: MODEL, messages: [{ role: "system", content: system() }, ...(history as any)],
        tools: Object.entries(TOOLS).map(([name, t]) => ({ type: "function" as const, function: { name, description: t.description, parameters: t.parameters } })) });
      const m = r.choices[0].message;
      history.push({ role: "assistant", content: m.content || "", tool_calls: m.tool_calls });
      if (!m.tool_calls?.length) return { kind: "reply", text: m.content || "" };
      const c: any = m.tool_calls[0];
      const args = JSON.parse(c.function.arguments || "{}");
      if (TOOLS[c.function.name]?.mutating) return { kind: "confirm", tool: c.function.name, args, summary: describe(c.function.name, args) };
      for (const tc of m.tool_calls as any[]) history.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(await safe(tc.function.name, JSON.parse(tc.function.arguments || "{}"))) });
    }
  }
  return { kind: "reply", text: "Stopped after too many steps." };
}

async function safe(name: string, a: any) { try { return await runTool(name, a); } catch (e: any) { return { error: e.message }; } }

/** After the user confirms or declines a pending action. */
export async function resolve(history: Msg[], tool: string, args: any, approved: boolean): Promise<{ result: any; next: Step }> {
  const result = approved ? await safe(tool, args) : { declined: true };
  const note = `ACTION RESULT for ${tool} (${approved ? "user approved" : "user declined"}): ${JSON.stringify(result)}`;
  const last: any = history[history.length - 1];
  if (MODE !== "json" && last?.tool_calls?.length) {
    for (const tc of last.tool_calls) history.push({ role: "tool", tool_call_id: tc.id, content: tc.function.name === tool ? note : '{"skipped":true}' });
  } else history.push({ role: "user", content: note });
  return { result, next: await step(history) };
}
export const agentMode = () => ({ MODE, MODEL });
