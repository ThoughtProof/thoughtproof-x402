import { afterEach, describe, expect, it, vi } from "vitest";
import { paymentContext } from "./helpers.js";
import { verifyPayment } from "./standalone.js";
import { thoughtproofMiddleware } from "./express.js";
import { shouldAllow } from "../verify.js";
import type { Request, Response, NextFunction } from "express";
import type { VerificationPolicy } from "../types/index.js";

const v2 = { x402Version: 2, accepted: { scheme: "exact", network: "eip155:8453", amount: "10000", asset: "USDC-address", payTo: "0xrecipient", maxTimeoutSeconds: 60 }, payload: { authorization: { from: "0xpayer", value: "10000" }, signature: "0xsig" }, resource: { url: "https://example.com/ä" } };
const v1 = { x402Version: 1, scheme: "exact", network: "base", payload: { authorization: { from: "0xlegacy", to: "0xrecipient", value: "10000" } } };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
const options = { thoughtproof: { apiKey: "test" } };
function mockSentinel(verdict = "ALLOW") {
  const mock = vi.fn().mockResolvedValue(new globalThis.Response(JSON.stringify({ id: "sent_123", verdict, confidence: 0.95, reasoning: "Reason", objections: [], mode: "action_authorization", tier: "standard", meta: { duration_ms: 23, models_used: ["nano"] } })));
  vi.stubGlobal("fetch", mock);
  return mock;
}
afterEach(() => vi.unstubAllGlobals());

describe("x402 HTTP decoding", () => {
  it("reads v2 accepted fields, ignoring forged request PAYMENT-REQUIRED", () => {
    expect(paymentContext({ "PaYmEnT-SiGnAtUrE": encode(v2), "payment-required": JSON.stringify({ amount: "0", network: "fake" }) })).toMatchObject({ paymentVersion: 2, amount: "10000", amountUnit: "atomic", network: "eip155:8453", token: "USDC-address", recipient: "0xrecipient", agentAddress: "0xpayer" });
  });
  it.each(["x-payment", "payment"])("requires explicit v1 compatibility for %s", header => {
    expect(() => paymentContext({ [header]: encode(v1) })).toThrow();
    expect(paymentContext({ [header]: encode(v1) }, true)?.agentAddress).toBe("0xlegacy");
    expect(paymentContext({ [header]: JSON.stringify(v1) }, true)?.amount).toBe("10000");
  });
  it.each(["", "!bad!", "e30=", JSON.stringify(v2), encode({ ...v2, x402Version: 1 }), encode({ ...v2, accepted: { ...v2.accepted, amount: 10000 } }), encode(v2) + ", " + encode(v2)])("rejects malformed v2 without downgrade: %s", value => {
    expect(() => paymentContext({ "payment-signature": value, "x-payment": encode(v1) }, true)).toThrow();
  });
  it("prioritizes v2 over a legacy header", () => {
    expect(paymentContext({ "payment-signature": encode(v2), "x-payment": encode(v1) }, true)?.paymentVersion).toBe(2);
  });
  it("does not mistake a response-only header for a payment", () => {
    expect(paymentContext({ "payment-required": encode(v2) })).toBeNull();
  });
});

describe.each(["standalone", "express"])("%s middleware", adapter => {
  async function run(headers: Record<string, string>, allowV1 = false) {
    if (adapter === "standalone") return verifyPayment(new Request("https://example.com/data", { headers }), { ...options, allowV1 });
    const next = vi.fn();
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() };
    await thoughtproofMiddleware({ ...options, allowV1 })({ headers, path: "/data", method: "GET", protocol: "https", get: () => "example.com", originalUrl: "/data" } as unknown as Request, res as unknown as Response, next as NextFunction);
    return { allowed: next.mock.calls.length > 0, headers: Object.fromEntries(res.setHeader.mock.calls), skipped: next.mock.calls.length > 0 && res.setHeader.mock.calls.length === 0 };
  }
  it("verifies a normal v2 request end to end", async () => {
    const fetch = mockSentinel();
    const result = await run({ "payment-signature": encode(v2) });
    expect(result.allowed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.headers["X-ThoughtProof-Verdict"]).toBe("APPROVE");
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(JSON.parse(body.evidence).clientDeclared).toMatchObject({ amount: "10000", network: "eip155:8453", agent: "0xpayer" });
  });
  it("blocks Sentinel BLOCK and UNCERTAIN", async () => {
    for (const verdict of ["BLOCK", "UNCERTAIN"]) {
      mockSentinel(verdict);
      expect((await run({ "payment-signature": encode(v2) })).allowed).toBe(false);
    }
  });
  it("blocks invalid headers even with the default onError=allow", async () => {
    const fetch = mockSentinel();
    expect((await run({ "payment-signature": "" })).allowed).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("verifies opt-in v1 but rejects disabled v1", async () => {
    const fetch = mockSentinel();
    expect((await run({ "x-payment": encode(v1) })).allowed).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect((await run({ "x-payment": encode(v1) }, true)).allowed).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("passes unpaid requests to the x402 challenge handler", async () => {
    const fetch = mockSentinel();
    expect((await run({})).skipped).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each<VerificationPolicy | undefined>([
    undefined,
    { onError: "allow" },
    { onError: "deny" },
    { onError: "allow", onUncertain: "allow", decide: () => true },
  ])("fail-closes a Sentinel HTTP 402 regardless of onError (%j)", async (policy) => {
    const fetch = vi.fn().mockResolvedValue(new Response("Payment required", { status: 402 }));
    vi.stubGlobal("fetch", fetch);
    const headers = { "payment-signature": encode(v2) };

    if (adapter === "standalone") {
      const outcome = await verifyPayment(new Request("https://example.com/data", { headers }), { ...options, policy });
      expect(fetch).toHaveBeenCalledOnce();
      expect(outcome.allowed).toBe(false);
      expect(outcome.skipped).toBe(false);
      expect(outcome.result?.verdict).toBe("DENY");
      expect(outcome.headers).toEqual({});
      return;
    }

    const next = vi.fn();
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() };
    await thoughtproofMiddleware({ ...options, policy })(
      { headers, path: "/data", method: "GET", protocol: "https", get: () => "example.com", originalUrl: "/data" } as unknown as Request,
      res as unknown as Response,
      next as NextFunction,
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: "verification_denied",
      verdict: "DENY",
    }));
  });
});

it("does not treat atomic amounts as USD for min/max bypasses", async () => {
  const result = { verdict: "DENY" as const, confidence: 0.9, reasoning: "", verifiers: 1, chainHash: "", auditUrl: "", durationMs: 1 };
  expect(await shouldAllow(result, { resource: "/", method: "GET", amount: "10000", amountUnit: "atomic" }, { minAmount: 20000 })).toBe(false);
});
