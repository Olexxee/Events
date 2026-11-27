# Vybe — Booking Physical Schema and Migration Review

**Status:** Proposed physical design; review required before Slice A  
**Related decisions:** [Booking lifecycle design](VYBE_BOOKING_DESIGN.md)  
**Baseline:** `main` at `3cb29e6bf247d0fac8a24b279eb396766bf26b74`  
**Scope:** Schema and migration design only. No Prisma models, migrations, routes, services, or payment integrations are introduced by this document.

## 1. Review outcome

The current inventory implementation supports three relevant non-accommodation hold shapes:

1. Quantity-pool holds: `VybeInventoryHold` against `VybeInventoryPool`.
2. Capacity-session holds: `VybeTimeSlotHold` with `capacityQuantity`.
3. Exclusive-resource holds: `VybeTimeSlotHold` with `resourceId` and a blocked interval.

Accommodation room-night holds are deliberately excluded from this booking slice, consistent with the approved MVP decision.

A durable booking therefore cannot be designed as though there were only one source-hold table. The booking aggregate must identify exactly one supported source hold and enforce one booking per source hold. The current source-hold enums have no `CONVERTED` state, so that state transition must be added deliberately in a later implementation migration.

The most important integrity gap is exclusive-resource occupancy. Today PostgreSQL excludes overlapping ACTIVE rows in `vybe_time_slot_holds`. That constraint does not cover a separate booking table. PostgreSQL exclusion constraints cannot span two tables. Releasing or converting the hold and relying on a separate booking row would therefore create a race unless the hold and committed booking continue to occupy one common constrained relation.

**Recommendation:** introduce a single time-slot resource-occupancy relation for exclusive resources. A row is created with the hold, then atomically changes ownership from the hold to the booking on conversion. The same GiST exclusion constraint protects both temporary holds and committed bookings. Do not attempt a cross-table exclusion trigger as the primary concurrency guarantee.

## 2. Existing schema facts

### 2.1 Catalogue and version snapshots

- `VybeOffering` identifies provider, category, lifecycle status, and current published version.
- `VybeOfferingVersion` stores immutable versioned JSON content and publication time.
- Existing time-slot occurrences already store `offeringVersion`, timezone, service interval, pre/post buffers, and effective blocked interval.
- Quantity-pool inventory is linked to one offering.

A booking should reference the offering and version for traceability and also retain a booking-time immutable snapshot. It must not depend on joining the current offering version to reconstruct what the customer bought. Provider edits and unpublishing must not mutate the booking snapshot.

### 2.2 Quantity-pool holds

- `VybeInventoryPool` stores allocated and committed quantities.
- `VybeInventoryHold` stores user, idempotency key, quantity, status, and expiry.
- Availability is calculated from committed quantity plus active unexpired holds under a pool row lock.
- Current hold states are `ACTIVE`, `RELEASED`, and `EXPIRED`.

Conversion must lock the pool and hold using a deterministic order, re-check expiry and ownership, increment `committedQuantity` exactly once, and move the hold to `CONVERTED` in the same transaction that inserts the booking. The committed quantity must remain within the allocated quantity check constraint.

### 2.3 Time-slot capacity holds

- `VybeTimeSlotOccurrence` identifies a concrete service occurrence and its effective blocked interval.
- `VybeTimeSlotCapacity` stores total capacity and committed quantity.
- Capacity held quantity is derived from active, unexpired `VybeTimeSlotHold` rows.
- Existing capacity hold operations lock the occurrence before re-reading or changing holds.
- Current time-slot hold states are `ACTIVE`, `RELEASED`, and `EXPIRED`.

Conversion must use the established occurrence/capacity lock order, synchronously expire stale holds, increment committed quantity by exactly the held quantity, and set the source hold to `CONVERTED` atomically with booking creation.

### 2.4 Exclusive-resource holds

- Exclusive holds identify a concrete resource and snapshot the service and blocked intervals.
- PostgreSQL currently applies a GiST exclusion constraint to overlapping ACTIVE hold rows for the same resource, using half-open `[)` intervals.
- The existing constraint only protects rows in `vybe_time_slot_holds`.
- Resource-group membership and validity are guarded by database triggers and application locks.

The booking must preserve the same concrete resource and effective blocked interval. It must not rely only on a pre-insert overlap query.

## 3. Proposed booking aggregate

Propose one `VybeBooking` row per source hold, with:

- Internal UUID and opaque, unique customer-facing booking reference.
- Customer user ID, provider profile ID, and provider organization ID.
- Offering ID and immutable offering-version number.
- Booking status: `CONFIRMED`, `CANCELLED`, `COMPLETED`, or `NO_SHOW`.
- Exactly one source reference: quantity-pool hold OR time-slot hold.
- Normalized service and blocked interval fields where applicable, timezone, quantity, and resource reference where applicable.
- A versioned immutable JSON snapshot for customer-visible offering details, location, instructions, service timing, quantity/resource label, and accepted policy terms.
- A separate immutable commercial snapshot/quote reference supplied by the future Commerce contract; Vybe does not calculate prices, fees, taxes, or commissions.
- Created/confirmed/cancelled/completed timestamps and standard created/updated timestamps.
- Optional external Commerce order-item reference as an opaque integration identifier, not a foreign key into Commerce-owned tables.

### 3.1 Source-hold integrity

Use two nullable source columns with a database CHECK requiring exactly one to be non-null:

- `inventoryHoldId` — unique, nullable FK to `vybe_inventory_holds`.
- `timeSlotHoldId` — unique, nullable FK to `vybe_time_slot_holds`.

The unique constraints enforce at most one booking per source hold. The CHECK prevents a booking from having both sources or neither source. Accommodation holds are not a supported source in this slice.

Add database-level consistency protection so a booking's customer matches the source hold's user, and the offering/provider snapshot matches the source pool or time-slot occurrence. A normal FK to the hold ID alone cannot enforce these cross-table equality rules. The physical implementation should use composite unique keys/FKs where practical and narrowly scoped constraint triggers for the remaining cross-table invariants; application checks alone are insufficient for ownership integrity.

### 3.2 Booking status history

Use an append-only `VybeBookingStatusHistory` table containing booking ID, prior/new status, actor type and optional actor ID, reason code, safe metadata, and occurrence timestamp. Status changes and history rows must commit in one transaction. Do not store payment state in the booking status enum.

A status-history table is not a substitute for the platform audit log: the former is the booking's domain timeline; the latter records security and administrative actions.

### 3.3 Snapshot and commercial boundary

The current offering version content is JSON, and no canonical price model is currently present in the Vybe offering schema. Therefore:

- Snapshot the published offering content and normalized fields needed for reliable display and fulfilment.
- Store price only when a trusted Commerce quote/contract supplies amount in minor units, ISO currency, quote reference, and any agreed breakdown.
- Do not infer a price from catalogue text or add a Vybe-side fee calculation.
- Do not store card details, payment credentials, provider secrets, or mutable balances.
- Keep payment attempt/status identifiers outside Vybe's booking state; use opaque external references and trusted server-to-server contracts.

A paid checkout cannot be implemented until the Commerce/Payments design defines safe authorization/capture or compensation around the short hold expiry. This schema review does not resolve that financial protocol.

## 4. Exclusive-resource occupancy — required design

### 4.1 Why a separate booking table is not enough

The current exclusion constraint protects only ACTIVE rows in `vybe_time_slot_holds`. A booking row in another table is invisible to it. If conversion marks the hold terminal and inserts a booking elsewhere, another hold can overlap the booking unless both representations are protected by a single database constraint.

### 4.2 Recommended common occupancy relation

Introduce a relation conceptually named `VybeTimeSlotResourceOccupancy` with:

- Resource ID.
- Occurrence ID.
- Blocked start/end timestamps.
- State: `HELD`, `COMMITTED`, `RELEASED`, or `EXPIRED`.
- Unique nullable source time-slot hold ID.
- Unique nullable booking ID.
- Created/updated timestamps.

A CHECK requires exactly one of source hold ID or booking ID to be present only if the implementation chooses separate ownership rows. **Preferred conversion behavior is to keep the same occupancy row and set its booking ID while retaining the source hold ID as immutable provenance**, so the row remains the same protected interval through conversion. In that design, the hold and booking references are both populated after conversion and the CHECK should instead require a hold reference at all times and a booking reference only for COMMITTED state.

Add a GiST exclusion constraint on resource ID and `tstzrange(blockedStartsAt, blockedEndsAt, '[)')` for states `HELD` and `COMMITTED`. The same row changes from HELD to COMMITTED in the conversion transaction; there is no release/reinsert gap. Released and expired rows no longer block availability.

The database must also verify that the occupancy resource is a valid member of the occurrence's resource group for the full blocked interval. Preserve existing ownership and membership guards, and ensure the occupancy row cannot outlive or contradict its source hold or booking.

### 4.3 Migration and rollout requirements

This is an expand/contract migration, not a blind replacement:

1. Create the occupancy table, indexes, foreign keys, checks, and GiST exclusion constraint while the existing hold-table exclusion remains active.
2. Backfill every existing ACTIVE, unexpired exclusive-resource hold into occupancy, preserving its exact resource and blocked interval. Expired holds must be transitioned to EXPIRED using the existing synchronous expiry rules before backfill.
3. Verify one-to-one coverage between eligible source holds and occupancy rows; fail migration if duplicates, overlaps, or missing rows are found.
4. Deploy code that writes and transitions occupancy transactionally with exclusive hold creation, expiry, and release while the legacy constraint remains in place.
5. Only after all application instances use the new relation, remove the old hold-table exclusion constraint in a separately controlled migration.
6. Conversion changes the occupancy row from HELD to COMMITTED and attaches the booking in the same transaction. Cancellation changes it to RELEASED only when the cancellation decision is accepted.

The exact ordering of migration and application releases must be finalized against the deployment model and rollback strategy before implementation. Never remove the existing exclusion protection while any running application version can create exclusive holds without occupancy rows.

## 5. Inventory conversion contracts

| Source | Lock anchor | Conversion mutation | Resulting protection |
|---|---|---|---|
| Quantity pool | Pool row, then source hold | Increment pool committed quantity; hold → CONVERTED | Existing pool check and row lock |
| Time-slot capacity | Occurrence/capacity row, then source hold | Increment capacity committed quantity; hold → CONVERTED | Existing capacity bounds and occurrence lock |
| Exclusive resource | Occurrence/resource in deterministic order, source hold, occupancy row | Hold → CONVERTED; occupancy HELD → COMMITTED with booking ID | GiST exclusion over both holds and bookings |

All three conversions create the booking, status-history row, audit record, and outbox event in one database transaction. Idempotency is anchored to the unique source hold: a retry returns the existing booking; a different request cannot create a second booking for that hold.

Hold expiry and conversion must serialize on the same lock anchors. Exactly one wins. If expiry wins, conversion fails and no booking is created. If conversion wins while the hold is still valid, it commits the booking and the hold can no longer expire/release inventory independently.

## 6. Cancellation and rescheduling storage

For MVP cancellation, record the accepted policy snapshot, decision actor/reason/time, and a unique release operation. The booking status change, status history, inventory decrement/release, occupancy state change, audit, and outbox must be atomic and idempotent.

For rescheduling, the replacement inventory must be secured before releasing the original. The schema must preserve an amendment record linking old and replacement occurrence/hold/booking references, accepted terms, actor, and timestamp. The old booking must remain intact if replacement acquisition fails. The approved MVP says one booking per hold and no partial cancellation/split booking.

Do not add refund, payout, ledger, or payment-state columns to the Vybe booking aggregate.

## 7. Required schema-level safeguards

- Exactly one supported source hold per booking; unique source hold references.
- Customer identity equals source hold owner.
- Offering and provider identity match source inventory.
- Offering version is positive and immutable in booking snapshot.
- Booking quantity is positive and matches source hold quantity for quantity-backed inventory.
- Exclusive booking resource and blocked interval match the converted source hold and occupancy row.
- Committed quantities remain within allocated/capacity bounds.
- One occupancy row per exclusive hold; one booking per source hold.
- No overlapping HELD or COMMITTED occupancy for the same concrete resource.
- Terminal source holds cannot be converted again or released as though still active.
- Booking status transitions are constrained to the approved lifecycle and recorded in append-only history.
- Audit/outbox rows are transactionally coupled to each durable transition.

## 8. PostgreSQL integration tests required before Slice A is accepted

1. Booking cannot reference both source-hold types or neither.
2. A source hold can be referenced by at most one booking.
3. Booking customer cannot differ from hold owner.
4. Booking offering/provider cannot differ from source inventory.
5. Quantity-pool conversion increments committed quantity exactly once and respects pool bounds.
6. Capacity conversion increments committed quantity exactly once and respects occurrence capacity.
7. Expiry racing conversion has one winner; expired holds cannot convert.
8. Two concurrent conversions of one hold create one booking and one commitment.
9. Exclusive hold occupancy is backfilled without losing existing exclusion protection.
10. An active hold and committed booking cannot overlap for one resource.
11. Two committed bookings cannot overlap for one resource.
12. Adjacent half-open intervals remain valid.
13. Cancellation releases committed inventory exactly once.
14. Provider suspension racing conversion has a deterministic winner under existing eligibility locks.
15. Booking snapshots remain unchanged after offering edits, unpublishing, or provider suspension.
16. Audit, status history, and outbox writes roll back with a failed booking transaction.

Tests must inspect PostgreSQL state and inventory totals after concurrent operations, not only HTTP responses.

## 9. Explicitly excluded

- Accommodation room-night bookings and accommodation hold conversion.
- Commerce order orchestration and checkout APIs.
- Real Payments integration, provider collection, authorization/capture, refunds, Finance, ledger, commissions, settlements, and payouts.
- Provider-confirmed/manual-confirmation booking flows.
- Partial cancellation, split bookings, and booking transfers.
- Public booking APIs or customer/provider booking screens.

## 10. Review decision requested

This document recommends the schema and rollout direction above. Before Slice A, review and explicitly approve:

1. The three supported source-hold types and exclusion of accommodation room-night holds.
2. One booking row with exactly one unique source-hold reference.
3. A common exclusive-resource occupancy relation carrying the interval from HELD through COMMITTED.
4. Expand/contract migration with backfill and no gap in the existing exclusion guarantee.
5. Commerce-supplied immutable price quote snapshot; no price calculation in Vybe.

Approval of this document would authorize Slice A schema/migration implementation only. It would not authorize checkout, payment integration, refunds, Finance, or accommodation booking.
