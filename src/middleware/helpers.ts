/** Shared, runtime-portable x402 HTTP decoding. This does not verify signatures. */
import type { AgentContext } from "../types/index.js";

export function normalizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const name = key.toLowerCase();
    result[name] = name in result ? `${result[name]}, ${value}` : Array.isArray(value) ? value.join(", ") : value;
  }
  return result;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function decode(value: string): unknown {
  // atob alone tolerates whitespace and missing padding; require canonical Base64.
  if (!value || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Invalid Base64 payment header");
  }
  const binary = atob(value);
  if (btoa(binary) !== value) throw new Error("Non-canonical Base64 payment header");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, c => c.charCodeAt(0))));
}

/** null means no payment signal. Present but invalid/disabled headers always throw. */
export function paymentContext(headers: Record<string, string>, allowV1 = false): Partial<AgentContext> | null {
  const normalized = normalizeHeaders(headers);
  const v2 = normalized["payment-signature"];
  const legacy = normalized["x-payment"] ?? normalized.payment;
  if (v2 === undefined && legacy === undefined) return null;
  if (v2 === undefined && !allowV1) throw new Error("x402 v1 requires allowV1: true");
  const raw = v2 ?? legacy!;
  const parsed: unknown = v2 === undefined && raw.startsWith("{") ? JSON.parse(raw) : decode(raw);
  if (!object(parsed) || !object(parsed.payload)) throw new Error("Invalid x402 payment payload");
  const authorization = object(parsed.payload.authorization) ? parsed.payload.authorization : {};
  if (v2 !== undefined) {
    const accepted = parsed.accepted;
    if (parsed.x402Version !== 2 || !object(accepted) ||
        !text(accepted.scheme) || !text(accepted.network) || !/^[a-z0-9-]{3,8}:[a-zA-Z0-9_-]{1,32}$/.test(accepted.network as string) ||
        !text(accepted.amount) || !/^\d+$/.test(accepted.amount as string) ||
        !text(accepted.asset) || !text(accepted.payTo) ||
        typeof accepted.maxTimeoutSeconds !== "number" || !Number.isInteger(accepted.maxTimeoutSeconds) || accepted.maxTimeoutSeconds <= 0) {
      throw new Error("Invalid x402 v2 accepted requirements");
    }
    return { paymentVersion: 2, amountUnit: "atomic", amount: accepted.amount as string,
      network: accepted.network as string, token: accepted.asset as string, recipient: accepted.payTo as string,
      agentAddress: text(authorization.from) ?? text(parsed.payload.from) };
  }
  if (parsed.x402Version !== 1 || !text(parsed.network) || !text(parsed.scheme)) throw new Error("Invalid x402 v1 payload");
  return { paymentVersion: 1, amountUnit: "atomic", amount: text(authorization.value),
    network: parsed.network as string, recipient: text(authorization.to),
    agentAddress: text(authorization.from) ?? text(parsed.payload.from) };
}
