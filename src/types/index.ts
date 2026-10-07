/**
 * ThoughtProof x402 — Pre-settlement reasoning verification types
 */

/** Verification verdict */
export type Verdict = "APPROVE" | "DENY" | "UNCERTAIN";

/** Verification tier — controls depth and cost */
export type VerificationTier = "checkpoint" | "standard";

/** ThoughtProof verification result */
export interface VerificationResult {
  /** Sentinel verification receipt ID, distinct from any cryptographic hash. */
  id?: string;
  objections?: Record<string, unknown>[];
  /** Pass/fail/uncertain verdict */
  verdict: Verdict;
  /** Confidence score 0-1 */
  confidence: number;
  /** Human-readable reasoning summary */
  reasoning: string;
  /** Number of models that evaluated */
  verifiers: number;
  /** Unique chain hash for audit trail */
  chainHash: string;
  /** Audit URL for the full verification trace */
  auditUrl: string;
  /** Verification duration in milliseconds */
  durationMs: number;
}

/** Agent context extracted from x402 payment request */
export interface AgentContext {
  paymentVersion?: 1 | 2;
  amountUnit?: "atomic" | "usd";
  recipient?: string;
  /** Trusted application-provided supporting evidence. */
  evidence?: string;
  /** The agent's wallet address (from payment signature) */
  agentAddress?: string;
  /** The resource being requested */
  resource: string;
  /** HTTP method */
  method: string;
  /** Payment amount; decoded x402 amounts are atomic token units (see amountUnit) */
  amount?: string;
  /** Payment token address */
  token?: string;
  /** Payment network (CAIP-2 format, e.g. "eip155:8453") */
  network?: string;
  /** Request body (for POST/PUT — the agent's reasoning input) */
  body?: unknown;
  /** Request headers */
  headers?: Record<string, string>;
}

/** Configuration for the ThoughtProof verification client */
export interface ThoughtProofConfig {
  /** ThoughtProof API endpoint (default: https://sentinel.thoughtproof.ai) */
  apiUrl?: string;
  /** Sentinel API key. This client does not fund backend x402 challenges. */
  apiKey?: string;
  /** Verification tier (default: "standard") */
  tier?: VerificationTier;
  /** Minimum confidence threshold to APPROVE (default: 0.7) */
  confidenceThreshold?: number;
  /** Timeout in milliseconds (default: 10000) */
  timeout?: number;
}

/** Policy configuration for payment verification */
export interface VerificationPolicy {
  /** Minimum payment amount (in USD) that triggers verification (default: 0) */
  minAmount?: number;
  /** Maximum payment amount (in USD) — payments above this are always DENY (default: Infinity) */
  maxAmount?: number;
  /** Routes to skip verification for (glob patterns) */
  skipRoutes?: string[];
  /** Routes that always require verification (glob patterns) */
  requireRoutes?: string[];
  /** Action on UNCERTAIN verdict: "allow" | "deny" (default: "deny") */
  onUncertain?: "allow" | "deny";
  /** Action on verification timeout/error: "allow" | "deny" (default: "allow") */
  onError?: "allow" | "deny";
  /** Custom decision function — overrides default policy */
  decide?: (result: VerificationResult, context: AgentContext) => boolean | Promise<boolean>;
}

/** Full middleware options */
export interface VerifyPaymentOptions {
  /** Explicit legacy X-PAYMENT/payment compatibility. Default false. */
  allowV1?: boolean;
  /** ThoughtProof client configuration */
  thoughtproof: ThoughtProofConfig;
  /** Verification policy */
  policy?: VerificationPolicy;
  /** Called before verification — return false to skip */
  onBeforeVerify?: (context: AgentContext) => boolean | Promise<boolean>;
  /** Called after verification with the result */
  onAfterVerify?: (result: VerificationResult, context: AgentContext) => void | Promise<void>;
  /** Called when verification denies a payment */
  onDeny?: (result: VerificationResult, context: AgentContext) => void | Promise<void>;
}

/** x402 attestation headers added to successful responses */
export interface AttestationHeaders {
  "X-ThoughtProof-Version": string;
  "X-ThoughtProof-Verdict": Verdict;
  "X-ThoughtProof-Confidence": string;
  "X-ThoughtProof-Chain-Hash": string;
  "X-ThoughtProof-Verifiers": string;
  "X-ThoughtProof-Audit-URL": string;
  "X-ThoughtProof-Duration-Ms": string;
  "X-ThoughtProof-Timestamp": string;
}
