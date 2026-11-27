# Vybe Provider and Platform Booking Cancellation — Design Gate

**Status:** Proposed. Product-owner approval is required before schema, migration, API, or service implementation.

**Scope:** Provider-initiated and platform-initiated cancellation of an existing confirmed Vybe booking. This extends the customer cancellation lifecycle without changing the customer cancellation policy or introducing payment/refund behavior.

## 1. Existing approved boundaries

The customer cancellation implementation is complete:

- Customer cancellation is allowed only when the immutable accepted policy permits it and the request arrives strictly before its absolute cutoff.
- Legacy bookings without a structured accepted policy fail closed for customer self-service cancellation.
- Cancellation releases Vybe inventory only. Refund eligibility and execution remain separate.
- Quantity-pool, capacity-session, and exclusive-resource inventory are released atomically.
- Source holds remain converted as historical provenance.
- A booking has at most one accepted cancellation.
- Concurrent cancellation attempts serialize on the booking row. A later request after cancellation returns the cancelled state without another release or event.
- Accommodation room-night booking remains excluded.

See [Customer Booking Cancellation Design](VYBE_CUSTOMER_CANCELLATION_DESIGN.md) and the implementation in PRs #39–#42.

## 2. Proposed actor authorization

All actors must have an active user account. Authorization is evaluated inside the cancellation transaction against the booking's owning provider organization.

### Provider-initiated cancellation

Proposed authorization:

- The actor must have an active organization membership in the booking's `providerOrganizationId`.
- Only `OWNER` and `ADMIN` memberships may cancel. `MEMBER` is read/fulfilment-only.
- The actor cannot cancel bookings belonging to another provider organization.
- Existing confirmed bookings remain manageable even if the provider profile, category approval, or offering is later suspended or unpublished. Suspension blocks new transactions; it does not strand existing customers or prevent the provider from resolving an existing booking.

### Platform-initiated cancellation

Proposed authorization:

- Allow `SUPPORT`, `PLATFORM_ADMIN`, and `SUPER_ADMIN` platform roles.
- Exclude `FINANCE_ADMIN`; financial oversight alone does not grant authority to cancel a customer booking.
- Platform staff may cancel any eligible confirmed Vybe booking.
- Every platform cancellation requires a reason code and an explanatory note.

Unauthorized attempts return 403 and do not create a cancellation decision or release inventory.

## 3. Eligibility and policy interaction

Proposed rules:

- Provider and platform actors may cancel only `CONFIRMED` bookings.
- `COMPLETED` and `NO_SHOW` bookings are not cancellable.
- If the booking is already `CANCELLED`, return the existing cancelled booking state; do not release inventory or emit another cancellation event.
- Provider/platform cancellation is not constrained by the customer's cancellation allowance or cutoff. Those terms govern customer-initiated cancellation, not a provider's inability to deliver or the platform's safety/governance authority.
- Provider/platform cancellation remains all-or-nothing for the booking. No partial quantity cancellation or split booking.
- A provider or platform cancellation does not itself determine refund eligibility, amount, funding source, or timing.

This is a deliberate distinction: providers and the platform must be able to cancel a confirmed service even when the customer can no longer cancel under the accepted customer policy.

## 4. Required reason codes

Every provider/platform request must include a controlled reason code and a bounded explanation (3–1000 characters).

Proposed provider reason codes:

- `SERVICE_UNAVAILABLE`
- `SCHEDULE_CHANGE`
- `OPERATIONAL_ISSUE`
- `SAFETY_CONCERN`
- `OTHER`

Proposed platform reason codes:

- `POLICY_VIOLATION`
- `SAFETY_CONCERN`
- `FRAUD_RISK`
- `CUSTOMER_PROTECTION`
- `OPERATIONAL_CORRECTION`
- `OTHER`

The reason code is machine-readable and immutable. The explanation is stored for audit/support context and is not exposed in public booking discovery responses.

## 5. Idempotency and concurrency

Proposed idempotency scope is `(actorType, actorUserId, idempotencyKey)`.

- Same actor, key, booking, reason code, and normalized explanation: return the original decision.
- Same actor/key reused with a different booking or payload: return `IDEMPOTENCY_KEY_REUSED`.
- Different actors concurrently cancelling the same booking: the booking row lock serializes the requests. The first accepted cancellation wins; subsequent requests return `ALREADY_CANCELLED`.
- Different keys from the same actor against one booking follow the same first-writer rule.
- Rejected attempts are persisted and do not consume the one-accepted-cancellation constraint.
- A new key after the booking is cancelled returns the existing cancelled state without inventory release or a new outbox event.

The database must enforce at most one accepted cancellation per booking, independently of application-level locking.

## 6. Inventory and transaction behavior

Provider/platform cancellation must reuse the same source-specific inventory release rules as customer cancellation:

1. Quantity pool: decrement `committedQuantity` exactly once; keep the source hold `CONVERTED`.
2. Capacity session: decrement the occurrence capacity commitment exactly once; keep the source hold `CONVERTED`.
3. Exclusive resource: transition the same occupancy row from `COMMITTED` to `RELEASED`, clear its active `bookingId` as required by the database constraint, and keep the source hold `CONVERTED`.

One database transaction must include:

- Actor authorization and booking ownership/provider-scope validation
- Booking row lock and source inventory locks
- Cancellation decision record
- Inventory release
- `CONFIRMED` → `CANCELLED` state transition and `cancelledAt`
- Status history
- Audit record
- Outbox events

Any failure rolls back the entire operation. The source hold is retained as historical provenance. No payment-provider call, refund, ledger posting, or settlement action is part of this transaction.

## 7. Persistence and event changes required

The current cancellation record is customer-scoped. Provider/platform cancellation requires an actor-neutral extension before implementation.

Proposed record additions:

- `actorType`: `CUSTOMER`, `PROVIDER`, or `PLATFORM`
- `actorUserId`: authenticated user who initiated the decision
- `actorOrganizationId`: required for provider actor; null for customer/platform
- `reasonCode`: controlled provider/platform code; null for customer requests if existing customer contract remains unchanged
- Keep `customerUserId` as the booking owner, not the acting provider/platform user.
- Replace customer-only idempotency uniqueness with `(actorType, actorUserId, idempotencyKey)`.
- Backfill existing rows as `actorType=CUSTOMER`, `actorUserId=customerUserId`, `actorOrganizationId=null`.
- Preserve the partial unique index allowing only one `ACCEPTED` cancellation per booking.
- Keep cancellation decisions append-only and retain the booking/source/customer integrity guards.

Events:

- `vybe.booking.cancellation_decided.v1` for accepted and rejected provider/platform decisions.
- `vybe.booking.cancelled.v1` only for the first accepted cancellation.
- Event payload includes `actorType`, `actorUserId`, optional `actorOrganizationId`, `reasonCode`, decision, booking reference, source type, and timestamp.
- `ALREADY_CANCELLED` creates an idempotency/audit record but emits no new outbox event.

Actual customer notification delivery is not included. Outbox events may be consumed by a future notifications workflow.

## 8. Explicit non-goals

- Refund eligibility, calculation, authorization, execution, timing, or guarantees
- Payments provider calls, payment capture/void, Finance ledger, reconciliation, or settlement
- Partial quantity cancellation, split bookings, or rescheduling
- Provider approval/manual confirmation workflows
- Accommodation room-night booking lifecycle
- Notification delivery implementation
- Provider cancellation of completed/no-show bookings

## 9. Product-owner decisions required

Please approve or change these proposals before implementation:

1. **Provider authorization:** only active organization `OWNER` and `ADMIN` may cancel; `MEMBER` cannot.
2. **Platform authorization:** `SUPPORT`, `PLATFORM_ADMIN`, and `SUPER_ADMIN` may cancel; `FINANCE_ADMIN` cannot.
3. **Suspended providers:** provider owners/admins may still cancel their existing confirmed bookings after provider/category suspension or offering unpublishing.
4. **Eligibility:** provider/platform cancellation is allowed only for `CONFIRMED` bookings and bypasses the customer's cancellation cutoff.
5. **Reason codes:** adopt the provider/platform reason-code lists in Section 4, with a required explanation.
6. **Concurrency:** first accepted cancellation wins across customer/provider/platform actors; later actors receive `ALREADY_CANCELLED`, with no second release or event.
7. **Idempotency:** scope keys by actor type + actor user ID + key; persist rejected decisions without consuming the accepted-cancellation uniqueness constraint.
8. **Refund boundary:** cancellation only releases Vybe inventory and records the decision; all refund/payment/finance consequences remain separate.
9. **Events:** emit decision and cancelled events as specified in Section 7; no new event for `ALREADY_CANCELLED`.

No schema, migration, route, or service work is authorized by this proposal alone.
