/**
 * Framework-agnostic verification function.
 *
 * Use this when you're not on Express — Cloudflare Workers,
 * Bun, Deno, Fastify, or any custom server.
 *
 * @example
 * ```typescript
 * import { verifyPayment } from "thoughtproof-x402";
 *
 * // In a Cloudflare Worker
 * export default {
 *   async fetch(request: Request): Promise<Response> {
 *     const verification = await verifyPayment(request, {
 *       thoughtproof: { apiKey: "tp_..." },
 *     });
 *
 *     if (!verification.allowed) {
 *       return new Response(JSON.stringify(verification.result), {
 *         status: 403,
 *         headers: { "Content-Type": "application/json" },
 *       });
 *     }
 *
 *     // Payment verified — serve the resource
 *     const response = new Response(JSON.stringify({ data: "verified" }));
 *
 *     // Add attestation headers
 *     for (const [key, value] of Object.entries(verification.headers)) {
 *       response.headers.set(key, value);
 *     }
 *
 *     return response;
 *   }
 * };
 * ```
 */

import { ThoughtProofClient } from "../client.js";
import { buildAttestationHeaders } from "../headers.js";
import { shouldAllow, shouldSkipRoute } from "../verify.js";
import type {
  VerifyPaymentOptions,
  AgentContext,
  VerificationResult,
  AttestationHeaders,
} from "../types/index.js";

export interface VerifyPaymentResult {
  /** Whether the payment should be allowed */
  allowed: boolean;
  /** Full verification result (null if skipped) */
  result: VerificationResult | null;
  /** Attestation headers to add to the response (empty if denied/skipped) */
  headers: Partial<AttestationHeaders>;
  /** Whether verification was skipped (no payment header, excluded route, etc.) */
  skipped: boolean;
}

/**
 * Verify a payment request — framework-agnostic.
 *
 * Accepts a standard Request object (Web API / Cloudflare Workers / Deno)
 * or a plain object with the required fields.
 */
export async function verifyPayment(
  request: Request | AgentContext,
  options: VerifyPaymentOptions
): Promise<VerifyPaymentResult> {
  const client = new ThoughtProofClient(options.thoughtproof);
  const policy = options.policy ?? {};
  const confidenceThreshold = options.thoughtproof.confidenceThreshold ?? 0.7;

  // Build context from Request or use directly
  const context: AgentContext = isRequest(request)
    ? await contextFromRequest(request)
    : request;

  // Skip if no payment signal
  if (!hasPaymentSignal(context)) {
    return { allowed: true, result: null, headers: {}, skipped: true };
  }

  // Skip excluded routes
  const path = new URL(context.resource, "http://localhost").pathname;
  if (shouldSkipRoute(path, policy)) {
    return { allowed: true, result: null, headers: {}, skipped: true };
  }

  // Pre-verify hook
  if (options.onBeforeVerify) {
    const proceed = await options.onBeforeVerify(context);
    if (!proceed) {
      return { allowed: true, result: null, headers: {}, skipped: true };
    }
  }

  let result: VerificationResult;

  try {
    result = await client.verify(context);
  } catch (error) {
    if (policy.onError === "deny") {
      return {
        allowed: false,
        result: {
          verdict: "DENY",
          confidence: 0,
          reasoning: `Verification error: ${error instanceof Error ? error.message : "unknown"}`,
          verifiers: 0,
          chainHash: "",
          auditUrl: "",
          durationMs: 0,
        },
        headers: {},
        skipped: false,
      };
    }
    return { allowed: true, result: null, headers: {}, skipped: false };
  }

  // Post-verify hook
  if (options.onAfterVerify) {
    await options.onAfterVerify(result, context);
  }

  const allowed = await shouldAllow(result, context, policy, confidenceThreshold);

  if (allowed) {
    return {
      allowed: true,
      result,
      headers: buildAttestationHeaders(result),
      skipped: false,
    };
  }

  // Denied
  if (options.onDeny) {
    await options.onDeny(result, context);
  }

  return { allowed: false, result, headers: {}, skipped: false };
}

// --- Helpers ---

function isRequest(obj: unknown): obj is Request {
  return typeof obj === "object" && obj !== null && "url" in obj && "method" in obj && typeof (obj as Request).headers?.get === "function";
}

async function contextFromRequest(request: Request): Promise<AgentContext> {
  let body: unknown = undefined;

  if (["POST", "PUT", "PATCH"].includes(request.method)) {
    try {
      body = await request.clone().json();
    } catch {
      // Not JSON — skip body
    }
  }

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    resource: request.url,
    method: request.method,
    body,
    headers,
    agentAddress: extractAgentFromHeaders(headers),
  };
}

function hasPaymentSignal(context: AgentContext): boolean {
  if (!context.headers) return false;
  return !!(
    context.headers["x-payment"] ??
    context.headers["payment"] ??
    context.headers["X-Payment"] ??
    context.headers["Payment"]
  );
}

function extractAgentFromHeaders(headers: Record<string, string>): string | undefined {
  // x402 payment header contains signed payment — extract signer address
  // This is a simplification; real implementation would verify the signature
  const payment = headers["x-payment"] ?? headers["payment"];
  if (!payment) return undefined;

  try {
    const parsed = JSON.parse(payment);
    return parsed.from ?? parsed.signer ?? parsed.address;
  } catch {
    return undefined;
  }
}
