# Vybe — Booking Lifecycle Design Gate

**Status:** Product decisions approved; physical schema and migration plan review required before Slice A  
**Domain owner:** Vybe  
**Depends on:** Identity & Access, Organizations, Vybe Provider, Catalogue, Quantity Inventory, Time-slot Occurrences and Holds  
**Integrates with:** Commerce, independent Payments, Finance, Notifications, Operations & Trust  
**Scope:** Durable booking commitments created from existing Vybe inventory holds

The product owner approved the decisions in Section 11 on 2026-11-26. This document is a design gate: it authorizes no Prisma models, migrations, routes, payment execution, refunds, or fulfilment code yet. Slice A may begin only after the physical schema and migration plan are reviewed as a separate step.

## 1. Non-negotiable invariants

1. A hold is temporary inventory protection, not a booking and not proof of payment.
2. A booking is created only by a server-side transaction that validates the hold and atomically converts its inventory from held to committed.
3. One hold can produce at most one booking. Retried requests must return the same result, not duplicate a booking or commitment.
4. A booking must retain immutable snapshots of the offering version, customer-facing description, location, schedule, quantity/resource, price, currency, and applicable terms/policy versions.
5. Provider suspension, offering unpublishing, or later catalogue edits must not silently erase or rewrite an existing booking.
6. Payment status is not booking status. Vybe must not mark a paid booking confirmed from a browser redirect or client assertion.
7. Inventory changes and booking state changes must be atomic and auditable. No external network call may occur inside the database transaction.
8. Commerce coordinates orders and checkout; Payments verifies and executes collections/refunds; Finance owns ledger and settlement. Vybe owns the booking commitment and service fulfilment state. No domain may write another domain's tables.

## 2. Proposed MVP booking model

Use one durable booking aggregate per accepted inventory hold. A hold can contain a quantity of capacity inventory or one concrete exclusive resource. Accommodation room-night inventory remains a separate future booking design because it has different multi-night allocation and cutoff semantics.

A booking stores:

- Public booking reference, internal ID, customer account ID and provider organization/profile IDs.
- Source hold ID with a unique constraint; inventory mode and occurrence/pool reference.
- Offering ID and immutable published offering version.
- Snapshot of title, category, description/benefits, location, timezone, service interval, effective blocked interval, quantity or resource label, and customer-visible instructions.
- Price snapshot: amount in minor units, ISO currency, pricing basis, taxes/fees only when supplied by the future Commerce contract, and pricing-rule/version references. No fee calculation is introduced here.
- Snapshot of cancellation, reschedule, no-show and provider-response terms accepted by the customer.
- Booking status, timestamps, actor/reason history, and version for optimistic concurrency where useful.
- Optional link to a Commerce order item through a stable external reference; no Commerce-owned fields or tables are copied as mutable truth.

Do not store card details, payment credentials, provider secrets, or mutable balance fields in Vybe.

## 3. Proposed lifecycle and state ownership

### Booking status

Proposed states:

- `CONFIRMED`: inventory is committed and the booking is a durable service commitment.
- `CANCELLED`: booking ended under an authorized cancellation decision; inventory treatment is recorded.
- `COMPLETED`: provider/service completion was recorded.
- `NO_SHOW`: applicable attendance window passed and the authorized actor/policy recorded a no-show.

Do not use `PAID`, `REFUNDED`, or `PAYMENT_FAILED` as booking states. Those belong to Payments/Commerce and may coexist with booking states.

For the initial release, recommend **instant confirmation only** for inventory-backed Vybe offerings: a booking becomes CONFIRMED only after the required server-verified payment condition is satisfied for a paid booking, or after a zero-value order is accepted for a free booking. Provider-approval bookings should not be exposed until their response SLA, inventory reservation semantics, customer messaging, and payment authorization/capture behavior are separately designed.

### Transition authority

| Transition | Authorized actor/system | Required guard |
|---|---|---|
| Hold → booking | Vybe booking service, invoked through an authenticated checkout contract | Hold is ACTIVE, unexpired, owned by customer, payload matches, offering/provider/category eligibility remains valid |
| Confirm paid booking | Trusted server-to-server Payments/Commerce integration | Verified successful payment for the exact order/item and amount/currency; idempotent provider event |
| Confirm free booking | Vybe/Commerce server contract | Zero-value order accepted and inventory conversion succeeds |
| Cancel | Customer or authorized platform/provider actor, subject to policy | State and cutoff/policy permit it; reason and actor recorded |
| Complete / no-show | Authorized provider staff or platform operations under scoped permission | Service interval and relevant operational rules permit transition |
| Reschedule | Customer/provider workflow through Vybe | New inventory secured before old commitment is released; policy permits change |

The browser may request an action but cannot directly authorize any transition.

## 4. Hold conversion and inventory atomicity

The conversion must occur in one PostgreSQL transaction and use the same serialization anchors and lock order as the relevant hold implementation.

For a capacity hold:
1. Lock the occurrence and capacity row using the established time-slot lock order.
2. Lock and re-read the hold; synchronously transition it to EXPIRED if its expiry has passed.
3. Require ACTIVE status, owner match, and exact request/idempotency match.
4. Revalidate offering version and provider/category/location eligibility under the established eligibility locks.
5. Decrease held quantity by transitioning the hold to CONVERTED and increase committed quantity by exactly the hold quantity.
6. Insert the booking and immutable snapshots, audit event, and transactional outbox event.
7. Commit all writes together.

For an exclusive-resource hold:
1. Lock the occurrence and concrete resource in the established deterministic order.
2. Lock and re-read the hold; synchronously expire it if necessary.
3. Require ACTIVE status, owner match, and exact request/idempotency match.
4. Revalidate provider eligibility and that the resource remains valid for the occurrence's group and blocked interval.
5. Transition the hold to CONVERTED and create the booking in the same transaction. The active-hold exclusion protection must not leave a gap in which another hold can take the resource; the committed booking must participate in an equivalent database-enforced interval exclusion model.
6. Insert audit and outbox records and commit.

**Critical schema requirement:** exclusive-resource bookings must block overlapping holds and other bookings for the resource for the full effective blocked interval, including pre/post buffers. Do not implement conversion by releasing the hold first and inserting a booking later. The final database constraint, not only application checks, must prevent overlap.

The source hold remains as immutable historical evidence with terminal status `CONVERTED` and a unique booking relation. Replays of the same conversion idempotency key return the existing booking; a different key cannot convert the same hold again.

## 5. Payment and Commerce boundary

No payment provider code is added to Vybe.

Proposed integration sequence for paid inventory:
1. Customer selects inventory and creates a Vybe hold.
2. Commerce creates/coordinates a pending order item referencing the hold and its expiry; the order is not proof of payment.
3. Payments attempts collection and reports a verified, idempotent result through a trusted server contract.
4. Vybe converts the still-valid hold into a committed booking only when the payment condition is satisfied.
5. Commerce finalizes the order from the resulting booking reference; Finance records the resulting financial events independently.

This sequence exposes a real unresolved constraint: a 10-minute hold may expire while payment is pending. The system must never confirm a booking after its hold expired merely because a late payment succeeded. The later Payments/Commerce design must choose a safe authorization/capture or compensation protocol. Until then, do not promise paid checkout end-to-end or capture funds before inventory commitment can be guaranteed.

For free bookings, use the same inventory conversion and idempotency guarantees without invoking Payments.

## 6. Cancellation, rescheduling and inventory release

Cancellation policy must be snapshotted at booking time and expressed in the customer's local terms with an unambiguous timezone/instant cutoff.

Proposed rules:
- A cancellation decision and inventory release/commitment adjustment are one Vybe transaction.
- Before the applicable cutoff, an eligible cancellation releases the committed inventory exactly once.
- After the cutoff, cancellation may be disallowed or recorded as non-refundable according to the accepted policy; any refund decision/execution remains outside Vybe.
- Provider cancellation and platform safety intervention must be supported independently of customer cancellation, with reason, evidence, notifications and an auditable actor.
- A refund does not itself cancel a booking; a booking cancellation does not itself prove that a refund was executed. Cross-domain status is linked by stable references and reconciled.
- Rescheduling must secure the replacement inventory first, then atomically move the commitment and release the old inventory. If the new slot cannot be secured, the original booking remains unchanged.
- Never mutate the original price, offering, schedule or policy snapshots when a booking is amended. Record an amendment/version history and preserve the original agreement.

Partial cancellation of a multi-unit booking is not assumed for MVP. If needed, model child booking units or explicit quantity amendments; do not decrement a booking quantity without an auditable allocation-level record.

## 7. Provider operations and continuity

- Provider owners/admins may view and manage bookings for their own approved supply, subject to least privilege. Assigned staff receive only scoped operational access.
- Provider suspension, approval expiry, category deactivation or offering unpublication blocks new holds/bookings but does not automatically cancel confirmed bookings.
- Existing bookings remain visible to authorized support/operations and must be resolved through an explicit provider/platform cancellation or fulfilment action.
- Provider staff can mark service completion or no-show only within assigned scope and permitted time windows. High-risk or disputed outcomes may require platform review.
- Customer-visible booking details must not reveal private venue/resource identifiers or other customers' information.

## 8. Notifications, audit and outbox

Every durable transition writes its audit record and transactional outbox event in the same transaction. Notifications are asynchronous consumers and must not determine booking truth.

Required events include booking confirmed, cancellation requested/decided, booking cancelled, reschedule completed, service completed, no-show recorded, and provider/platform intervention. Events carry stable booking/customer/provider references and schema versions, not payment secrets or unnecessary personal data.

## 9. Required PostgreSQL tests before implementation is accepted

1. Two concurrent conversion requests for one hold produce exactly one booking and one inventory commitment.
2. Exact idempotent replay returns the same booking; changed payload conflicts.
3. Expiry racing conversion has one deterministic winner; an expired hold cannot convert.
4. Provider suspension racing conversion has a deterministic winner under shared eligibility locks.
5. Capacity conversion moves exactly the held quantity to committed quantity with no availability gap or double count.
6. Exclusive-resource conversion blocks overlapping holds/bookings for the complete blocked interval; adjacent half-open intervals remain valid.
7. Duplicate payment success notifications cannot create duplicate bookings.
8. A late payment after hold expiry cannot create a confirmed booking; compensation remains a Payments/Commerce responsibility.
9. Cancellation releases committed inventory once; concurrent duplicate cancellation is idempotent.
10. Rescheduling secures replacement inventory before releasing the original commitment; failure leaves original booking intact.
11. Offering edits, unpublishing and provider suspension do not mutate booking snapshots or erase existing commitments.
12. Audit/outbox records commit atomically with every booking transition and roll back on failure.

Tests must assert database state and inventory totals after concurrency, not only HTTP responses.

## 10. Delivery plan after approval

- **A — Booking schema and integrity:** booking aggregate, immutable snapshots, source-hold uniqueness, status history, foreign keys/checks/indexes, committed exclusive-resource interval protection. No public routes.
- **B — Hold-to-booking conversion:** transactional capacity and exclusive conversion, idempotency, audit/outbox, PostgreSQL concurrency tests. Use a fake trusted payment-verification contract in tests; no real Payments integration.
- **C — Customer booking read and cancellation:** owner-scoped reads, policy snapshots, cancellation decisions and inventory release.
- **D — Provider operations:** provider booking views, scoped completion/no-show, provider/platform cancellation and notifications.
- **E — Rescheduling and operational hardening:** replacement-first reschedule, reconciliation hooks, support interventions and production observability.

Commerce order orchestration, real Payments integration, Finance, refunds execution, payouts, and accommodation room-night booking remain separate design/implementation gates. Do not begin those workstreams as part of this PR.

## 11. Product-owner decisions — approved 2026-11-26

The product owner explicitly approved the following MVP policies:

1. **Launch confirmation:** instant confirmation only for the first Vybe booking release; provider-approval/manual-confirmation bookings are deferred.
2. **Paid booking confirmation:** server-verified payment is required before a paid booking becomes CONFIRMED. Payment must not be captured on the assumption that a hold will remain valid.
3. **Hold conversion:** convert the hold into committed inventory atomically in the same database transaction that creates the booking.
4. **Cancellation:** snapshot the applicable policy and cutoff at booking time; release inventory only when the cancellation decision is accepted. Refund eligibility and execution remain separate financial decisions.
5. **Rescheduling:** replacement-first atomic rescheduling; do not release the original booking until replacement inventory is secured.
6. **MVP scope:** one booking per hold; no partial cancellation or split booking; accommodation room-night bookings remain excluded from this booking slice.
7. **Provider continuity:** provider suspension/unpublishing blocks new transactions but does not automatically cancel existing confirmed bookings.

**What this approval authorizes:** proceed to a physical schema and migration design review (pre-Slice A). It does not yet authorize migrations, application schema implementation, routes, checkout, Payments integration, Finance, refunds execution, or production payment collection.
