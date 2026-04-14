/**
 * Express middleware for ThoughtProof x402 verification.
 *
 * Drop-in middleware that intercepts x402 payment flows and verifies
 * agent reasoning before settlement. Works alongside @x402/express
 * or any x402 server implementation.
 *
 * @example
 * ```typescript
 * import express from "express";
 * import { paymentMiddleware } from "@x402/express";
 * import { thoughtproofMiddleware } from "thoughtproof-x402/express";
 *
 * const app = express();
 *
 * // 1. ThoughtProof verifies reasoning FIRST
 * app.use(thoughtproofMiddleware({
 *   thoughtproof: { apiKey: process.env.THOUGHTPROOF_KEY },
 *   policy: { onUncertain: "deny" }
 * }));
 *
 * // 2. x402 handles payment SECOND
 * app.use(paymentMiddleware({ ... }));
 *
 * // 3. Your protected route
 * app.get("/api/data", (req, res) => res.json({ data: "verified" }));
 * ```
 */

import type { Request, Response, NextFunction } from "express";
import { ThoughtProofClient } from "../client.js";
import { buildAttestationHeaders } from "../headers.js";
import { shouldAllow, shouldSkipRoute } from "../verify.js";
import { extractAgentAddress, extractAmount, extractNetwork, normalizeHeaders } from "./helpers.js";
import type {
  VerifyPaymentOptions,
  AgentContext,
  VerificationResult,
} from "../types/index.js";

/**
 * Express middleware that verifies agent reasoning before x402 payment.
 *
 * Place this BEFORE your x402 paymentMiddleware in the middleware chain.
 * Denied requests get a 403 with verification details.
 * Approved requests get attestation headers added to the response.
 */
export function thoughtproofMiddleware(options: VerifyPaymentOptions) {
  const client = new ThoughtProofClient(options.thoughtproof);
  const policy = options.policy ?? {};
  const confidenceThreshold = options.thoughtproof.confidenceThreshold ?? 0.7;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Skip non-payment requests (no x402 payment header)
    const paymentHeader = req.headers["x-payment"] ?? req.headers["payment"];
    if (!paymentHeader) {
      next();
      return;
    }

    // Skip routes excluded by policy
    if (shouldSkipRoute(req.path, policy)) {
      next();
      return;
    }

    // Build agent context from request
    const context: AgentContext = {
      resource: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
      method: req.method,
      body: req.body,
      headers: normalizeHeaders(req.headers),
      agentAddress: extractAgentAddress(paymentHeader as string),
      amount: extractAmount(req),
      network: extractNetwork(req),
    };

    // Pre-verify hook
    if (options.onBeforeVerify) {
      const proceed = await options.onBeforeVerify(context);
      if (!proceed) {
        next();
        return;
      }
    }

    let result: VerificationResult;

    try {
      result = await client.verify(context);
    } catch (error) {
      // Verification failed — apply error policy
      if (policy.onError === "deny") {
        res.status(403).json({
          error: "verification_error",
          message: "ThoughtProof verification failed",
          detail: error instanceof Error ? error.message : "Unknown error",
        });
        return;
      }
      // onError === "allow" (default) — let the payment proceed
      next();
      return;
    }

    // Post-verify hook
    if (options.onAfterVerify) {
      await options.onAfterVerify(result, context);
    }

    // Decision
    const allowed = await shouldAllow(result, context, policy, confidenceThreshold);

    if (allowed) {
      // Add attestation headers to response
      const attestation = buildAttestationHeaders(result);
      for (const [key, value] of Object.entries(attestation)) {
        res.setHeader(key, value);
      }
      next();
    } else {
      // Deny — fire callback and return 403
      if (options.onDeny) {
        await options.onDeny(result, context);
      }

      res.status(403).json({
        error: "verification_denied",
        verdict: result.verdict,
        confidence: result.confidence,
        reasoning: result.reasoning,
        auditUrl: result.auditUrl,
        chainHash: result.chainHash,
      });
    }
  };
}
