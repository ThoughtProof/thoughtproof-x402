/**
 * Example: Cloudflare Worker with ThoughtProof x402 verification
 *
 * Framework-agnostic usage — works with any runtime that
 * supports the Web Fetch API (Cloudflare Workers, Bun, Deno).
 */

import { verifyPayment } from "thoughtproof-x402";

export default {
  async fetch(request: Request, env: { THOUGHTPROOF_KEY: string }): Promise<Response> {
    const url = new URL(request.url);

    // Health check — no verification needed
    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    // ─── Verify agent reasoning ───────────────────────────
    const verification = await verifyPayment(request, {
      thoughtproof: {
        apiKey: env.THOUGHTPROOF_KEY,
        tier: "fast",
        confidenceThreshold: 0.7,
      },
      policy: {
        onUncertain: "deny",
        onError: "allow",
      },
    });

    // Denied — return verification details
    if (!verification.allowed) {
      return Response.json(
        {
          error: "verification_denied",
          verdict: verification.result?.verdict,
          confidence: verification.result?.confidence,
          reasoning: verification.result?.reasoning,
          auditUrl: verification.result?.auditUrl,
        },
        { status: 403 }
      );
    }

    // ─── Serve verified resource ──────────────────────────
    const data = Response.json({
      weather: { temperature: 22, conditions: "sunny" },
      verified: !verification.skipped,
    });

    // Add attestation headers to response
    for (const [key, value] of Object.entries(verification.headers)) {
      data.headers.set(key, value as string);
    }

    return data;
  },
};
