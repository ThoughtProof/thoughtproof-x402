# Changelog

## 2.0.0

Breaking release. 1.0.0 callers that send only a v1 payment header, use removed tiers, or treat a Sentinel HTTP 402 as `onError` must update.

- **Breaking:** x402 v1 (`X-PAYMENT` / `payment`, Base64 or raw JSON) is accepted only when `allowV1: true`. Invalid v2 input does not fall back to v1.
- Decode x402 v2 from a Base64 `PAYMENT-SIGNATURE` header. Amount and network come from the payload (`accepted.amount`, `accepted.network`), along with asset and payTo.
- Sentinel verification moved to `POST /sentinel/verify` with `mode: "action_authorization"`. Tiers are `checkpoint` and `standard` (default `standard`). Other tier names are rejected at runtime.
- A Sentinel HTTP 402 is fail-closed. Express and standalone both deny the request and never resolve it as allowed, regardless of `onError`.

## 1.0.0

- Initial release: pre-settlement reasoning verification for x402 agent payments.
