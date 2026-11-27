# Vybe — Customer Booking Read and Cancellation Design Gate

**Status:** Proposed; product-owner approval required before Slice C implementation  
**Domain owner:** Vybe  
**Depends on:** Booking schema and atomic hold conversion (PRs #36 and #37)  
**Scope:** Customer-owned booking reads and customer-initiated cancellation only

This design gate defines the next booking slice. It does not authorize implementation of routes, migrations, or services until the cancellation policy and API decisions in Section 12 are approved.

## 1. Current baseline and gaps

The merged booking aggregate supports three source types: quantity-pool, capacity-session, and exclusive-resource. A booking is created from one converted hold and stores immutable offering, quote, and accepted-terms JSON snapshots. Booking states are `CONFIRMED`, `CANCELLED`, `COMPLETED`, and `NO_SHOW`; status history, audit log, and transactional outbox infrastructure already exist.

The current accepted-terms validator only requires a non-empty `version`. It does not require a machine-readable cancellation policy or cutoff. The current schema has no cancellation-decision/release-operation record. Therefore, the platform cannot safely infer cancellation eligibility from current offering terms or mutable catalogue data. Slice C must close this gap before exposing cancellation.

## 2. Slice C scope

Included:

- Authenticated customer list and detail reads for their own bookings.
- A versioned, immutable cancellation-policy snapshot captured when the booking is confirmed.
- Customer-initiated cancellation decision against that snapshot.
- Atomic all-or-nothing release of the booking's committed inventory when cancellation is accepted.
- Idempotent cancellation requests, append-only decision/history, audit and outbox.
- PostgreSQL concurrency and authorization tests.

Excluded:

- Provider-initiated cancellation, platform safety cancellation, provider booking dashboards, completion and no-show operations (Slice D).
- Refund eligibility decisions, refund execution, payment state, payment-provider integration, Commerce checkout, Finance, ledger or settlement.
- Rescheduling, partial cancellation, split bookings, transfers, and accommodation room-night bookings.
- Customer UI or notifications delivery; Slice C emits outbox events only.

## 3. Customer read contract

Proposed routes:

- `GET /api/v1/vybe/bookings` — authenticated customer's bookings, paginated and ordered by `createdAt DESC, id DESC`.
- `GET /api/v1/vybe/bookings/:bookingId` — one booking owned by the authenticated customer.

The authenticated principal is the only source of customer identity. Never accept a customer user ID in query/body to select another account's bookings. Reads must filter by `customerUserId = principal.userId`; a booking owned by another user should return the same not-found response as an unknown booking to avoid an existence oracle.

List filters should be deliberately narrow for MVP: status and a bounded cursor/page size. Do not expose provider-only operational fields, internal hold IDs, resource identifiers, private venue details, payment evidence, raw audit metadata, or other customers' data. Return the customer-facing immutable booking/offering/price/terms snapshots, public booking reference, status, service time where present, quantity, and timestamps. Apply field-level redaction to private location/resource data using the existing catalogue visibility rules.

## 4. Cancellation policy snapshot

The cancellation policy must be a structured object inside `acceptedTermsSnapshot`, captured and accepted before booking confirmation. It must not be reconstructed at cancellation time from the current offering version.

Proposed minimum shape (schema versioned independently):

- `policyVersion`: non-empty immutable policy identifier.
- `customerCancellation.allowed`: boolean.
- `customerCancellation.cutoffAt`: absolute ISO-8601 instant with offset, or null when the policy has no time cutoff.
- `customerCancellation.timezone`: valid IANA timezone used to display the cutoff.
- `customerCancellation.displayText`: customer-facing text that describes the accepted rule.
- `acceptedAt`: server-recorded acceptance instant.

The backend validates the structure and validates that a non-null cutoff is a valid instant. The UI's displayed local time is presentation only; the server compares database time against the absolute cutoff instant. Do not trust a client-supplied cutoff or policy.

For legacy bookings whose accepted-terms snapshot lacks this structured policy, self-service cancellation must fail closed with a clear unsupported-policy response. Do not backfill from mutable current offering terms. Such cases require a future explicit support/operations path.

## 5. Recommended customer cancellation decision

Recommendation for the first release:

1. Customer may cancel only a `CONFIRMED` booking.
2. Cancellation is automatically accepted when `allowed = true` and either `cutoffAt = null` or the server's decision time is strictly earlier than `cutoffAt`.
3. At or after the cutoff, the customer cancellation is rejected. The booking remains `CONFIRMED`; no inventory is released.
4. If `allowed = false`, customer cancellation is rejected regardless of time.
5. `CANCELLED`, `COMPLETED`, and `NO_SHOW` bookings cannot be customer-cancelled again.
6. No pending provider-approval state is introduced in this slice. Provider/platform-initiated cancellation is a separate Slice D workflow.

This is an operational cancellation decision only. It does not promise a refund or determine refund amount. The response must state that any refund is governed and processed separately; do not label a cancellation refundable/non-refundable unless that is an explicit field in the accepted policy and a separate Payments/Commerce contract supplies the financial outcome.

## 6. Cancellation API contract

Proposed route:

`POST /api/v1/vybe/bookings/:bookingId/cancellation`

Request body:

- `idempotencyKey`: required opaque key, bounded length.
- `reason`: required short customer reason, bounded length; treat as untrusted text and never as policy input.

The server derives the actor from the authenticated principal. The customer cannot submit an actor type, policy, cutoff, inventory quantity, source hold ID, refund status, or desired booking status.

Response on acceptance returns the public booking reference, `CANCELLED` status, decision timestamp, and a neutral statement that the booking has been cancelled and any applicable refund is handled separately. A rejected request returns a stable domain error and leaves booking/inventory unchanged.

Idempotency rules:

- Same customer + same idempotency key + same booking and normalized request returns the original decision.
- Reusing the key with a different booking or request payload returns conflict.
- Concurrent cancellation attempts for one booking serialize on the booking row. Exactly one accepted cancellation and one inventory release may occur.
- A new key submitted after the booking is already cancelled returns the existing cancelled state without another release or event.
- A request rejected by policy must not permanently consume the booking's one accepted-cancellation slot; retries with a new key after a policy/cutoff change are not possible because the policy snapshot is immutable, but the request key remains replayable.

## 7. Atomic inventory release

Cancellation acceptance, inventory release, booking state transition, cancellation decision record, status history, audit, and outbox must commit or roll back together. No external calls occur inside the transaction.

Use the same inventory serialization anchors as hold conversion and acquire locks in a documented deterministic order. Re-read and validate the booking and source hold under lock. Require source hold status `CONVERTED` and exact source/booking ownership consistency.

| Booking source | Atomic release |
| --- | --- |
| Quantity pool | Lock pool and source hold; decrement `committedQuantity` by the booking's immutable source-hold quantity exactly once. Enforce non-negative committed quantity. Keep the source hold `CONVERTED` as historical provenance. |
| Capacity session | Lock occurrence/capacity and source hold; decrement `committedQuantity` by the exact held capacity quantity exactly once. Enforce non-negative committed quantity. Keep the source hold `CONVERTED`. |
| Exclusive resource | Lock booking/occupancy in established order; transition the same occupancy row `COMMITTED → RELEASED`. Do not delete/reinsert occupancy or create a gap in the GiST exclusion guarantee. Keep the source hold `CONVERTED`. |

The source hold is not changed to `RELEASED`: it records the historical conversion that created the booking. The cancellation decision and occupancy/commitment state record the later release. Releasing a commitment must never permit an allocation counter to go negative or release more than once.

## 8. Persistence and integrity design

Recommended addition: `VybeBookingCancellation` (or equivalently named decision record) with:

- booking ID, customer actor ID, accepted policy version/snapshot reference, decision outcome, reason, decision timestamp;
- idempotency key and normalized request hash;
- immutable booking/source identifiers needed to audit the release;
- unique `(customerUserId, idempotencyKey)`;
- database-enforced uniqueness for at most one ACCEPTED cancellation per booking (a partial unique index, or an equivalent normalized one-to-one accepted-cancellation relation).

Rejected attempts may be recorded for audit but must not block a later accepted decision. The implementation must choose a PostgreSQL constraint strategy that enforces one accepted release even under concurrent requests. Do not rely only on a preflight application query.

The booking status transition must be conditional on `status = CONFIRMED`; status history records `CONFIRMED → CANCELLED`, actor, reason and policy version. Audit and outbox are written in the same transaction. Use stable event names such as `vybe.booking.cancellation_decided.v1` and `vybe.booking.cancelled.v1`, with a deterministic deduplication key tied to the accepted cancellation record.

## 9. Authorization and privacy

- Customer list/detail/cancellation require an active authenticated account.
- Customer operations are strictly owner-scoped.
- No provider or organization role grants customer impersonation in Slice C.
- Unknown and not-owned booking IDs are indistinguishable to the caller.
- Do not expose internal source-hold, resource, payment-verification or private venue data.
- Cancellation reason is untrusted user content; bound its length and avoid copying it into public event payloads or logs unnecessarily.

## 10. Required PostgreSQL tests

1. Customer can list and retrieve only their own bookings; another customer's booking is indistinguishable from missing.
2. Inactive/unauthenticated account cannot read or cancel.
3. List pagination is stable and bounded; status filter cannot broaden ownership.
4. Valid policy snapshot permits cancellation before cutoff; cutoff comparison uses absolute instant.
5. At exact cutoff and after cutoff, cancellation is rejected with no inventory mutation.
6. `allowed = false` rejects cancellation; malformed/missing policy snapshots fail closed.
7. Legacy booking without structured cancellation policy is not silently assigned a current policy.
8. Quantity-pool committed quantity decreases by exact source quantity once.
9. Capacity committed quantity decreases by exact source quantity once.
10. Exclusive occupancy transitions COMMITTED to RELEASED on the same row; overlapping future hold can proceed only after release commits.
11. Two concurrent requests with different keys produce one accepted cancellation and one release.
12. Exact idempotent replay returns the same decision; changed payload with same key conflicts.
13. A new key after accepted cancellation returns the existing cancelled booking without a second decrement/event.
14. A failed transaction rolls back booking status, decision, inventory, history, audit and outbox together.
15. Cancellation racing a future completion/no-show transition has one valid state-transition winner; terminal states cannot be overwritten.
16. Source holds remain CONVERTED and historical booking snapshots remain unchanged after cancellation.

Tests must assert PostgreSQL counters, source-hold state, occupancy state, decision rows, status history, audit and outbox after concurrent operations.

## 11. Delivery sequence

- **C1 — Read-only customer booking API:** owner-scoped list/detail, response DTO and privacy tests.
- **C2 — Cancellation policy contract:** require structured policy snapshot for new booking confirmations; fail closed for unsupported legacy snapshots.
- **C3 — Cancellation decision and release:** decision persistence, idempotency, inventory release transaction, history/audit/outbox.
- **C4 — Concurrency and regression hardening:** full PostgreSQL matrix, authorization and race tests.

These are implementation slices under one approved design, but each must pass the complete CI suite before merge. No refund, provider cancellation, reschedule or accommodation booking work is implied.

## 12. Product-owner decisions required

Please approve or change these recommendations before Slice C implementation:

1. **Customer cancellation authority:** accept automatically when the immutable policy allows it and the request arrives before cutoff; otherwise reject. No provider approval queue in Slice C.
2. **Cutoff semantics:** compare server time to the absolute snapshotted instant; strictly before is eligible, exactly at/after is not.
3. **Policy contract:** require a structured versioned cancellation policy in accepted terms for every new booking; legacy bookings without it are not self-service cancellable.
4. **Cancellation scope:** all-or-nothing cancellation of one booking; no partial quantity cancellation or split.
5. **Actor scope:** customer-initiated cancellation only in Slice C; provider/platform cancellation is deferred to Slice D.
6. **Financial boundary:** cancellation releases Vybe inventory only; refund eligibility/execution and customer refund timing remain separate and are not implied by the cancellation response.
7. **Persistence:** record every idempotent request outcome and enforce at most one accepted cancellation per booking at the database level.

Approval authorizes Slice C implementation planning and code only. It does not authorize Commerce checkout, real Payments, refunds, Finance, provider operations, rescheduling, or accommodation room-night bookings.
