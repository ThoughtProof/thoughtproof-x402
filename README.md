# thoughtproof-x402

Pre-settlement reasoning verification for x402 agent payments.

x402 moves the money. ThoughtProof verifies the reasoning.

## The Problem

x402 processes 119M+ transactions on Base alone. Every one settles without checking whether the agent's reasoning was sound. An agent with a valid wallet can make a catastrophic purchase decision — and the payment executes flawlessly.

**thoughtproof-x402** adds the missing verification step between *decide* and *settle*:

```
Agent decides → ThoughtProof verifies → x402 settles
```

## Quick Start

```bash
npm install thoughtproof-x402
```

### Express Middleware

Drop in before your x402 `paymentMiddleware`:

```typescript
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { thoughtproofMiddleware } from "thoughtproof-x402/express";

const app = express();

// 1. Verify reasoning
app.use(thoughtproofMiddleware({
  thoughtproof: { apiKey: process.env.THOUGHTPROOF_KEY },
  policy: { onUncertain: "deny" },
}));

// 2. Process payment
app.use(paymentMiddleware({ /* x402 config */ }));

// 3. Serve resource
app.get("/api/data", (req, res) => res.json({ data: "verified" }));
```

### Cloudflare Workers / Bun / Deno

Framework-agnostic — works with any Web Fetch API runtime:

```typescript
import { verifyPayment } from "thoughtproof-x402";

export default {
  async fetch(request: Request): Promise<Response> {
    const verification = await verifyPayment(request, {
      thoughtproof: { apiKey: "tp_..." },
    });

    if (!verification.allowed) {
      return new Response(JSON.stringify(verification.result), { status: 403 });
    }

    const response = Response.json({ data: "verified" });
    for (const [k, v] of Object.entries(verification.headers)) {
      response.headers.set(k, v as string);
    }
    return response;
  },
};
```

## How It Works

1. Agent sends a payment request (x402 `X-Payment` header)
2. **thoughtproof-x402** extracts the agent context (address, resource, amount, reasoning)
3. Sends to ThoughtProof API for multi-model adversarial verification
4. If **APPROVE** (confidence ≥ threshold): adds attestation headers, continues to x402
5. If **DENY** or **UNCERTAIN**: returns 403 with verification details

## Attestation Headers

Verified responses include proof headers that downstream consumers can audit:

```
X-ThoughtProof-Version: 1
X-ThoughtProof-Verdict: APPROVE
X-ThoughtProof-Confidence: 0.92
X-ThoughtProof-Chain-Hash: sha256:abc123...
X-ThoughtProof-Verifiers: 3
X-ThoughtProof-Audit-URL: https://thoughtproof.ai/chain/abc123
X-ThoughtProof-Duration-Ms: 247
X-ThoughtProof-Timestamp: 2026-04-14T21:00:00.000Z
```

Parse them on the client side:

```typescript
import { parseAttestationHeaders } from "thoughtproof-x402";

const proof = parseAttestationHeaders(response.headers);
console.log(proof?.verdict);    // "APPROVE"
console.log(proof?.confidence); // 0.92
console.log(proof?.auditUrl);   // Full verification trace
```

## Configuration

### ThoughtProof Client

| Option | Default | Description |
|--------|---------|-------------|
| `apiUrl` | `https://api.thoughtproof.ai` | API endpoint |
| `apiKey` | — | API key (optional — x402 payment also accepted) |
| `tier` | `"fast"` | `"fast"` ($0.008) · `"standard"` ($0.02) · `"deep"` ($0.08) |
| `confidenceThreshold` | `0.7` | Minimum confidence to APPROVE |
| `timeout` | `10000` | Request timeout in ms |

### Verification Policy

| Option | Default | Description |
|--------|---------|-------------|
| `minAmount` | `0` | Skip verification below this USD amount |
| `maxAmount` | `Infinity` | Auto-deny above this USD amount |
| `skipRoutes` | `[]` | Glob patterns to skip (e.g., `"/health"`, `"/api/*/public"`) |
| `requireRoutes` | `[]` | Only verify these routes (takes precedence) |
| `onUncertain` | `"deny"` | Action on UNCERTAIN: `"allow"` or `"deny"` |
| `onError` | `"allow"` | Action on timeout/error: `"allow"` or `"deny"` |
| `decide` | — | Custom function: `(result, context) => boolean` |

### Lifecycle Hooks

```typescript
thoughtproofMiddleware({
  thoughtproof: { apiKey: "..." },
  onBeforeVerify: (context) => {
    // Return false to skip verification for this request
    return context.agentAddress !== TRUSTED_AGENT;
  },
  onAfterVerify: (result, context) => {
    // Log, emit metrics, update dashboards
    metrics.record("verification", result.verdict, result.durationMs);
  },
  onDeny: (result, context) => {
    // Alert, audit log, notify admin
    alerting.send(`Denied ${context.agentAddress}: ${result.reasoning}`);
  },
});
```

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────┐     ┌──────────┐
│  AI Agent   │────▶│ thoughtproof-x402 │────▶│  x402   │────▶│ Resource │
│  (wallet)   │     │   verify reasoning │     │ payment │     │  Server  │
└─────────────┘     └──────────────────┘     └─────────┘     └──────────┘
                            │                       │
                            ▼                       ▼
                    ┌──────────────┐        ┌─────────────┐
                    │ ThoughtProof │        │  Base/ETH   │
                    │     API      │        │  Settlement │
                    └──────────────┘        └─────────────┘
```

**thoughtproof-x402** intercepts the payment flow at the decision layer — after the agent decides to pay, before the money moves.

## What ThoughtProof Verifies

- **Decision coherence**: Is the agent's stated reasoning internally consistent?
- **Grounding**: Are the claims in the reasoning backed by verifiable data?
- **Proportionality**: Is the payment amount proportional to the stated purpose?
- **Intent alignment**: Does the action match what the agent says it's trying to do?

This is not security (that's identity + permissions). This is not reputation (that's history). This is **epistemic verification** — checking whether the reasoning is actually sound.

## License

MIT

## Links

- [ThoughtProof](https://thoughtproof.ai) — Pre-execution verification for AI agents
- [x402 Protocol](https://x402.org) — HTTP-native agent payments
- [ERC-8183](https://eips.ethereum.org/EIPS/eip-8183) — Agentic Commerce Protocol
