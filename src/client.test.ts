import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SentinelPaymentRequiredError, ThoughtProofClient } from "./client.js";
import type { AgentContext } from "./types/index.js";

const mockContext: AgentContext = {
  resource: "https://api.example.com/weather",
  method: "GET",
  agentAddress: "0x1234567890abcdef",
};

describe("ThoughtProofClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends correct request to ThoughtProof API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        verdict: "ALLOW",
        confidence: 0.92,
        objections: [],
        meta: { duration_ms: 100, models_used: ["a", "b", "c"] },
        mdi: 1,
        verificationProfile: "checkpoint",
      }),
    });

    const client = new ThoughtProofClient({
      apiKey: "test-key",
      tier: "checkpoint",
    });

    const result = await client.verify(mockContext);

    expect(result.verdict).toBe("APPROVE");
    expect(result.confidence).toBe(0.92);
    expect(result.verifiers).toBe(3);

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("https://sentinel.thoughtproof.ai/sentinel/verify");

    const fetchOpts = fetchCall[1];
    expect(fetchOpts.method).toBe("POST");
    expect(JSON.parse(fetchOpts.body).mode).toBe("action_authorization");
    expect(typeof JSON.parse(fetchOpts.body).evidence).toBe("string");
    expect(fetchOpts.headers["X-API-Key"]).toBeUndefined();
    expect(JSON.parse(fetchOpts.body).tier).toBe("checkpoint");
    expect(fetchOpts.headers["X-Sentinel-Key"]).toBe("test-key");
  });

  it("uses custom API URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ verdict: "ALLOW", confidence: 0.9 }),
    });

    const client = new ThoughtProofClient({
      apiUrl: "https://custom.api.com/",
    });

    await client.verify(mockContext);

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(url).toBe("https://custom.api.com/sentinel/verify");
  });

  it("handles 402 response gracefully", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      text: async () => "Payment required",
    });

    const client = new ThoughtProofClient();
    await expect(client.verify(mockContext)).rejects.toBeInstanceOf(SentinelPaymentRequiredError);
    await expect(client.verify(mockContext)).rejects.toThrow("ThoughtProof API error 402");
  });

  it("throws on API errors", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    const client = new ThoughtProofClient();
    await expect(client.verify(mockContext)).rejects.toThrow("ThoughtProof API error 500");
  });

  it("handles timeout", async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    const client = new ThoughtProofClient({ timeout: 50 });
    await expect(client.verify(mockContext)).rejects.toThrow("timed out");
  });

  it("builds claim from context with body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ verdict: "ALLOW", confidence: 0.9 }),
    });

    const client = new ThoughtProofClient();
    await client.verify({
      ...mockContext,
      body: { reasoning: "I need weather data for planning", intent: "weather_check" },
    });

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.claim).toContain("weather data for planning");
    expect(body.claim).toContain("weather_check");
  });

  it("handles missing fields in API response gracefully", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ verdict: "ALLOW" }), // lowercase, missing fields
    });

    const client = new ThoughtProofClient();
    const result = await client.verify(mockContext);

    expect(result.verdict).toBe("APPROVE");
    expect(result.confidence).toBe(0);
    expect(result.verifiers).toBe(0);
    expect(result.reasoning).toBe("");
  });

  it("maps unknown verdict strings to UNCERTAIN", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ verdict: "HOLD", confidence: 0.5 }), // old/invalid verdict
    });

    const client = new ThoughtProofClient();
    const result = await client.verify(mockContext);

    expect(result.verdict).toBe("UNCERTAIN");
  });

  it("maps objections array to reasoning string", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        verdict: "BLOCK",
        confidence: 0.3,
        objections: [{ reasoning: "Claim is ungrounded" }, { reasoning: "Price seems inflated" }],
        meta: { duration_ms: 500, models_used: ["a", "b"] },
      }),
    });

    const client = new ThoughtProofClient();
    const result = await client.verify(mockContext);

    expect(result.verdict).toBe("DENY");
    expect(result.reasoning).toBe("Claim is ungrounded; Price seems inflated");
    expect(result.verifiers).toBe(2);
  });

  it("maps null verdict to UNCERTAIN", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ verdict: null }),
    });

    const client = new ThoughtProofClient();
    const result = await client.verify(mockContext);

    expect(result.verdict).toBe("UNCERTAIN");
  });
});

describe("Sentinel contract edge cases", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([401, 402, 429, 503])("treats HTTP %s as an error, not a verdict", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unavailable", { status })));
    await expect(new ThoughtProofClient().verify(mockContext)).rejects.toThrow(`API error ${status}`);
  });
  it("preserves receipt and objections, without inventing an audit proof", async () => {
    const objections = [{ step_id: "0", criterion: "mandate", score: 0, predicate: "unsupported", reasoning: "Missing mandate" }];
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "sent_123", verdict: "BLOCK", confidence: 0.9, reasoning: "Blocked", objections, meta: { duration_ms: 42, models_used: ["nano", "swift"] } })));
    vi.stubGlobal("fetch", fetch);
    const result = await new ThoughtProofClient().verify({ ...mockContext, evidence: "server evidence", headers: { authorization: "secret", "payment-signature": "signature" } });
    expect(result).toMatchObject({ id: "sent_123", verdict: "DENY", objections, durationMs: 42, verifiers: 2, chainHash: "", auditUrl: "" });
    const body = fetch.mock.calls[0][1].body;
    expect(body).toContain("server evidence");
    expect(body).not.toContain("secret");
    expect(body).not.toContain("signature");
  });
  it("rejects removed tiers at runtime", () => {
    expect(() => new ThoughtProofClient({ tier: "fast" as never })).toThrow("Unsupported Sentinel tier");
  });
});
