/**
 * Example: Express server with ThoughtProof x402 verification
 *
 * This shows how to add pre-settlement reasoning verification
 * to an x402-protected API. ThoughtProof verifies the agent's
 * reasoning BEFORE the payment settles.
 *
 * Run: npx tsx examples/express-server.ts
 */

import express from "express";
// import { paymentMiddleware } from "@x402/express";
import { thoughtproofMiddleware } from "thoughtproof-x402/express";

const app = express();
app.use(express.json());

// ─── ThoughtProof Middleware ───────────────────────────────
// Verifies agent reasoning before x402 payment settles.
// Place BEFORE x402 paymentMiddleware in the chain.

app.use(
  thoughtproofMiddleware({
    thoughtproof: {
      apiKey: process.env.THOUGHTPROOF_KEY,
      tier: "fast", // fast ($0.008) | standard ($0.02) | deep ($0.08)
      confidenceThreshold: 0.7,
      timeout: 10_000,
    },
    policy: {
      minAmount: 0.01, // Skip verification for payments under $0.01
      maxAmount: 1000, // Auto-deny payments over $1000
      onUncertain: "deny", // Deny uncertain verdicts
      onError: "allow", // Allow if ThoughtProof is unreachable
      skipRoutes: ["/health", "/metrics"],
    },
    onAfterVerify: (result, context) => {
      console.log(
        `[ThoughtProof] ${result.verdict} (${result.confidence}) for ${context.method} ${context.resource}`
      );
    },
    onDeny: (result, context) => {
      console.warn(
        `[ThoughtProof] DENIED: ${context.agentAddress} — ${result.reasoning}`
      );
    },
  })
);

// ─── x402 Payment Middleware ──────────────────────────────
// Uncomment when using @x402/express:
//
// app.use(paymentMiddleware({
//   "GET /api/weather": {
//     accepts: [{ scheme: "exact", price: "$0.01", network: "eip155:8453", payTo: "0x..." }],
//     description: "Weather data API",
//   },
// }, server));

// ─── Routes ───────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/weather", (_req, res) => {
  // If we get here, both ThoughtProof and x402 have approved
  res.json({
    temperature: 22,
    conditions: "sunny",
    verified: true,
  });
});

app.post("/api/analyze", (req, res) => {
  // Agent sends reasoning in the body — ThoughtProof verifies it
  res.json({
    analysis: "completed",
    input: req.body,
    verified: true,
  });
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
  console.log("ThoughtProof x402 verification active");
});
