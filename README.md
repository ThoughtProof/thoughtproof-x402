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

1. Agent sends a payment request (x402 v2 Base64 `PAYMENT-SIGNATURE` header)
2. **thoughtproof-x402** extracts the agent context (address, resource, amount, reasoning)
3. Sends to ThoughtProof API for multi-model adversarial verification
4. If **APPROVE** (confidence ≥ threshold): adds attestation headers, continues to x402
5. If **DENY** or **UNCERTAIN**: returns 403 with verification details

## Protocol and Sentinel migration

The default path is x402 v2. Both adapters decode Base64 UTF-8 JSON, read
`accepted.amount` (atomic units), `accepted.network`, `accepted.asset`, and
`accepted.payTo`, and extract EVM payer addresses from `payload.authorization.from`.
Other schemes can omit the payer address. Signature/settlement validation stays with
your x402 server; decoded fields are untrusted declarations.

`PAYMENT-REQUIRED` is a **402 response** header and is never used as request evidence.
Unpaid requests pass through so the x402 server can issue its challenge. Keep that
server in the chain: `allowed: true` here does not prove payment or settlement.

For legacy clients, explicitly set top-level `allowV1: true`. This enables
`X-PAYMENT` / `payment` with a version-1 envelope (Base64, or legacy raw JSON).
`PAYMENT-SIGNATURE` always takes precedence; invalid v2 never downgrades to v1.
Present but malformed, duplicate, empty, or disabled legacy payment headers are
rejected before hooks or route skips, independently of `onError` (Express: 400;
standalone: `allowed: false`, `skipped: false`).

The client calls `POST /sentinel/verify` with `claim`, string `evidence`,
`mode: "action_authorization"`, and tier. Supply independent evidence through
`AgentContext.evidence` or `onBeforeVerify`; request bodies are explicitly marked
as client declarations, not mandates. Request headers/signatures are not forwarded.
Sentinel `ALLOW` maps to public `APPROVE`, `BLOCK` to `DENY`, and `UNCERTAIN` stays
`UNCERTAIN`. Results preserve `id` and structured `objections`; model count and
duration come from `meta.models_used` and `meta.duration_ms`.

Backend HTTP errors other than 402 (including 401, 429, and 503) follow
`policy.onError`, whose existing default is `"allow"`. Set `onError: "deny"` when
verification is mandatory. A Sentinel HTTP 402 is always fail-closed: both adapters
deny the request (`allowed: false`, verdict `DENY`) and never resolve it as allowed,
regardless of `onError`. The client does not pay Sentinel's own x402 challenge
using the incoming payment.

USD `minAmount` / `maxAmount` cannot value arbitrary atomic tokens. With decoded
payments these policies deny unless a custom `decide` function explicitly handles
valuation using trusted asset/network data. No token decimals or USD peg are inferred.

Contract reviewed on 2026-10-07: [live OpenAPI](https://sentinel.thoughtproof.ai/openapi.json),
[Sentinel source](https://github.com/ThoughtProof/thoughtproof-sentinel/blob/a1747ea53ca2b5292aee34129a7c5746ed3051f2/api/openapi.ts),
[x402 v2](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md).

## Attestation Headers

Verified responses include informational headers (not a signed proof). Sentinel does not promise chain hashes or audit URLs; those legacy fields remain empty:

```
X-ThoughtProof-Version: 1
X-ThoughtProof-Verdict: APPROVE
X-ThoughtProof-Confidence: 0.92
X-ThoughtProof-Chain-Hash:
X-ThoughtProof-Verifiers: 3
X-ThoughtProof-Audit-URL:
X-ThoughtProof-Duration-Ms: 247
X-ThoughtProof-Timestamp: 2026-04-14T21:00:00.000Z
```

Parse them on the client side:

```typescript
import { parseAttestationHeaders } from "thoughtproof-x402";

const proof = parseAttestationHeaders(response.headers);
console.log(proof?.verdict);    // "APPROVE"
console.log(proof?.confidence); // 0.92
console.log(proof?.auditUrl);   // Empty unless supplied by another integration
```

## Configuration

### ThoughtProof Client

| Option | Default | Description |
|--------|---------|-------------|
| `apiUrl` | `https://sentinel.thoughtproof.ai` | API endpoint |
| `apiKey` | — | Sentinel key sent as `X-Sentinel-Key`; no automatic backend payment |
| `tier` | `"standard"` | `"checkpoint"` or `"standard"`; see Sentinel tier discovery for prices |
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
| `onError` | `"allow"` | Action on timeout/error: `"allow"` or `"deny"`. A Sentinel HTTP 402 always denies. |
| `decide` | — | Custom function: `(result, context) => boolean` |

### Lifecycle Hooks

```typescript
thoughtproofMiddleware({
  thoughtproof: { apiKey: "..." },
  onBeforeVerify: (context) => {
    // Supply trusted server-side evidence here; decoded payer addresses are unverified.
    context.evidence = lookupServerSideEvidence(context.resource);
    return true;
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
