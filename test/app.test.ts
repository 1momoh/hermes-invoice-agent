import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { fakePayPal, inv } from "./helpers.js";

// Scripted LLM: each test sets the next tool call(s) the "model" makes.
const llm = vi.hoisted(() => ({ next: [] as any[] }));
vi.mock("openai", () => ({ default: class { chat = { completions: { create: async () => ({ choices: [{ message: llm.next.shift() || { content: "ok" } }] }) } }; } }));
const call = (name: string, args: any, id = "c" + Math.random()) => ({ content: "", tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });

const TOKEN = "t".repeat(48);
let base = "", server: any, pp: ReturnType<typeof fakePayPal>;
const realFetch = globalThis.fetch;
const api = (path: string, body?: any, token?: string) => realFetch(base + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
const ppPosts = () => pp.calls.filter((c) => c.method === "POST" && c.url.startsWith("/v2/"));

beforeAll(async () => {
  Object.assign(process.env, { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s", APP_TOKEN: TOKEN, FX_MODE: "fixed", AGENT_MODE: "tools", LLM_MODEL: "test", POLL_MINUTES: "0" });
  delete process.env.PAYPAL_ENV;
  const { createApp } = await import("../src/app.js");
  server = createApp().listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());
beforeEach(() => { pp = fakePayPal([inv(1, "ada@example.com"), inv(2, "real.client@gmail.com")]); vi.stubGlobal("fetch", pp.fn); llm.next = []; });

describe("confirm gate", () => {
  it("a mutating tool never executes without confirm, and does after it", async () => {
    llm.next = [call("create_and_send_invoice", { recipient_email: "ada@example.com", description: "Logo", amount: 50, currency: "USD", due_date: "2099-01-01" })];
    const r = await (await api("/api/chat", { message: "bill ada" })).json();
    expect(r.kind).toBe("confirm");
    expect(ppPosts()).toHaveLength(0);
    const c = await (await api("/api/confirm", { session: r.session, approve: true })).json();
    expect(c.outcomes[0].ok).toBe(true);
    expect(ppPosts().map((x) => x.url)).toContain("/v2/invoicing/invoices");
  });
  it("declining executes nothing", async () => {
    llm.next = [call("send_reminder", { invoice_id: "INV2-TEST-0001" })];
    const r = await (await api("/api/chat", { message: "remind" })).json();
    await api("/api/confirm", { session: r.session, approve: false });
    expect(ppPosts()).toHaveLength(0);
  });
  it("unknown, missing or replayed sessions get 409", async () => {
    expect((await api("/api/confirm", { session: "made-up", approve: true })).status).toBe(409);
    expect((await api("/api/confirm", { approve: true })).status).toBe(409);
    expect((await api("/api/chat", { session: "made-up", message: "hi" })).status).toBe(409);
    llm.next = [call("send_reminder", { invoice_id: "INV2-TEST-0001" })];
    const r = await (await api("/api/chat", { message: "remind" })).json();
    expect((await api("/api/confirm", { session: r.session, approve: true })).status).toBe(200);
    expect((await api("/api/confirm", { session: r.session, approve: true })).status).toBe(409);
  });
  it("a public session can't be confirmed under a different identity", async () => {
    llm.next = [call("send_reminder", { invoice_id: "INV2-TEST-0001" })];
    const r = await (await api("/api/chat", { message: "remind" })).json();
    expect((await api("/api/confirm", { session: r.session, approve: true }, TOKEN)).status).toBe(409);
  });
});

describe("demo mode (no owner token, sandbox)", () => {
  it("refuses invoices to non-demo recipients, with a friendly message", async () => {
    llm.next = [call("create_and_send_invoice", { recipient_email: "boss@gmail.com", description: "x", amount: 5, currency: "USD", due_date: "2099-01-01" })];
    const r = await (await api("/api/chat", { message: "bill" })).json();
    const c = await (await api("/api/confirm", { session: r.session, approve: true })).json();
    expect(c.outcomes[0].ok).toBe(false);
    expect(c.outcomes[0].error).toMatch(/sandbox demo.*@example\.com/);
    expect(ppPosts()).toHaveLength(0);
  });
  it("remind/cancel only for invoices addressed to demo clients", async () => {
    llm.next = [{ content: "", tool_calls: [
      { id: "a", type: "function", function: { name: "send_reminder", arguments: '{"invoice_id":"INV2-TEST-0001"}' } },
      { id: "b", type: "function", function: { name: "cancel_invoice", arguments: '{"invoice_id":"INV2-TEST-0002"}' } }] }];
    const r = await (await api("/api/chat", { message: "go" })).json();
    expect(r.actions).toHaveLength(2);
    const c = await (await api("/api/confirm", { session: r.session, approve: true })).json();
    expect(c.outcomes.map((o: any) => o.ok)).toEqual([true, false]);
    expect(ppPosts().map((x) => x.url)).toEqual(["/v2/invoicing/invoices/INV2-TEST-0001/remind"]);
  });
  it("the owner token unlocks non-demo recipients", async () => {
    llm.next = [call("cancel_invoice", { invoice_id: "INV2-TEST-0002" })];
    const r = await (await api("/api/chat", { message: "cancel 2" }, TOKEN)).json();
    const c = await (await api("/api/confirm", { session: r.session, approve: true }, TOKEN)).json();
    expect(c.outcomes[0].ok).toBe(true);
  });
  it("public reads work without a token", async () => {
    expect((await api("/api/invoices")).status).toBe(200);
    expect((await api("/api/health")).status).toBe(200);
  });
});

describe("live mode", () => {
  it("requires the owner token on everything except health/fx (401), and accepts it (200)", async () => {
    process.env.PAYPAL_ENV = "live";
    try {
      for (const p of ["/api/invoices", "/api/cashflow", "/api/me"]) expect((await api(p)).status).toBe(401);
      expect((await api("/api/chat", { message: "hi" })).status).toBe(401);
      expect((await api("/api/confirm", { session: "x", approve: true })).status).toBe(401);
      expect((await api("/api/invoices", undefined, "wrong")).status).toBe(401);
      expect((await api("/api/invoices", undefined, TOKEN)).status).toBe(200);
      expect((await api("/api/health")).status).toBe(200);
      expect((await api("/api/events")).status).toBe(401);
    } finally { delete process.env.PAYPAL_ENV; }
  });
  it("fails closed when APP_TOKEN is unset", async () => {
    process.env.PAYPAL_ENV = "live"; const t = process.env.APP_TOKEN; delete process.env.APP_TOKEN;
    try { expect((await api("/api/invoices", undefined, "anything")).status).toBe(503); }
    finally { process.env.APP_TOKEN = t; delete process.env.PAYPAL_ENV; }
  });
});

describe("hardening", () => {
  it("sends security headers and hides x-powered-by", async () => {
    const r = await api("/api/health");
    expect(r.headers.get("x-powered-by")).toBeNull();
    expect(r.headers.get("content-security-policy")).toMatch(/script-src 'self'/);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("does not leak internal error details", async () => {
    pp.fn.mockImplementation(async () => { throw new Error("secret internal detail"); });
    const r = await api("/api/invoices");
    expect(r.status).toBe(500);
    expect(await r.text()).not.toMatch(/secret internal/);
  });
});
