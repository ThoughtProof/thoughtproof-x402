import { describe, it, expect } from "vitest";
import { buildAttestationHeaders, parseAttestationHeaders } from "./headers.js";
import type { VerificationResult } from "./types/index.js";

const mockResult: VerificationResult = {
  verdict: "APPROVE",
  confidence: 0.92,
  reasoning: "Multi-model verification passed",
  verifiers: 3,
  chainHash: "sha256:abc123def456",
  auditUrl: "https://thoughtproof.ai/chain/abc123",
  durationMs: 247,
};

describe("buildAttestationHeaders", () => {
  it("builds all required headers", () => {
    const headers = buildAttestationHeaders(mockResult);

    expect(headers["X-ThoughtProof-Version"]).toBe("1");
    expect(headers["X-ThoughtProof-Verdict"]).toBe("APPROVE");
    expect(headers["X-ThoughtProof-Confidence"]).toBe("0.92");
    expect(headers["X-ThoughtProof-Chain-Hash"]).toBe("sha256:abc123def456");
    expect(headers["X-ThoughtProof-Verifiers"]).toBe("3");
    expect(headers["X-ThoughtProof-Audit-URL"]).toBe("https://thoughtproof.ai/chain/abc123");
    expect(headers["X-ThoughtProof-Duration-Ms"]).toBe("247");
    expect(headers["X-ThoughtProof-Timestamp"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("formats confidence to 2 decimal places", () => {
    const result = { ...mockResult, confidence: 0.8 };
    const headers = buildAttestationHeaders(result);
    expect(headers["X-ThoughtProof-Confidence"]).toBe("0.80");
  });
});

describe("parseAttestationHeaders", () => {
  it("parses lowercase headers", () => {
    const headers: Record<string, string> = {
      "x-thoughtproof-verdict": "APPROVE",
      "x-thoughtproof-confidence": "0.92",
      "x-thoughtproof-chain-hash": "sha256:abc",
      "x-thoughtproof-verifiers": "3",
      "x-thoughtproof-audit-url": "https://example.com/audit",
      "x-thoughtproof-duration-ms": "150",
    };

    const parsed = parseAttestationHeaders(headers);
    expect(parsed).not.toBeNull();
    expect(parsed?.verdict).toBe("APPROVE");
    expect(parsed?.confidence).toBe(0.92);
    expect(parsed?.verifiers).toBe(3);
  });

  it("parses PascalCase headers", () => {
    const headers: Record<string, string> = {
      "X-ThoughtProof-Verdict": "DENY",
      "X-ThoughtProof-Confidence": "0.15",
    };

    const parsed = parseAttestationHeaders(headers);
    expect(parsed?.verdict).toBe("DENY");
    expect(parsed?.confidence).toBe(0.15);
  });

  it("returns null when no verdict header", () => {
    const parsed = parseAttestationHeaders({ "content-type": "application/json" });
    expect(parsed).toBeNull();
  });
});
