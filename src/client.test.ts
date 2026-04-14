import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ThoughtProofClient } from "./client.js";
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
        verdict: "APPROVE",
        confidence: 0.92,
        objections: [],
        durationMs: 100,
        modelCount: 3,
        mdi: 1,
        verificationProfile: "fast",
      }),
    });

    const client = new ThoughtProofClient({
      apiKey: "test-key",
      tier: "fast",
    });

    const result = await client.verify(mockContext);

    expect(result.verdict).toBe("APPROVE");
    expect(result.confidence).toBe(0.92);
    expect(result.verifiers).toBe(3);

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("https://api.thoughtproof.ai/v1/check");

    const fetchOpts = fetchCall[1];
    expect(fetchOpts.method).toBe("POST");
    expect(JSON.parse(fetchOpts.body).tier).toBe("fast");
    expect(fetchOpts.headers["X-API-Key"]).toBe("test-key");
  });

  it("uses custom API URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ verdict: "APPROVE", confidence: 0.9 }),
    });

    const client = new ThoughtProofClient({
      apiUrl: "https://custom.api.com/",
    });

    await client.verify(mockContext);

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(url).toBe("https://custom.api.com/v1/check");
  });

  it("handles 402 response gracefully", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
    });

    const client = new ThoughtProofClient();
    const result = await client.verify(mockContext);

    expect(result.verdict).toBe("UNCERTAIN");
    expect(result.confidence).toBe(0);
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
      json: async () => ({ verdict: "APPROVE", confidence: 0.9 }),
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
      json: async () => ({ verdict: "approve" }), // lowercase, missing fields
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
        verdict: "DENY",
        confidence: 0.3,
        objections: ["Claim is ungrounded", "Price seems inflated"],
        modelCount: 2,
        durationMs: 500,
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
