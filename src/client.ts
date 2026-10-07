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

const DEFAULT_API_URL = "https://sentinel.thoughtproof.ai";
const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_TIER: VerificationTier = "standard";

/** Sentinel answered 402. Callers must fail closed; this is not an onError case. */
export class SentinelPaymentRequiredError extends Error {
  readonly status = 402 as const;

  constructor(detail: string) {
    super(`ThoughtProof API error 402: ${detail}`);
    this.name = "SentinelPaymentRequiredError";
  }
}

/** Denial produced when Sentinel demands payment. Never an allow. */
export function sentinelPaymentRequiredResult(error: SentinelPaymentRequiredError): VerificationResult {
  return {
    verdict: "DENY",
    confidence: 0,
    reasoning: error.message,
    verifiers: 0,
    chainHash: "",
    auditUrl: "",
    durationMs: 0,
  };
}

export class ThoughtProofClient {
  private readonly apiUrl: string;
  private readonly apiKey?: string;
  private readonly tier: VerificationTier;
  private readonly timeout: number;

  constructor(config: ThoughtProofConfig = {}) {
    this.apiUrl = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.tier = config.tier ?? DEFAULT_TIER;
    if (!["checkpoint", "standard"].includes(this.tier)) throw new Error("Unsupported Sentinel tier");
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
        headers["X-Sentinel-Key"] = this.apiKey;
      }

      const payload = {
        claim: buildClaim(context),
        tier: this.tier,
        mode: "action_authorization",
        evidence: JSON.stringify({
          source: "x402-middleware",
          supportingEvidence: context.evidence ?? "No independent supporting evidence supplied.",
          // These fields are unverified client declarations, not a principal mandate.
          clientDeclared: { agent: context.agentAddress, resource: context.resource,
            method: context.method, amount: context.amount, amountUnit: context.amountUnit,
            network: context.network, asset: context.token, recipient: context.recipient, body: context.body },
        }),
      };

      const response = await fetch(`${this.apiUrl}/sentinel/verify`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.status === 402) {
        const text = await response.text().catch(() => "unknown error");
        throw new SentinelPaymentRequiredError(text);
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "unknown error");
        throw new Error(`ThoughtProof API error ${response.status}: ${text}`);
      }

      const data = await response.json() as Record<string, unknown>;

      const verdict: VerificationResult["verdict"] = data.verdict === "ALLOW" ? "APPROVE"
        : data.verdict === "BLOCK" ? "DENY" : "UNCERTAIN";
      const meta = data.meta && typeof data.meta === "object" ? data.meta as Record<string, unknown> : {};
      const objections = Array.isArray(data.objections)
        ? data.objections.filter((o): o is Record<string, unknown> => !!o && typeof o === "object" && !Array.isArray(o)) : [];
      return {
        id: typeof data.id === "string" ? data.id : undefined,
        verdict,
        confidence: typeof data.confidence === "number" && Number.isFinite(data.confidence) && data.confidence >= 0 && data.confidence <= 1 ? data.confidence : 0,
        reasoning: typeof data.reasoning === "string" ? data.reasoning
          : objections.map(o => typeof o.reasoning === "string" ? o.reasoning : "").filter(Boolean).join("; "),
        objections,
        verifiers: Array.isArray(meta.models_used) ? meta.models_used.length : 0,
        // OpenAPI does not promise a chain hash or audit URL; never fabricate them from id.
        chainHash: "",
        auditUrl: "",
        durationMs: typeof meta.duration_ms === "number" ? meta.duration_ms : 0,
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
