/**
 * Core verification logic — the decision engine.
 *
 * Evaluates a ThoughtProof verification result against a policy
 * to determine whether a payment should proceed.
 */

import type {
  VerificationResult,
  VerificationPolicy,
  AgentContext,
} from "./types/index.js";

const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Decide whether a payment should proceed based on verification result and policy.
 *
 * Returns true if the payment should be allowed, false if denied.
 */
export async function shouldAllow(
  result: VerificationResult,
  context: AgentContext,
  policy: VerificationPolicy = {},
  confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD
): Promise<boolean> {
  // Custom decision function takes precedence
  if (policy.decide) {
    return policy.decide(result, context);
  }

  // Check amount limits
  if (context.amount) {
    const usdAmount = parseAmount(context.amount);
    if (policy.maxAmount !== undefined && usdAmount > policy.maxAmount) {
      return false;
    }
    if (policy.minAmount !== undefined && usdAmount < policy.minAmount) {
      // Below threshold — skip verification entirely and allow.
      // NOTE: This means even DENY verdicts are ignored for small payments.
      // If you want verification for all amounts, don't set minAmount.
      return true;
    }
  }

  // Evaluate verdict
  switch (result.verdict) {
    case "APPROVE":
      return result.confidence >= confidenceThreshold;

    case "DENY":
      return false;

    case "UNCERTAIN":
      return policy.onUncertain === "allow";

    default:
      return false;
  }
}

/**
 * Check if a route should skip verification based on policy.
 */
export function shouldSkipRoute(
  path: string,
  policy: VerificationPolicy = {}
): boolean {
  // requireRoutes takes precedence
  if (policy.requireRoutes?.length) {
    return !matchesAny(path, policy.requireRoutes);
  }

  if (policy.skipRoutes?.length) {
    return matchesAny(path, policy.skipRoutes);
  }

  return false;
}

/**
 * Parse a payment amount string to USD number.
 * Handles "$0.01", "0.01", "1000000" (atomic USDC with 6 decimals).
 *
 * Atomic detection heuristic: if the string is a pure integer (no decimal point)
 * AND > 1,000,000, treat as atomic units with 6 decimals.
 * Strings with decimal points are always treated as human-readable USD.
 */
function parseAmount(amount: string): number {
  const cleaned = amount.replace(/[$,]/g, "").trim();
  const num = parseFloat(cleaned);
  if (isNaN(num) || num < 0) return 0;

  // Only treat as atomic if it's a pure integer string (no decimal point)
  // and exceeds the threshold. "$1500000.00" stays as 1.5M USD.
  const isAtomicCandidate = !cleaned.includes(".") && num > 1_000_000;
  if (isAtomicCandidate) {
    return num / 1_000_000;
  }

  return num;
}

/**
 * Simple glob matching for route patterns.
 * Supports * (any segment) and ** (any path).
 */
function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchGlob(path, pattern));
}

function matchGlob(str: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{DOUBLESTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{DOUBLESTAR\}\}/g, ".*");

  return new RegExp(`^${regexStr}$`).test(str);
}
