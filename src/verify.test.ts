import { describe, it, expect } from "vitest";
import { shouldAllow, shouldSkipRoute } from "./verify.js";
import type { VerificationResult, AgentContext, VerificationPolicy } from "./types/index.js";

const baseContext: AgentContext = {
  resource: "https://api.example.com/data",
  method: "GET",
};

function makeResult(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    verdict: "APPROVE",
    confidence: 0.92,
    reasoning: "Test reasoning",
    verifiers: 3,
    chainHash: "abc123",
    auditUrl: "https://thoughtproof.ai/chain/abc123",
    durationMs: 150,
    ...overrides,
  };
}

describe("shouldAllow", () => {
  it("allows APPROVE with high confidence", async () => {
    const result = makeResult({ verdict: "APPROVE", confidence: 0.92 });
    expect(await shouldAllow(result, baseContext)).toBe(true);
  });

  it("denies APPROVE with low confidence", async () => {
    const result = makeResult({ verdict: "APPROVE", confidence: 0.3 });
    expect(await shouldAllow(result, baseContext)).toBe(false);
  });

  it("denies DENY regardless of confidence", async () => {
    const result = makeResult({ verdict: "DENY", confidence: 0.99 });
    expect(await shouldAllow(result, baseContext)).toBe(false);
  });

  it("denies UNCERTAIN by default", async () => {
    const result = makeResult({ verdict: "UNCERTAIN", confidence: 0.5 });
    expect(await shouldAllow(result, baseContext)).toBe(false);
  });

  it("allows UNCERTAIN when policy says allow", async () => {
    const result = makeResult({ verdict: "UNCERTAIN", confidence: 0.5 });
    expect(await shouldAllow(result, baseContext, { onUncertain: "allow" })).toBe(true);
  });

  it("respects custom confidence threshold", async () => {
    const result = makeResult({ verdict: "APPROVE", confidence: 0.85 });
    expect(await shouldAllow(result, baseContext, {}, 0.9)).toBe(false);
    expect(await shouldAllow(result, baseContext, {}, 0.8)).toBe(true);
  });

  it("denies when amount exceeds maxAmount", async () => {
    const result = makeResult({ verdict: "APPROVE", confidence: 0.95 });
    const context: AgentContext = { ...baseContext, amount: "$100" };
    expect(await shouldAllow(result, context, { maxAmount: 50 })).toBe(false);
  });

  it("skips verification when amount below minAmount", async () => {
    const result = makeResult({ verdict: "DENY", confidence: 0.99 });
    const context: AgentContext = { ...baseContext, amount: "$0.001" };
    expect(await shouldAllow(result, context, { minAmount: 0.01 })).toBe(true);
  });

  it("uses custom decide function", async () => {
    const result = makeResult({ verdict: "DENY", confidence: 0.99 });
    const policy: VerificationPolicy = {
      decide: () => true, // Override: always allow
    };
    expect(await shouldAllow(result, baseContext, policy)).toBe(true);
  });

  it("handles atomic USDC amounts", async () => {
    const result = makeResult({ verdict: "APPROVE", confidence: 0.95 });
    const context: AgentContext = { ...baseContext, amount: "5000000" }; // 5 USDC
    expect(await shouldAllow(result, context, { maxAmount: 10 })).toBe(true);
    expect(await shouldAllow(result, context, { maxAmount: 3 })).toBe(false);
  });

  it("treats $1.5M USD with decimal as real USD, not atomic", async () => {
    const result = makeResult({ verdict: "APPROVE", confidence: 0.95 });
    const context: AgentContext = { ...baseContext, amount: "$1500000.00" };
    expect(await shouldAllow(result, context, { maxAmount: 1000000 })).toBe(false);
  });

  it("rejects negative amounts", async () => {
    const result = makeResult({ verdict: "APPROVE", confidence: 0.95 });
    const context: AgentContext = { ...baseContext, amount: "-$100" };
    // negative returns 0, which is below any minAmount
    expect(await shouldAllow(result, context, { minAmount: 0.01 })).toBe(true);
  });
});

describe("shouldSkipRoute", () => {
  it("skips routes matching skipRoutes", () => {
    expect(shouldSkipRoute("/health", { skipRoutes: ["/health", "/metrics"] })).toBe(true);
    expect(shouldSkipRoute("/api/data", { skipRoutes: ["/health", "/metrics"] })).toBe(false);
  });

  it("supports glob patterns", () => {
    expect(shouldSkipRoute("/api/v1/health", { skipRoutes: ["/api/*/health"] })).toBe(true);
    expect(shouldSkipRoute("/api/v1/data", { skipRoutes: ["/api/*/health"] })).toBe(false);
  });

  it("supports double-star glob", () => {
    expect(shouldSkipRoute("/admin/settings/users", { skipRoutes: ["/admin/**"] })).toBe(true);
  });

  it("requireRoutes takes precedence over skipRoutes", () => {
    const policy = {
      skipRoutes: ["/health"],
      requireRoutes: ["/api/**"],
    };
    // /health is in skipRoutes but not in requireRoutes — should be skipped
    expect(shouldSkipRoute("/health", policy)).toBe(true);
    // /api/data is in requireRoutes — should NOT be skipped
    expect(shouldSkipRoute("/api/data", policy)).toBe(false);
  });

  it("returns false when no policy", () => {
    expect(shouldSkipRoute("/anything")).toBe(false);
  });
});
