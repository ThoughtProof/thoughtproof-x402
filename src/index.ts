/**
 * thoughtproof-x402
 *
 * Pre-settlement reasoning verification for x402 agent payments.
 *
 * Verifies AI agent decision quality before payment executes —
 * the missing verification layer between decide and settle.
 *
 * @example Express middleware
 * ```typescript
 * import { thoughtproofMiddleware } from "thoughtproof-x402/express";
 *
 * app.use(thoughtproofMiddleware({
 *   thoughtproof: { apiKey: "tp_..." },
 *   policy: { onUncertain: "deny" }
 * }));
 * ```
 *
 * @example Standalone (Cloudflare Workers, Bun, etc.)
 * ```typescript
 * import { verifyPayment } from "thoughtproof-x402";
 *
 * const result = await verifyPayment(request, {
 *   thoughtproof: { apiKey: "tp_..." },
 * });
 *
 * if (!result.allowed) {
 *   return new Response("Denied", { status: 403 });
 * }
 * ```
 */

// Core client
export { ThoughtProofClient } from "./client.js";

// Standalone verification (framework-agnostic)
export { verifyPayment } from "./middleware/standalone.js";
export type { VerifyPaymentResult } from "./middleware/standalone.js";

// Attestation headers
export { buildAttestationHeaders, parseAttestationHeaders } from "./headers.js";

// Types
export type {
  Verdict,
  VerificationTier,
  VerificationResult,
  AgentContext,
  ThoughtProofConfig,
  VerificationPolicy,
  VerifyPaymentOptions,
  AttestationHeaders,
} from "./types/index.js";
