import { describe, expect, it } from "vitest";
import * as FX from "../src/fx.js";
import { validateInvoice } from "../src/security.js";

process.env.FX_MODE = "fixed";
describe("FX conversion", () => {
  it("converts local currency to USD at the fixed rate, rounded to cents", () => {
    process.env.NGN_PER_USD = "1500";
    const f = FX.convert(50000, "NGN");
    expect(f.usd).toBe(33.33); expect(f.source).toBe("fixed"); expect(f.rate).toBe(1500);
    expect(FX.convert(1000, "NGN").usd).toBe(0.67);
    expect(FX.convert(12.345, "USD").usd).toBe(12.35);
  });
  it("tiny local amounts round to $0.00 and are rejected", () => {
    const f = FX.convert(5, "NGN");
    expect(f.usd).toBe(0);
    expect(() => validateInvoice({ recipient_email: "a@example.com", amount: 5, due_date: "2099-01-01", description: "x" }, f.usd)).toThrow(/cent/);
  });
  it("validates amount, email and due date", () => {
    const ok = { recipient_email: "a@example.com", amount: 10, due_date: "2099-01-01", description: "Logo" };
    expect(() => validateInvoice(ok, 10)).not.toThrow();
    expect(() => validateInvoice({ ...ok, amount: -1 }, 10)).toThrow(/more than zero/);
    expect(() => validateInvoice({ ...ok, recipient_email: "nope" }, 10)).toThrow(/email/);
    expect(() => validateInvoice({ ...ok, due_date: "2020-01-01" }, 10)).toThrow(/past/);
    expect(() => validateInvoice({ ...ok, due_date: "2099-02-31" }, 10)).toThrow(/real date/);
    expect(() => validateInvoice(ok, 1e9)).toThrow(/limit/);
  });
});
