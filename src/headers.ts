/**
 * Attestation headers — proof that a payment was verified.
 *
 * These headers are added to HTTP responses after successful
 * ThoughtProof verification, providing an audit trail that
 * downstream consumers can validate.
 */

import type { VerificationResult, AttestationHeaders } from "./types/index.js";

const VERSION = "1";

/**
 * Build attestation headers from a verification result.
 *
 * Add these to the HTTP response so clients and auditors can
 * verify that reasoning was checked before settlement.
 */
export function buildAttestationHeaders(
  result: VerificationResult
): AttestationHeaders {
  return {
    "X-ThoughtProof-Version": VERSION,
    "X-ThoughtProof-Verdict": result.verdict,
    "X-ThoughtProof-Confidence": result.confidence.toFixed(2),
    "X-ThoughtProof-Chain-Hash": sanitizeHeaderValue(result.chainHash),
    "X-ThoughtProof-Verifiers": String(result.verifiers),
    "X-ThoughtProof-Audit-URL": sanitizeHeaderValue(result.auditUrl),
    "X-ThoughtProof-Duration-Ms": String(result.durationMs),
    "X-ThoughtProof-Timestamp": new Date().toISOString(),
  };
}

/**
 * Sanitize a string for safe use as an HTTP header value.
 * Removes CR/LF to prevent header injection attacks.
 */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n\x00]/g, "");
}

/**
 * Parse attestation headers from an HTTP response.
 *
 * Use on the client side to extract verification proof
 * from a server response.
 */
export function parseAttestationHeaders(
  headers: Record<string, string | undefined>
): Partial<VerificationResult> | null {
  const verdict = headers["x-thoughtproof-verdict"] ?? headers["X-ThoughtProof-Verdict"];
  if (!verdict) return null;

  return {
    verdict: verdict.toUpperCase() as VerificationResult["verdict"],
    confidence: parseFloat(headers["x-thoughtproof-confidence"] ?? headers["X-ThoughtProof-Confidence"] ?? "0"),
    chainHash: headers["x-thoughtproof-chain-hash"] ?? headers["X-ThoughtProof-Chain-Hash"] ?? "",
    verifiers: parseInt(headers["x-thoughtproof-verifiers"] ?? headers["X-ThoughtProof-Verifiers"] ?? "0", 10),
    auditUrl: headers["x-thoughtproof-audit-url"] ?? headers["X-ThoughtProof-Audit-URL"] ?? "",
    durationMs: parseInt(headers["x-thoughtproof-duration-ms"] ?? headers["X-ThoughtProof-Duration-Ms"] ?? "0", 10),
  };
}
