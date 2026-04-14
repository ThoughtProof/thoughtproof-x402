/**
 * Shared helpers for extracting payment context from HTTP requests.
 */

import type { IncomingHttpHeaders } from "node:http";

/**
 * Normalize Express/Node headers to Record<string, string>.
 * Express headers can be string | string[] | undefined — flatten them.
 */
export function normalizeHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    result[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return result;
}

/**
 * Extract the agent/signer address from x402 payment header.
 */
export function extractAgentAddress(paymentHeader: string): string | undefined {
  if (!paymentHeader) return undefined;

  try {
    const parsed = JSON.parse(paymentHeader);
    // x402 payment objects have various shapes depending on version
    return parsed.from ?? parsed.signer ?? parsed.address ?? parsed.payload?.from;
  } catch {
    // If it's not JSON, it might be a base64-encoded payment
    // For now, return undefined
    return undefined;
  }
}

/**
 * Extract payment amount from request headers or x402 payment-required response.
 */
export function extractAmount(req: { headers: Record<string, unknown> }): string | undefined {
  const paymentRequired = req.headers["payment-required"] ?? req.headers["x-payment-required"];
  if (!paymentRequired || typeof paymentRequired !== "string") return undefined;

  try {
    const parsed = JSON.parse(paymentRequired);
    const accepts = parsed.accepts ?? parsed;
    if (Array.isArray(accepts) && accepts.length > 0) {
      return accepts[0].maxAmountRequired ?? accepts[0].price ?? accepts[0].amount;
    }
    return parsed.maxAmountRequired ?? parsed.price ?? parsed.amount;
  } catch {
    return undefined;
  }
}

/**
 * Extract network (CAIP-2 format) from request.
 */
export function extractNetwork(req: { headers: Record<string, unknown> }): string | undefined {
  const paymentRequired = req.headers["payment-required"] ?? req.headers["x-payment-required"];
  if (!paymentRequired || typeof paymentRequired !== "string") return undefined;

  try {
    const parsed = JSON.parse(paymentRequired);
    const accepts = parsed.accepts ?? parsed;
    if (Array.isArray(accepts) && accepts.length > 0) {
      return accepts[0].network;
    }
    return parsed.network;
  } catch {
    return undefined;
  }
}
