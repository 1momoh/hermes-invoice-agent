import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakePayPal, inv } from "./helpers.js";

beforeEach(() => { process.env.PAYPAL_CLIENT_ID = "id"; process.env.PAYPAL_CLIENT_SECRET = "secret"; });
afterEach(() => vi.unstubAllGlobals());

describe("listInvoices pagination", () => {
  it("reads every page past the 100-per-page limit", async () => {
    const all = Array.from({ length: 237 }, (_, i) => inv(i + 1, "a@example.com", i % 2 ? "PAID" : "SENT"));
    const pp = fakePayPal(all); vi.stubGlobal("fetch", pp.fn);
    const P = await import("../src/paypal.js");
    const list = await P.listInvoices();
    expect(list).toHaveLength(237);
    expect(pp.calls.filter((c) => c.url.startsWith("/v2/invoicing/invoices?")).map((c) => new URLSearchParams(c.url.split("?")[1]).get("page"))).toEqual(["1", "2", "3"]);
    const cf = await P.cashflow();
    expect(cf.count).toBe(237);
    expect(cf.outstanding_usd).toBe((119 * 10).toFixed(2));
  });
  it("stops on an empty first page", async () => {
    const pp = fakePayPal([]); vi.stubGlobal("fetch", pp.fn);
    const P = await import("../src/paypal.js");
    expect(await P.listInvoices()).toEqual([]);
  });
  it("url-encodes and validates ids for cancel/remind", async () => {
    const pp = fakePayPal([inv(1)]); vi.stubGlobal("fetch", pp.fn);
    const P = await import("../src/paypal.js");
    await expect(P.cancel("../../v1/evil")).rejects.toThrow(/valid invoice/);
    await expect(P.remind("INV2-TEST/../x")).rejects.toThrow(/valid invoice/);
    expect(pp.calls.some((c) => c.url.includes("evil"))).toBe(false);
    await P.cancel("INV2-TEST-0001");
    expect(pp.calls.at(-1)!.url).toBe("/v2/invoicing/invoices/INV2-TEST-0001/cancel");
  });
});
