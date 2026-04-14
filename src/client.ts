/**
 * ThoughtProof verification client
 *
 * Calls the ThoughtProof API to verify agent reasoning
 * before a payment settles.
 */

import type {
  ThoughtProofConfig,
  VerificationResult,
  VerificationTier,
  AgentContext,
} from "./types/index.js";

const DEFAULT_API_URL = "https://api.thoughtproof.ai";
const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_TIER: VerificationTier = "fast";

export class ThoughtProofClient {
  private readonly apiUrl: string;
  private readonly apiKey?: string;
  private readonly tier: VerificationTier;
  private readonly timeout: number;

  constructor(config: ThoughtProofConfig = {}) {
    this.apiUrl = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.tier = config.tier ?? DEFAULT_TIER;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
  }

  /**
   * Verify agent reasoning before payment settlement.
   *
   * Sends the agent's context (resource, method, body, payment info)
   * to ThoughtProof for multi-model adversarial verification.
   */
  async verify(context: AgentContext): Promise<VerificationResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "thoughtproof-x402/1.0.0",
      };

      if (this.apiKey) {
        headers["X-API-Key"] = this.apiKey;
      }

      const payload = {
        claim: buildClaim(context),
        tier: this.tier,
        context: {
          source: "x402-middleware",
          agent: context.agentAddress,
          resource: context.resource,
          method: context.method,
          amount: context.amount,
          network: context.network,
        },
      };

      const response = await fetch(`${this.apiUrl}/v1/check`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.status === 402) {
        // ThoughtProof itself requires payment — pass through
        // This shouldn't happen if apiKey is set
        return {
          verdict: "UNCERTAIN",
          confidence: 0,
          reasoning: "ThoughtProof API requires payment — set an API key or fund the x402 payment.",
          verifiers: 0,
          chainHash: "",
          auditUrl: "",
          durationMs: 0,
        };
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "unknown error");
        throw new Error(`ThoughtProof API error ${response.status}: ${text}`);
      }

      const data = await response.json() as Record<string, unknown>;

      const rawVerdict = typeof data.verdict === "string" ? data.verdict.toUpperCase() : "";
      const validVerdicts = new Set(["APPROVE", "DENY", "UNCERTAIN"]);
      const verdict: VerificationResult["verdict"] = validVerdicts.has(rawVerdict)
        ? (rawVerdict as VerificationResult["verdict"])
        : "UNCERTAIN";

      return {
        verdict,
        confidence: typeof data.confidence === "number" ? data.confidence : 0,
        reasoning: typeof data.reasoning === "string" ? data.reasoning : "",
        verifiers: typeof data.verifiers === "number" ? data.verifiers : 0,
        chainHash: typeof data.chainHash === "string" ? data.chainHash : "",
        auditUrl: typeof data.auditUrl === "string" ? data.auditUrl : "",
        durationMs: typeof data.durationMs === "number" ? data.durationMs : 0,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`ThoughtProof verification timed out after ${this.timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Build a verification claim from agent context.
 *
 * The claim is what ThoughtProof evaluates — a natural language
 * description of what the agent is about to do and why.
 */
function buildClaim(context: AgentContext): string {
  const parts: string[] = [];

  parts.push(`Agent ${context.agentAddress ?? "unknown"} is requesting ${context.method} ${context.resource}`);

  if (context.amount) {
    parts.push(`Payment: ${context.amount}`);
  }

  if (context.network) {
    parts.push(`Network: ${context.network}`);
  }

  if (context.body && typeof context.body === "object") {
    // Extract any reasoning or intent from the request body
    const body = context.body as Record<string, unknown>;
    if (body.reasoning) parts.push(`Agent reasoning: ${body.reasoning}`);
    if (body.intent) parts.push(`Agent intent: ${body.intent}`);
    if (body.query) parts.push(`Query: ${body.query}`);
    if (body.prompt) parts.push(`Prompt: ${body.prompt}`);
  }

  return parts.join(". ") + ".";
}
