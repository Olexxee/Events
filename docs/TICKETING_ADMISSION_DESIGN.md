# Ticketing & Admission — Design Gate

**Status:** Approved MVP policy; implementation in progress  
**Owner:** Ticketing & Admission  
**Depends on:** Identity & Access, Event marketplace, Event Access  
**Integrates with:** Commerce, Payments, Finance, Notifications, Connect, Operations

Ticketing owns sellable admission products, inventory, temporary holds, issued admission credentials, transfers, admission validation, and ticket entitlements. It does not own order totals, payment-provider truth, refunds execution, organizer balances, or the financial ledger. Commerce orchestrates orders; Payments verifies collections and executes approved refunds; Finance owns ledger and settlement truth.

The product owner approved all ten MVP defaults in Section 15 on 2026-11-25. This authorizes Ticketing schema, APIs, transactional inventory workflows, and PostgreSQL integration tests. It does not authorize a payment provider, financial ledger, refund engine, or settlement implementation.

## 1. Non-negotiable domain boundaries

1. Event Access approval authorizes an eligible user to proceed to checkout; it is not inventory, a ticket, or admission.
2. A successful browser redirect or client assertion is never proof of payment.
3. A paid ticket is issued only after Payments reports a verified successful collection for the relevant order item. A free ticket is issued only after the free order/registration is atomically confirmed.
4. Inventory is reserved before checkout can complete and cannot be oversold under concurrency.
5. An order, payment, ticket, and check-in are separate records and facts.
6. Ticketing owns ticket status and admission eligibility. Payments owns payment/refund execution; Finance owns financial postings.
7. Every important transition is authorized, auditable, idempotent, and emits an outbox event in the same transaction.
8. Ticketing must not read or mutate another module's tables directly. Use service contracts for synchronous decisions and outbox events for durable downstream work.

## 2. MVP product model

### Ticket types

An organizer with active event-management permission may create ticket types for an eligible published event. A ticket type belongs to exactly one event and defines:

- Customer-facing name, description, admission class/zone, and included benefits.
- Face price and currency, with a versioned price snapshot captured on each order item.
- Total sellable capacity (or explicitly unlimited only when venue/event policy allows it).
- Sales start/end instants, stored in UTC and displayed in the event's IANA timezone.
- Per-order minimum/maximum quantity.
- Whether the ticket is transferable.
- Whether the ticket is individually assigned to an attendee at purchase or may initially be held by the purchaser and assigned later.
- Cancellation/refund eligibility reference to the applicable policy version; execution remains outside Ticketing.
- Optional sales channel/visibility constraints, including private-event access requirements.

Do not make a ticket category depend on price. Two ticket types may have the same price but different benefits or admission zones. A price or benefit change after sales begin must create a new immutable version or a new ticket type; existing order items retain the exact purchased snapshot. Do not silently rewrite what an existing customer bought.

### Ticket inventory

For the MVP, use a quantity pool per ticket type. Capacity is the maximum number of sellable tickets, not a client-editable available quantity. Available quantity is derived from capacity less active holds and issued/non-released tickets, with the exact accounting invariant enforced transactionally.

Capacity reductions below already-held plus issued quantity are rejected. Increasing capacity is an audited organizer action. A sold-out ticket type becomes purchasable again only when a valid hold expires/releases or a ticket is cancelled/revoked and the policy makes its capacity reusable.

Reserved seating, seat maps, section-level seat assignment, dynamic pricing, waitlists, resale, and external ticket inventory synchronization are out of MVP scope. If the event requires assigned seats, do not misrepresent a general-admission quantity pool as a seat reservation.

## 3. Inventory holds and checkout boundary

- Commerce requests a hold from Ticketing before it commits a ticket order item.
- Holds are short-lived, bound to a user and checkout/order context, and include ticket type, quantity, expiry, and state.
- Proposed default hold lifetime: 10 minutes, configurable within platform limits. The checkout deadline must be displayed before payment.
- Hold creation uses a database transaction and row-level locking or an equivalent atomic conditional update. Concurrent requests must never allocate more than remaining capacity.
- A hold is consumed exactly once when the corresponding order item is eligible for fulfilment after verified payment (or confirmed free checkout).
- Failed, abandoned, cancelled, or expired checkout releases the hold exactly once.
- Payment may arrive late after a hold has expired. The system must not silently issue beyond capacity; Commerce/Payments must enter an explicit exception/reconciliation path (refund or manual resolution under platform policy), not create an oversold ticket.
- The browser cannot extend, consume, or release a hold by changing client state.
- Expiry is enforced synchronously on every allocation decision; a background worker is for cleanup and notifications, not correctness.
- Repeated checkout/payment callbacks are idempotent and cannot duplicate holds, order items, tickets, or inventory consumption.

A checkout containing multiple ticket types must either reserve all requested ticket quantities atomically or fail without leaving a partial hold. Mixed ticket + hospitality checkout belongs to Commerce orchestration and must coordinate independent domain holds with a compensating release strategy; it must not create a false atomicity claim across independent services.

## 4. Access and purchase eligibility

Before a hold is created, the service must re-check:

1. The event exists, is published, not cancelled/completed, and sales are not paused.
2. The ticket type belongs to that event, is active, and is inside its sales window.
3. The user account is active.
4. Event Access currently authorizes checkout for this user/event when event visibility/access policy requires it. Re-check on every new checkout; do not trust a prior page view or client-supplied grant.
5. The ticket type's per-order limits, event capacity rules, age/eligibility restrictions, and any applicable moderation restrictions are satisfied.
6. Inventory is available under the transactional allocation rule.

A grant never bypasses ticket capacity, price, payment, age, event rules, or admission checks. Access grant revocation after a ticket has already been purchased does not automatically erase a paid ticket; ticket cancellation/refund follows the separate platform policy and audited workflow.

## 5. Order and ticket issuance

Commerce owns Checkout, Order, and OrderItem. Ticketing exposes fulfilment operations for a ticket order item.

- The order item snapshots ticket type/version, event, quantity, unit face price, currency, benefits, and applicable policy references.
- Payment success must be verified server-to-server by Payments and linked to the exact order/item allocation.
- Ticket issuance is idempotent per fulfilled order-item unit. Retried events cannot issue duplicates.
- For quantity greater than one, each attendee credential is a distinct ticket record, even if the purchaser initially holds all tickets.
- Free tickets still require an order/registration record, inventory hold/consumption, eligibility checks, and duplicate prevention. Free does not mean unlimited or untracked.
- A paid order awaiting verified payment has no active admission ticket.
- A partial payment or partial capture cannot fulfil more quantity than the verified amount and allocation explicitly authorize.
- A payment reversal, chargeback, or completed refund triggers a Ticketing decision/workflow that can suspend or revoke the affected ticket; a provider webhook alone must not mutate tickets without Payments verification and a durable internal event.
- Ticket issuance emits an outbox event for notifications, attendee projections, and Connect eligibility. Consumers are idempotent.

## 6. Ticket lifecycle

Proposed ticket statuses:

- ISSUED: valid admission credential, not yet admitted.
- CHECKED_IN: successfully admitted; terminal for ordinary admission.
- CANCELLED: cancelled under an authorized policy/workflow.
- REFUNDED: fully refunded and no longer valid for admission.
- REVOKED: invalidated for a documented platform, fraud, safety, chargeback, or policy reason.
- EXPIRED: event admission window ended without use, where retained as an explicit lifecycle outcome.

Do not allow arbitrary status updates from organizers or clients. State transitions require a named service command, actor/authority, reason where relevant, audit record, and outbox event. Ticketing must preserve history; it must not delete a ticket after issuance.

Partial refunds need an explicit quantity/benefit allocation: refunding one ticket in a multi-ticket order must not invalidate unrelated tickets. Partial monetary refunds against one ticket do not automatically mean admission is revoked; the refund policy must say whether the ticket remains valid or is revoked.

## 7. Ticket holder assignment and transfer

Recommended MVP: purchaser may buy multiple tickets and initially hold them, but each ticket must have one current holder before check-in. A purchaser may assign a ticket to an existing Events account; do not expose another attendee's private profile details.

- Assignment/transfer is an explicit acceptance workflow, not a buyer-side overwrite of holder ID.
- A transfer request is bound to one ticket and one recipient account; recipient must authenticate and accept.
- Proposed default: recipient must have an active Events account with verified email before acceptance. External email/phone delivery and unregistered recipient claims are deferred.
- Transfer is available only while ticket is ISSUED, before event admission cutoff, and only if ticket type allows it.
- Only one pending transfer per ticket. New transfer requests supersede/cancel prior pending requests with an audit trail.
- Acceptance atomically changes current holder and retains immutable transfer history. The old holder's QR credential becomes invalid; the new holder receives a new credential.
- The purchaser is not automatically entitled to reclaim a ticket after a recipient accepts it.
- Organizer-initiated attendee reassignment, ticket resale, peer-to-peer payments, transfer fees, and identity-document checks are out of MVP scope.

If product wants purchaser-held group tickets to be scannable without naming attendees, the policy must explicitly permit holder presentation. Do not let an unassigned ticket be treated as multiple independent admissions.

## 8. QR credentials and admission operations

- Each issued ticket receives a cryptographically random, high-entropy credential. Persist only a one-way digest; never store or log the raw bearer credential.
- The QR payload must not contain a sequential ticket ID, email, phone, or other personal information.
- Credential validation is server-side and checks ticket status, current holder/assignment policy, event, event schedule/admission window, and successful prior check-in.
- A successful check-in is atomic and unique per ticket by default. Two devices scanning the same ticket concurrently must produce at most one successful admission.
- Duplicate scans return a clear already-used result and must not create another admission.
- Proposed MVP: online validation only. Offline scanning, delayed sync, and cross-device offline conflict resolution are deferred; do not imply that screenshots or offline QR scans are secure.
- Event OWNER/ADMIN and explicitly assigned event staff may check in attendees through scoped permissions. A generic organization MEMBER has no automatic scan authority.
- Staff access is event-scoped, time-bounded where possible, auditable, and revocable. Platform admins retain oversight but are not the routine door staff.
- Record scan attempts (accepted, duplicate, invalid, revoked, wrong event, outside admission window) with ticket/event, staff/device identity, timestamp, and minimal diagnostic metadata. Avoid retaining unnecessary location/device fingerprint data.
- Re-entry is disabled by default. If an event requires re-entry, it must be an explicit event/ticket policy with a bounded number of entries and an auditable exit/re-entry process.

## 9. Ticket entitlements and redemption

Ticket entitlements are benefits included with admission, not independent payment records. Examples: meal voucher, merchandise pickup, workshop access, or a specified included service.

- Entitlements are defined/versioned with the ticket type and snapshotted on the purchased order item/ticket.
- Each entitlement has quantity, validity window, redemption location/role, and single-use or bounded-use policy.
- Redemption is atomic, ticket-linked, staff-authorized, and auditable. A token or benefit cannot be redeemed more times than its purchased quantity.
- Refund/cancellation/revocation applies the entitlement reversal policy; already consumed benefits are not silently restored.
- Hospitality inventory, room/table bookings, and supplier fulfilment remain Hospitality-owned. A ticket entitlement may refer to a Hospitality fulfilment workflow but does not create a room/table reservation by itself.

## 10. Refund, cancellation, and event-change boundaries

Events retains final authority over platform-governed refunds. Ticketing supplies ticket/order-item facts and executes the admission consequence after Payments confirms the refund outcome. Ticketing does not decide or execute money movement.

- Customer cancellation follows the disclosed ticket policy and applicable law.
- Event cancellation starts a coordinated cancellation/refund workflow for affected order items.
- Postponement/material schedule change offers the options defined by the approved customer policy; do not automatically preserve or cancel tickets without recording the customer's/authority's outcome.
- Full refund normally invalidates the affected ticket; partial refund follows an explicit item/quantity policy.
- A ticket already checked in requires an explicit exception path; do not silently issue a refund while leaving the ticket's admission history ambiguous.
- Chargebacks, payment reversals, suspected fraud, safety incidents, and platform takedowns can place a ticket into a restricted/revoked state under documented authority.
- Refund allocation, payment-provider refund attempts, ledger entries, organizer liabilities, and payout adjustments belong to Payments/Finance.

## 11. Suggested data model (conceptual)

Ticketing-owned records:

- TicketType and TicketTypeVersion (or immutable ticket type snapshots) — offer, sales window, price/benefits and rules.
- TicketInventory — capacity and inventory accounting for the quantity pool.
- TicketHold — user/order context, quantity, expiry, state, idempotency key.
- Ticket — one issued credential per admission unit, current holder, status, order-item source, credential digest.
- TicketTransfer — pending/accepted/declined/expired/cancelled transfer history.
- TicketCheckIn — append-only scan attempts and admission outcomes.
- TicketEntitlement and EntitlementRedemption — included benefits and auditable use.
- EventStaffAssignment — scoped operational permissions if existing organization roles are insufficient.

Commerce-owned records remain Checkout, Order, OrderItem, and pricing snapshots. Payments owns Payment and PaymentAttempt. Finance owns allocations, ledger, refunds accounting, and settlement. Avoid duplicate shadow copies of payment status or order totals inside Ticketing.

## 12. Suggested service/API contracts

Exact routes may be adjusted to existing API conventions during implementation. Proposed capabilities:

Organizer:
- Create/update/archive ticket types and ticket type versions.
- Configure capacity and sales windows with validation against held/issued quantities.
- View ticket inventory summary and sales/issuance reports.
- Assign/revoke event staff check-in permissions.

Attendee:
- List ticket types available to the current user after event visibility/access checks.
- Create/update/release a checkout hold through Commerce orchestration.
- List own tickets and ticket details.
- Assign/transfer a ticket to a registered account; accept/decline a transfer.
- View QR credential through an authenticated, non-cacheable endpoint.
- Request cancellation/refund through the platform refund workflow; Ticketing does not approve money movement.

Admission staff:
- Validate/scan a credential for a specific event.
- View scan outcome and minimal ticket display data.
- No access to payment instruments, unrelated order items, or full attendee account details.

Internal service contracts:
- reserveInventory, consumeHold, releaseHold, issueTicketsForOrderItem, suspendOrRevokeTicket, validateCredentialAndCheckIn, transferTicket, redeemEntitlement.
- All commands require idempotency keys or deterministic source-event identities.

## 13. Required invariants and tests

1. Concurrent holds never exceed ticket type capacity.
2. A multi-type checkout reserves all ticket quantities or none.
3. Expired/released/consumed holds cannot transition twice.
4. A ticket cannot be issued before verified payment or confirmed free checkout.
5. Duplicate payment/outbox delivery cannot issue duplicate tickets.
6. A ticket has exactly one current holder; transfer acceptance is atomic and old credentials stop working.
7. Only one successful check-in exists per ticket by default, including concurrent scans from multiple devices.
8. Revoked/refunded/cancelled tickets cannot check in.
9. A ticket type capacity cannot be reduced below active holds plus issued inventory.
10. Event Access, account status, event lifecycle, moderation, and sales window are rechecked at the required boundaries.
11. A partial refund/cancellation affects only the explicitly allocated ticket(s).
12. Every state transition writes audit and outbox records atomically.
13. Public discovery and scan responses do not leak attendee contact/payment details.
14. Entitlement redemptions cannot exceed purchased quantities.
15. Migration tests apply the complete schema to a fresh PostgreSQL database.

## 14. Explicitly deferred

- Payment provider selection, collection, capture, refunds execution, and ledger posting.
- Final fees, commissions, taxes, organizer charging model, and settlement rules.
- Assigned seating, seat maps, dynamic pricing, waitlists, ticket resale, and transfer fees.
- Offline QR scanning and conflict resolution.
- External ticket inventory integrations.
- Hospitality inventory and combined ticket/hospitality checkout implementation.
- Bulk guest lists, unregistered recipient claims, and identity-document KYC.
- Advanced fraud scoring and device fingerprinting.

## 15. Product-owner decisions required before implementation

The following defaults are recommended for MVP. Approving them will authorize the Ticketing & Admission schema, APIs, transactional inventory workflows, and PostgreSQL integration tests only. It will not authorize a payment provider, financial ledger, refund engine, or settlement implementation.

1. **Inventory model:** approve general-admission quantity pools per ticket type; no assigned seating, waitlists, resale, or external inventory in MVP.
2. **Hold duration:** approve a 10-minute default hold, configurable within platform limits; expire/release synchronously for correctness.
3. **Payment and issuance:** approve that paid tickets issue only after server-verified successful payment; free tickets use a confirmed, inventory-backed free order.
4. **Group purchases:** approve purchaser-held multiple tickets initially, with each ticket assigned to one current holder before check-in; assignment to another attendee requires registered-account acceptance.
5. **Transfer policy:** approve transfers only for eligible ISSUED tickets before admission cutoff, with recipient acceptance and regenerated QR credential; no resale or transfer fee in MVP.
6. **Admission security:** approve online-only QR validation, one successful check-in per ticket, re-entry disabled by default, and event-scoped staff permissions.
7. **Refund consequences:** approve that full refund/cancellation invalidates the affected ticket after Payments confirms the outcome; partial refunds must identify exact ticket/quantity impact; checked-in tickets require exception review.
8. **Ticket benefits:** approve versioned ticket entitlements with quantity/time limits and atomic redemption; hospitality reservations remain a separate fulfilment record.
9. **Ticket price changes:** approve immutable purchase snapshots; price/benefit changes after sales start create a new version and never alter prior purchases.
10. **Currency:** approve NGN as the initial launch currency while keeping currency explicit on every price/order snapshot; multi-currency remains deferred.

If any default is rejected, revise this design before schema implementation. Legal, consumer-protection, tax, and payment-provider requirements must be validated for the actual Nigerian operating model before launch.
