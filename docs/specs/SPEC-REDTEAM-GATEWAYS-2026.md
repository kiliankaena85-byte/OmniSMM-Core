# SPEC-REDTEAM-GATEWAYS-2026 — External Gateways & Queues Hardening (Tier 1)

**Status:** Approved (FA-2026, 2026-10-03) · **Tier:** 1 (Money / Webhooks / BullMQ)
**Source audit:** Red Team Tier-1 audit of `yookassa-webhook.handler.ts`, `payment.service.ts`, `order-dispatch-executor.ts`, `universal.provider.ts`.

## Invariants

| ID | Invariant | Enforcement |
|---|---|---|
| INV-GW-01 | In production a YooKassa webhook is accepted only from official YooKassa CIDRs (185.71.76.0/27, 185.71.77.0/27, 77.75.153.0/25, 77.75.154.128/25, 77.75.156.11, 77.75.156.35, 2a02:5180::/32). Test mode and loopback do NOT disable the filter in production. IP filter is defense-in-depth only (headers are spoofable). | `src/lib/security/yookassa-ip.ts` (`node:net` BlockList) |
| INV-GW-02 | In production every YooKassa `confirmPayment` performs mandatory API re-verification, except a server-issued mock id (`test_`/`mock_`/`yoo_test_mock_`) on a test-mode tenant whose DB `payment.gatewayId` equals the webhook id exactly. Caller-supplied sandbox flag is ignored. | `payment.service.ts` |
| INV-GW-03 | API re-verification rejects if remote `id` ≠ webhook gatewayId, or remote `metadata.paymentId` ≠ internal paymentId (when both present). | `payment.service.ts` |
| INV-GW-04 | A webhook whose confirmation returned `false` releases its anti-replay key so gateway retries are re-processed (DB idempotency guarantees single credit). | `yookassa-webhook.handler.ts` |
| INV-GW-05 | A provider error where the provider MAY have accepted the order (timeout, network failure, 5xx, invalid JSON, missing order id) is `ProviderAmbiguousError` → order `PENDING_CHECK`, `UnrecoverableError`, NO failover cascade. Cascade only on definitive rejections. | `universal.provider.ts`, `order-dispatch-executor.ts` |

## Edge cases
- Error messages are unchanged (backward-compatible for alerts / `getBalance` / `getServices`).
- `CircuitBreakerOpenException` / SSRF guard failures are definitive (request never sent) → cascade allowed.
- B4 (referral clawback debt) — unchanged pending owner decision.

## Tests
`src/__tests__/unit/redteam-gateways-invariants.test.ts` (pure unit, mocks).
