# Vybe — Experiences Marketplace Design Gate

**Status:** Product design approved incrementally; provider foundation merged; catalogue foundation implementation in progress  
**Customer-facing brand:** Vybe  
**Domain owner:** Vybe  
**Depends on:** Identity & Access, Organizations, Events, Event Access  
**Integrates with:** Ticketing & Admission, Commerce, independent Payments, Finance, Notifications, Operations & Trust  
**Implementation authorization:** Provider governance is implemented. The catalogue foundation is authorized for provider-owned drafts, immutable published versions, public discovery of eligible listings, and platform-controlled staged category activation. Inventory, availability, reservations, bookings, payments, and fulfilment remain separate later slices.

Vybe is the platform's experiences and bookings marketplace. It covers accommodation, dining, drinks, tables, lounges, VIP experiences, and other bookable services. It is not a hotel-management module and must not be designed around one generic reservation shape.

The root README remains the product decision source of truth. This document expands approved product policies and marks proposed defaults and unresolved decisions explicitly.

## 1. Product purpose and scope

Vybe enables customers to discover, reserve, pay for, and fulfil bookable experiences supplied by organizers and approved providers. A booking may be:

- **Event-linked:** offered because of a particular event, such as a nearby hotel stay, VIP table, event catering, or drinks package.
- **Standalone:** independently useful without purchasing or attending an Events ticket, such as a hotel stay or restaurant reservation.
- **Event add-on:** selected alongside a ticket or added later. The experience remains Vybe-owned; Ticketing does not create or own its inventory.

Vybe supports attendee-led purchases and organizer-arranged purchases. The party placing the order is the payer unless an explicitly approved commercial arrangement says otherwise. Attendees pay for their selected items; organizers pay for hospitality they arrange for an event.

Customer outcomes:
- Discover by location, date/time, category, availability, price, and event context.
- Understand inclusions, exclusions, supplier, location, restrictions, confirmation mode, and cancellation terms before committing.
- See whether a booking is held, awaiting payment, awaiting provider confirmation, confirmed, or fulfilled.
- Manage changes, cancellations, support requests, and refunds at booking-item level.

Provider outcomes:
- Apply for separate Vybe provider approval.
- Publish only inventory they own, control, or are contractually authorized to sell.
- Allocate and manage capacity, schedules, prices, restrictions, and fulfilment instructions.
- Receive booking commitments and fulfilment tasks with only necessary customer data.

## 2. Domain ownership and boundaries

Vybe owns provider profiles and Vybe-specific approval, offerings and immutable offering versions, inventory pools/resources/allocations, availability, holds, reservations/bookings, provider confirmation, fulfilment tasks, redemption records, and provider-side operational evidence.

Vybe does not own:
- User identity, sessions, or organization membership (Identity & Access / Organizations).
- Event lifecycle, visibility, or access grants (Events / Event Access).
- Ticket types, ticket inventory, issuance, or admission (Ticketing & Admission).
- Cart, checkout orchestration, order totals, and order items (Commerce).
- Payment-provider integrations, payment attempts, collection verification, or refund execution (independent Payments).
- Authoritative ledger, commissions, settlement eligibility, or payouts (Finance).
- Central support ownership, platform moderation, or audit infrastructure (Operations / Platform).

### 2.1 Integration rules

1. No module reads or writes another domain's tables directly.
2. Vybe exposes versioned service contracts for quote, availability, hold, consume, release, provider acceptance, cancellation, and fulfilment.
3. Vybe emits durable domain events through the transactional outbox.
4. Commerce coordinates mixed checkout. Ticketing and Vybe hold their own inventory; this is a saga with compensating release, not one cross-domain database transaction.
5. Payments reports verified payment outcomes against stable order/payment references. Vybe never trusts browser redirects or provider callbacks directly.
6. Finance consumes commercial facts and owns accounting. Vybe must not maintain mutable provider balances.
7. A failed notification cannot roll back a committed booking. A payment success cannot conceal a failed inventory commitment; that condition enters an explicit exception/refund path.

## 3. Provider eligibility and governance

### 3.1 Provider identity and approval

A provider profile is associated with an existing Organization. Do not create duplicate organizations because an organizer also supplies rooms, food, drinks, tables, or experiences.

Organizer approval does not grant Vybe provider approval. Every supplier must pass separate Vybe approval before publishing reservable inventory. **Approved default (VYBE-008): risk-based, category-scoped provider approval; no blanket heavy KYC for every provider.**

The baseline application should establish:
- A real, reachable applicant and verified account/contact channel.
- The applicant's authority to act for the existing Organization (or the applicable sole-provider identity model, if later approved).
- The categories, locations, and services the provider wants to offer.
- A clear attestation and proportionate evidence that the provider owns, controls, or is contractually authorized to sell the proposed inventory.
- Acceptance of provider obligations, customer-service expectations, cancellation/fulfilment rules, and platform terms.

Additional evidence is required only where category risk, the particular service, credible risk signals, or applicable law makes it necessary. Examples may include relevant operating licences, food-safety evidence, alcohol-service permissions and age-control procedures, accommodation/venue safety evidence, insurance, or specialist qualifications. These are conditional examples, not a universal document checklist. Nigerian legal/compliance review must determine the actual mandatory evidence by category and location before that category launches. Do not collect identity, company, or compliance documents merely because they are available; record the reason each evidence item is required.

Approval is scoped to the reviewed Organization, provider profile, categories/services, and any applicable locations or conditions. Approval records must retain evidence references (not expose sensitive documents to ordinary staff), reviewer, decision and reason, scope, conditions, timestamps, expiry/review triggers where applicable, and suspension/revocation history. Reviewers must be independent of the applicant; providers cannot approve themselves. Missing or expired mandatory evidence blocks the affected category, not automatically every unrelated approved category.

A provider must not publish reservable inventory until the relevant scope is approved. Organizer status and event-publishing permissions remain independent. Suspending/revoking Vybe approval blocks new listings and reservations within the affected scope; it must not silently cancel existing confirmed bookings. Existing commitments enter a managed continuity, replacement, or cancellation workflow with customer communication and item-level outcomes. Emergency restrictions may be applied immediately where safety, fraud, legal, or customer-harm risks justify them, with an auditable reason and review path.

### 3.2 Permissions

- Organization OWNER/ADMIN may manage Vybe profile and offerings only with active Vybe approval.
- Other members receive explicit category/operation permissions (catalogue, inventory, fulfilment, support evidence).
- Event staff permissions do not automatically grant Vybe provider permissions.
- Platform reviewers may approve, restrict, suspend, or revoke providers with reason and audit history.
- Providers cannot approve their own applications or alter review outcomes.
- Provider staff see only data required for assigned tasks.

### 3.3 Provider obligations

Before publishing, a provider attests that it owns, controls, or is authorized to sell the inventory; capacity and availability are accurate; terms are lawful and disclosed; and it can fulfil accepted bookings. Licences, age restrictions, safety, insurance, food handling, alcohol service, and accommodation checks depend on category and applicable law. Obtain Nigerian legal/compliance review before launch.

## 4. Catalogue and offering model

A listing is a customer-facing description, not inventory and not proof of availability. A published offering should define:

- Provider and responsible fulfilment organization.
- Category/subtype, title, description, media, inclusions and exclusions.
- Location/service area and event association (if any).
- Capacity/occupancy and eligibility restrictions.
- Reservation model and inventory source.
- Price, currency, pricing unit, and immutable published terms version.
- Availability schedule and booking window.
- Cancellation, modification, no-show, and refund policy reference/version.
- Provider-confirmation requirements, if applicable.
- Fulfilment method, instructions, and service window.
- Publication, moderation, and availability status.

Price is not a category identifier. Material changes to price, inclusions, capacity, cancellation terms, or fulfilment promise create a new version; existing bookings retain their purchased snapshot.

### 4.1 Catalogue families

| Family | Examples | Scarce resource |
|---|---|---|
| Accommodation | Hotels, apartments, rooms, room categories | Room-night pool or specifically assigned room |
| Dining | Restaurant reservations, dining packages, catering | Table/time capacity, seats, or prepared quantity |
| Drinks | Beverage packages, bottle service, drink bundles | Quantity pool and service capacity/window |
| Tables & lounges | VIP tables, lounges, cabanas | Specific resource or capacity pool over a time slot |
| VIP & premium experiences | Hosted experiences, premium access | Capacity/slots; admission remains Ticketing-owned |
| Other services | Transport, styling, photography, event support | Category-specific resource and fulfilment constraint |

**Approved rollout (VYBE-001): staged.** Vybe supports all six families architecturally, but a family or subcategory becomes bookable only after its operational launch gates are met. This is a phased activation strategy, not a permanent reduction of product scope. Shared descriptive metadata is acceptable; flattening every inventory type into one generic quantity counter is not.

Before activating any family, require: (1) an approved provider and verified authority to sell; (2) a secured, correctly modelled inventory source; (3) enforceable capacity/availability and concurrency controls; (4) published pricing, inclusions, restrictions, cancellation and fulfilment terms; (5) trained operational ownership for provider/customer support and exceptions; and (6) category-appropriate safety, licensing, privacy and compliance review. A category must remain disabled if any critical gate is unmet.

| Family | Minimum family-specific activation gate |
|---|---|
| Accommodation | Room-category definitions, per-night allocated capacity, occupancy limits, check-in/out rules, and a tested overbooking/reaccommodation process |
| Dining | Service periods, table/seat or prepared-quantity capacity, party-size rules, and turnaround/buffer handling where relevant |
| Drinks | Quantity and service-window controls, responsible-service procedures, and required age/licensing controls |
| Tables & lounges | Defined resources or capacity pools, occupancy limits, reservation time windows, and overlap prevention |
| VIP & premium experiences | Explicit inclusions/exclusions, capacity or slots, eligibility rules, and clear separation from Ticketing-owned admission |
| Other services | A documented category-specific scarce resource, booking constraint, fulfilment proof, and exception process before listing is enabled |

### 4.2 Event association

An offering may be event-specific, associated with an event but independently useful, or provider-wide/standalone. Retain whether each booking is event-dependent or independently valid. Event cancellation must not automatically cancel a standalone booking merely because it was discovered through an event page.

## 5. Inventory models and availability

The inventory model must represent the actual scarce resource.

### 5.1 Quantity pools

For drinks, packages, meal vouchers, and interchangeable units. Active holds plus committed units must never exceed sellable capacity for the relevant pool/window.

### 5.2 Time-slot capacity

For dining, tables, lounges, and timed experiences. Prevent overlapping reservations from exceeding capacity. Use UTC instants and the location's IANA timezone for display. Define turnaround/buffer time where preparation or cleaning is required.

### 5.3 Accommodation room-night pools

The default is room-category and quantity selection; the provider may assign the physical room later unless specific-room selection is explicitly offered. Every night in the stay must be available. Reject a booking if any night is unavailable. Concurrent requests must not oversell any nightly allocation.

### 5.4 Specific resources

Use only when a customer is promised a particular room, table, lounge, vehicle, or other identifiable resource. Reject overlapping exclusive allocations. Do not force specific-room assignment into the default room-category pool.

### 5.5 Inventory source classification

Every offering declares one source:

1. **Platform-allocated/controlled:** provider explicitly allocates defined quantity/resources to Vybe; Vybe controls holds and commitment inside that allocation.
2. **Certified external integration:** fresh availability plus a real atomic reservation/hold operation, idempotency, confirmation/cancellation outcomes, and reconciliation for delayed/missed callbacks.
3. **Provider-confirmed/manual:** availability cannot be guaranteed at checkout; booking remains pending until provider acceptance.

Read-only availability APIs, spreadsheets, chat messages, stale caches, or a general promise to update stock do not qualify for instant confirmation.

### 5.6 Hotel allocation

Launch default is allocated inventory. A hotel allocates selected room categories and quantities to Vybe for an agreed validity period; the hotel may sell unallocated inventory independently. Vybe consumes only its allocation.

Allocation records need effective dates, room category, quantities by night/period, provider acknowledgement, operational owner, and reconciliation history. The release/cut-off policy for unused allocation remains unresolved. Do not assume unused rooms automatically return to the hotel's sale pool.

### 5.7 Safe availability

- Displayed availability is indicative until a hold or reservation commitment succeeds.
- Do not advertise inventory that has not been secured or contractually allocated.
- Do not combine unsynchronized sources into one sellable pool.
- Fail closed when availability is stale or reservation cannot be verified.
- Enforce hold expiry synchronously during allocation; background jobs are cleanup only.
- Capacity reductions cannot invalidate active holds or confirmed bookings.
- Manual inventory changes require permission, reason, actor, timestamp, and audit record.

## 6. Reservation and booking lifecycle

Listing publication, inventory allocation, booking, payment, provider confirmation, and fulfilment are separate facts.

### 6.1 Controlled/synchronized inventory

Proposed lifecycle: **AVAILABLE → HELD → PAYMENT_PENDING → CONFIRMED → FULFILLED**.

Other outcomes include EXPIRED, CANCELLED, REFUND_PENDING, REFUNDED, and DISPUTED/UNDER_REVIEW.

- A hold is short-lived, idempotent, and tied to a user/checkout context.
- Proposed default hold duration: 10 minutes, configurable within platform limits. This aligns with Ticketing but requires Vybe-specific approval.
- Verified payment causes idempotent hold consumption and booking confirmation.
- Failed, abandoned, or expired checkout releases the hold exactly once.
- If verified payment arrives after hold expiry or inventory release, do not oversell; enter an exception/refund/reaccommodation workflow.
- Confirmation is a provider commitment; fulfilment occurs later.

### 6.2 Provider-confirmation exception

Proposed lifecycle: **PENDING_PROVIDER → ACCEPTED → CONFIRMED → FULFILLED**, with REJECTED, EXPIRED, CANCELLED, REFUND_PENDING, and REFUNDED outcomes.

The customer must see pending status and the expected provider response window. Do not show confirmed or issue a confirmation credential before provider acceptance and satisfaction of the agreed payment condition.

**Unresolved:** authorize payment, capture payment, collect after provider acceptance, or use another Payments-supported pattern while awaiting provider response. Decide jointly with the independent Payments design; do not choose a provider-specific mechanism here.

### 6.3 Invariants

- One booking item refers to one offering/version and relevant inventory allocation.
- Quantity, price/specification, inclusions, and policy snapshots are immutable.
- A booking confirmation is not proof of fulfilment.
- Provider acceptance cannot bypass payment conditions or capacity.
- Payment success cannot bypass inventory commitment.
- Repeated payment/provider/job events cannot duplicate a booking or consume inventory twice.
- Every transition records actor/source, timestamp, reason where required, audit record, and outbox event.

## 7. Checkout, Commerce and Payments

Vybe must not implement its own cart/order/payment-provider stack.

Commerce owns cart, checkout, order, order items, payer identity, totals, and purchase orchestration. Vybe exposes quote, validate, hold, consume, release, and fulfilment operations. Order items snapshot offering/version, provider, quantity, unit amount, currency, inclusions, event association, inventory source, cancellation policy/version, and fulfilment promise.

A mixed ticket + Vybe checkout is coordinated by Commerce across independently owned holds. If any required hold fails, Commerce compensates by releasing prior holds. If payment succeeds but an item cannot be committed, enter a deterministic exception path and refund/reverse the affected amount through Payments; never silently keep payment while dropping an item.

Payments is an independent reusable platform service. Vybe consumes verified outcomes and does not store provider secrets, own provider-specific payment state, execute refunds, calculate balances, or treat a redirect/unverified webhook as success. Partial collection/refund semantics must be defined by Commerce/Payments before Vybe relies on them.

Free bookings still consume inventory and create traceable order/booking records. For organizer-paid bookings, record the organizer as payer and the attendee/guest as beneficiary separately.

## 8. Pricing and customer disclosure

Pricing and monetization are separate from inventory and provider approval.

- Pricing units must be explicit: per room/night, table/session, person, package, or item.
- Currency is explicit on every price/order snapshot. NGN is the initial platform currency unless a later approved multi-currency design changes this.
- No commission, provider fee, customer fee, organizer subscription, or module price is approved here.
- Provider terms and any applicable platform charges must be disclosed and snapshotted before purchase.
- Full payment before provider commitment is the current default. Deposits/staged payments are allowed only where the provider explicitly agrees.
- Customers see inclusions/exclusions, service date/time, location disclosure, capacity, restrictions, provider, cancellation terms, and whether confirmation is instant or pending.
- Material price/terms changes apply only to new purchases.

## 9. Cancellation, refunds, event changes and disputes

Events retains final authority over platform-governed refunds, subject to law and mandatory customer rights. Vybe supplies booking, inventory, provider, and fulfilment facts. Payments executes approved money movement. Finance records financial consequences.

### 9.1 Customer cancellation

Each category needs an explicit policy: cutoff, permitted changes, no-show treatment, refund amount/method, and provider conditions. Retain the policy version shown at purchase.

**Unresolved:** standard cancellation windows and category-level refund defaults. Do not invent one universal rule for hotels, dining, drinks, and timed experiences.

### 9.2 Provider cancellation/failure

Provider inability to fulfil a confirmed booking triggers a tracked resolution: equivalent replacement, customer-approved alternative, or refund under policy. Providers cannot silently cancel or substitute a materially different experience.

### 9.3 Event cancellation/postponement

Assess each linked booking item; do not blanket-cancel an order.

- Event-dependent bookings normally follow the applicable event-cancellation policy.
- Independently useful bookings may remain active if the customer chooses and supplier terms permit.
- Partner bookings are coordinated under disclosed supplier terms.
- Record continuation, replacement, cancellation, and refund outcome per item.
- Notify customers of options and any response deadline.

**Unresolved:** response deadline for customers choosing to retain an independently valid booking, and the fallback if no response arrives.

### 9.4 Refund after settlement

Retain original payable and settlement references so Finance can determine liability and recovery. Vybe must not create a negative provider balance or net future bookings without an approved Finance policy.

**Unresolved:** who bears refund costs after provider/organizer settlement and the contractual recovery mechanism.

### 9.5 Disputes

Record affected booking item, customer claim, provider evidence, timeline, fulfilment evidence, support decision, and refund outcome. A dispute must not silently rewrite booking or payment history.

## 10. Fulfilment, redemption and operational controls

Fulfilment is category-specific and separate from reservation confirmation.

- Accommodation: check-in, occupancy verification, room assignment, check-out, incident handling.
- Dining: seating, timed service, party size, late arrival/no-show.
- Drinks: preparation/handover, quantity validation, age/licensing checks.
- Tables/lounges: arrival validation, time window, capacity, package inclusions.
- Experiences: attendance/service completion, provider assignment, safety and eligibility.

A fulfilment record identifies booking item, fulfilment type, assigned provider/staff, due window, state, evidence/reference, timestamps, and exception reason. Staff act only on assigned or appropriately scoped bookings.

Multi-unit benefits require atomic, quantity-bounded, booking-linked redemption. Corrections are separate audited actions; never delete redemption history.

## 11. Security, privacy and safety

- Providers see only data necessary to fulfil bookings.
- Customers' personal details are not exposed to unrelated providers/customers.
- Private event venue details remain subject to Event Access and venue-disclosure rules; Vybe cannot leak restricted addresses.
- Enforce age restrictions, alcohol licensing/responsible service, food and accommodation safety, accessibility, and category-specific law.
- Provider staff access is scoped, revocable, and audited.
- Inventory changes, manual confirmations, substitutions, refund evidence, and fulfilment overrides require audit records.
- Support abuse, fraud, fake listings, inventory manipulation, no-show patterns, and unsafe-provider reporting.
- Obtain Nigerian legal/compliance review for the actual supplier and marketplace model before launch.

## 12. Proposed service surface and domain events

Conceptual operations (not final endpoint names): validate provider/offering; resolve terms version; quote; check availability with freshness metadata; create/consume/extend/release hold; create/accept/reject provider-confirmation request; confirm/cancel booking; assign/complete fulfilment; record/correct redemption.

Candidate events:
- vybe.provider.approved / suspended / revoked
- vybe.offering.published / updated / unpublished
- vybe.inventory.allocated / changed / reconciled
- vybe.hold.created / expired / released / consumed
- vybe.booking.pending_provider / confirmed / cancelled
- vybe.booking.fulfilment_started / fulfilled / disputed
- vybe.redemption.recorded / reversed

Events require stable IDs, schema version, occurrence time, correlation/causation IDs, minimal payload, and idempotent consumers. Do not publish unnecessary customer data.

## 13. Conceptual data model

Conceptual entities only; no physical schema authorization:

- VybeProvider and ProviderApprovalCase.
- Offering and immutable OfferingVersion.
- Typed InventoryPool / InventoryResource.
- InventoryAllocation and AvailabilityWindow.
- InventoryHold.
- Booking and BookingItem.
- ProviderConfirmation.
- FulfilmentTask.
- Redemption.
- InventoryAdjustment.

Avoid weak polymorphic inventory shortcuts that prevent database enforcement of room-night overlaps, time-slot conflicts, or quantity-pool limits. Typed inventory structures may share common identifiers, but integrity constraints must remain explicit.

## 14. Recommended delivery slices

After policy approval:

1. Provider profile, separate approval, permissions, audit/outbox.
2. Catalogue, immutable versions, controlled quantity inventory, atomic holds/expiry.
3. Time-slot inventory for dining, tables, lounges and timed experiences.
4. Accommodation room-category allocations, nightly inventory, room assignment and reconciliation.
5. Booking lifecycle and Commerce contract, tested with a fake Payments contract.
6. Provider-confirmation path after payment treatment is approved.
7. Fulfilment and redemption.
8. Cancellation/refund/dispute integration with Payments and Finance.
9. External integrations only after certification and reconciliation are implemented.

No real payment provider should be selected or embedded in Vybe. A test adapter may exercise the eventual Payments contract.

## 15. Decisions required before implementation

| ID | Decision | Proposed direction | Why it matters |
|---|---|---|---|
| VYBE-001 | Launch catalogue scope | **Approved: staged launch.** All six catalogue families remain in the architecture, but activation is phased by provider readiness, inventory controls, operational capacity, and safety/compliance readiness. | Defines MVP inventory models and launch sequencing |
| VYBE-002 | Provider-confirmation payment | Prefer no capture before provider acceptance; evaluate authorization-only or pay-after-acceptance with Payments | Avoids charging for rejected requests |
| VYBE-003 | Unused hotel allocation | Contractual release cutoff with per-night reconciliation | Prevents double-selling |
| VYBE-004 | Room selection | Default room-category/quantity pool; specific-room only when explicitly offered | Determines inventory complexity |
| VYBE-005 | Customer cancellation defaults | Category-specific templates bounded by platform policy and law | Categories have different costs |
| VYBE-006 | Event-cancellation choice deadline | Explicit customer response window and safe no-response default | Avoids indefinite ambiguity |
| VYBE-007 | Refund after settlement | Finance-approved recovery model; no automatic negative balance | Determines supplier contracts/exposure |
| VYBE-008 | Provider approval evidence | **Approved: risk-based, category-scoped review.** Baseline identity/contact, organization authority, service scope, authority to supply inventory, and provider-term acceptance; additional documents only where category risk or law requires them. | Balances onboarding friction and safety |
| VYBE-009 | External inventory certification | **Approved: strict certification.** Instant-bookable external inventory must provide fresh availability, atomic hold/reservation, idempotent operations, reliable confirmation/cancellation outcomes, and reconciliation. Read-only availability is never sufficient for instant confirmation. | Read-only availability cannot prevent overselling |
| VYBE-010 | Vybe hold duration | **Approved: 10 minutes by default**, configurable by category within platform-defined minimum/maximum limits. Expiry is enforced synchronously during allocation; background workers perform cleanup/reconciliation only. | Controls inventory contention without allowing stale holds to block capacity |
| VYBE-011 | Booking changes | Define amendment versus cancel/rebook for date/time/party-size changes | Impacts inventory and refund audit |
| VYBE-012 | Standalone/event-linked discovery | Support both; decide launch prominence | Impacts navigation and event coupling |

### Approval gate

The product owner must approve or amend the proposed directions in Section 15 before implementation. Update the root README and this document together. Then review the physical schema against the domain model and define PostgreSQL concurrency/integration tests before writing Prisma migrations.

---

**Document status:** Vybe branding, staged catalogue rollout (VYBE-001), risk-based category-scoped provider approval (VYBE-008), and strict external inventory certification (VYBE-009) are approved. The Provider Foundation is authorized as the first implementation slice: existing-Organization provider applications, verified-account and organization-authority checks, category/location scope, evidence references with recorded requirement reasons, independent platform review, category approvals, approval conditions/expiry, and audit history. The API records a server-assigned provider-terms version (`vybe-provider-v1`); the exact customer-facing/provider terms must be published and legally reviewed before production application intake is enabled. Provider document storage, listing publication, inventory, bookings, fulfilment, Commerce, Payments, and Finance implementation are outside this slice. Remaining marketplace policies must be resolved before their corresponding implementation.


## 16. Catalogue foundation implementation boundary

The first catalogue implementation slice introduces provider-owned offering drafts, category-specific validated descriptive content, immutable published offering versions, and public discovery of currently eligible published versions. It does not represent sellable inventory or real-time availability.

Publication requires both an active category-scoped provider approval covering the offering location and an active category launch gate. Launch-gate activation is a platform-admin attestation with a complete, evidence-referenced checklist for the shared and category-specific operational controls defined in section 4.1. Categories remain inactive by default. Deactivation immediately removes that category's offerings from public discovery; it does not modify historical published versions.

Material edits after publication create a new draft version. Publishing the new version advances the offering's current published version; previous published versions remain immutable so future bookings can snapshot the exact customer-facing terms. The catalogue stores descriptive price and policy terms only; it does not calculate checkout totals, reserve capacity, or guarantee availability.

This implementation slice must not be interpreted as approval to launch a category. A category remains non-bookable until its inventory, capacity, operational, safety, and compliance systems are implemented and verified.
## 17. Inventory foundation design gate (authorized; design only)

### 17.1 Purpose and scope

The next Vybe slice must turn catalogue supply into capacity that can be safely promised. It covers the inventory domain model and invariants for:
- Quantity pools for interchangeable units and packages.
- Time-slot capacity for dining, tables, lounges, and timed experiences.
- Room-category allocations consumed per individual night for accommodation.
- Provider-controlled allocations and certified external inventory boundaries.
- Atomic, idempotent holds, expiry, release, and inventory adjustment.

This is a design gate only. It does not authorize Prisma models, SQL, migrations, endpoints, background workers, or application code. Booking/order orchestration, payment execution, provider-confirmation payment treatment, fulfilment, cancellation/refund execution, and Finance remain separate slices.

### 17.2 Approved hold policy (VYBE-010)

A Vybe inventory hold lasts **10 minutes by default**. The platform may configure a category-specific duration only within platform-defined minimum and maximum bounds. The effective duration and expiry timestamp are fixed when the hold is created; later configuration changes do not silently extend or shorten existing holds. A hold extension, if ever supported, must be an explicit authorized, audited, idempotent operation and must not be assumed in the first implementation.

Expiry must be checked synchronously inside the transaction that attempts to allocate capacity. A scheduled worker may clean up expired records and emit events, but correctness must not depend on that worker running on time.

### 17.3 Supply ownership and allocation

- A provider may list only inventory it owns, controls, or is contractually authorized to sell; this authority is part of the approved provider scope.
- Vybe can sell only capacity explicitly allocated to it or capacity controlled by a certified integration.
- For platform-allocated supply, the provider's unallocated stock remains outside Vybe. Vybe cannot consume it, even if the provider's wider system reports it as available.
- Allocation has a defined provider, offering/resource scope, quantity or capacity, effective interval, acknowledgement/evidence, and operational owner. Changes are auditable and cannot erase existing holds or commitments.
- Allocation increases may add sellable capacity only after authorization and validation. Allocation reductions must not take capacity below active holds plus confirmed commitments; reductions that would breach this invariant are rejected or require a separately approved resolution process.
- Inventory is not created by catalogue publication. An offering without valid, secured supply is not instant-bookable.

### 17.4 Inventory archetypes and capacity rules

**Quantity pools**
- Model a defined sellable quantity for a specific offering/resource and validity window.
- Available capacity is derived from the authorized allocation less active holds and committed quantity.
- Atomic allocation must ensure active holds plus committed quantity never exceed the pool's sellable capacity.
- Holds and commitments are quantity-bounded; release/consumption is idempotent.

**Time-slot capacity**
- A slot has a resource/service scope, start and end instants, local IANA timezone for customer display, capacity, and any required turnaround/buffer.
- Overlapping slots must not bypass the underlying resource capacity. Where the same physical table/lounge/resource is exclusive, conflicting intervals must be rejected.
- Party size or units consume capacity according to the offering's explicit capacity rule; no implicit conversion between seats, tables, and packages.

**Accommodation room-night pools**
- Default selection remains room category plus quantity, not a specific physical room.
- Each reservation consumes the requested quantity on every night in the stay; availability must be validated and committed across the complete stay atomically.
- A single unavailable night rejects the whole allocation attempt. Partial-night allocation is not permitted unless a later product decision explicitly introduces it.
- Physical room assignment may happen later and must not change the purchased room-category snapshot.
- Specific-room inventory is a separate exclusive-resource model and must prevent overlapping stays, including checkout/check-in boundary semantics.

The first implementation should support the shared invariants without pretending every catalogue family is ready to launch. Category activation remains independently gated by operational readiness.

### 17.5 Hold lifecycle and concurrency invariants

For controlled inventory, the conceptual flow is AVAILABLE → HELD → PAYMENT_PENDING → CONFIRMED, with EXPIRED, RELEASED, and CANCELLED outcomes. This describes inventory commitment only; Commerce owns checkout/order orchestration and Payments owns verified payment outcomes.

- Creating a hold reserves capacity atomically and returns a stable hold identifier, effective expiry, and exact inventory/quantity snapshot.
- A repeated request with the same idempotency identity returns the original result; it must not reserve twice.
- Concurrent requests for the final units must result in no more than the authorized capacity being held or committed.
- An expired hold is treated as expired by the allocation transaction even if asynchronous cleanup has not run.
- A hold may be consumed only once and only against the exact inventory scope and quantity it reserved.
- Release, expiry, and consumption are mutually exclusive terminal outcomes; retries cannot double-release or double-consume.
- Payment success alone cannot create a booking or restore expired inventory. If payment is verified after capacity has been released, route to a deterministic exception for Commerce/Payments; do not oversell.
- Confirmed commitments cannot be removed by ordinary inventory edits. Any exceptional resolution requires an explicit policy, actor, reason, audit history, and customer/provider handling.
- All state transitions and allocation adjustments produce auditable records and transactional outbox events.

### 17.6 Inventory source behavior

- **Platform-allocated/controlled:** instant-bookable only within Vybe's acknowledged allocation; holds and commitments are enforced by Vybe's transactional inventory boundary.
- **Certified external integration:** instant-bookable only where the integration provides fresh availability and an atomic reservation/hold operation, idempotency, definitive confirmation/cancellation outcomes, and reconciliation. Vybe must retain external references and reconcile uncertain outcomes before promising capacity.
- **Provider-confirmed/manual:** cannot be represented as instantly available or confirmed. It follows a distinct pending-provider flow and is excluded from this controlled-inventory hold implementation until its payment/acceptance treatment is approved.

Read-only availability, cached counts without atomic reservation, spreadsheets, and manual messages never qualify as controlled instant-bookable inventory.

### 17.7 Required database and test design before implementation

The physical design review must demonstrate enforceable integrity, not rely on application-level read-then-write checks. Before any migration is authorized, the design proposal must specify:
- Transaction boundaries and locking/constraint strategy for quantity pools.
- A database-enforced strategy for overlapping exclusive resources and room-night conflicts.
- Atomic all-night accommodation allocation.
- Idempotency identity and uniqueness boundaries for create, consume, release, and expiry operations.
- How effective capacity is derived from allocation, active holds, and commitments.
- How allocation reductions and provider suspension interact with active holds and confirmed commitments.
- Transactional outbox behavior for inventory changes and hold transitions.
- Time handling: UTC instants for comparisons, IANA timezone for local service interpretation/display.
- Recovery/reconciliation for interrupted transactions, delayed jobs, and uncertain external integration outcomes.

Required PostgreSQL integration tests must include simultaneous requests competing for the last unit; simultaneous multi-unit requests; expiry racing with a new hold; duplicate idempotency requests; duplicate consume/release attempts; allocation reduction against active/confirmed quantities; multi-night accommodation with one unavailable night; overlapping exclusive-resource bookings; timezone/DST boundaries; and outbox publication retry. Tests must assert persisted state and capacity invariants, not merely HTTP status codes.

### 17.8 Explicit exclusions and approval gate

This design gate does not authorize:
- Booking records and customer booking lifecycle.
- Commerce carts, orders, or mixed ticket/Vybe checkout.
- Real Payments integration, payment authorization/capture, refunds, or Finance.
- Provider-confirmation/manual supplier payment treatment.
- Fulfilment, check-in, redemption, cancellations, or disputes.
- External supplier adapters before certification and reconciliation are implemented.

The design PR must update this document and the root README together, state any unresolved decisions, and include a schema/concurrency test plan. Only after explicit product-owner approval of the inventory design may a separate implementation plan and physical schema review begin.


## 18. Quantity-pool inventory implementation boundary

The first implementation slice adds platform-controlled quantity pools for published Vybe offerings. A provider organization owner/admin may create and adjust the allocation only for its own offering, while an active category-scoped provider approval, approved location, active provider organization, published offering, and active category launch gate are revalidated before allocation changes or new holds.

Every allocation increase or reduction records the actor, signed quantity delta, reason, and a provider supply evidence reference. Reductions are serialized against the pool and rejected if they would reduce allocated capacity below active holds plus committed quantity. The allocation record is append-only; the pool's allocated quantity is the current platform-controlled ceiling, not the provider's total external stock.

Customer holds are serialized by locking the pool row in PostgreSQL. The transaction expires stale holds synchronously, calculates active holds and committed quantity, verifies remaining capacity, and creates a hold with a fixed expiry. The default hold duration is 600 seconds (10 minutes). A category-level policy row can override it within the database-enforced 60–1800 second range; an absent policy uses 600 seconds. The effective duration and expiry are fixed on each hold. Existing holds retain their stored expiry when settings change. Create-hold idempotency is scoped to user plus idempotency key; replays with a changed pool or quantity are rejected. Release is owner-only and idempotent.

This slice exposes pool creation, evidence-backed allocation adjustment, availability, hold creation, and owner release. Availability is informational and may change immediately; only the transactional hold operation reserves capacity. The implementation does not create bookings, convert holds into confirmed commitments, collect or refund money, or claim provider-confirmed/manual or external inventory as instantly bookable. Time-slot resources, room-night allocations, workers, booking orchestration, Commerce, Payments, Finance, fulfilment, and cancellation remain separate slices.

PostgreSQL integration coverage must assert persisted capacity under simultaneous final-unit requests, synchronous expiry, idempotent retries and payload mismatch, and allocation reduction against active holds. The implementation must pass migration apply, Prisma validation/generation, typecheck, lint, formatting, integration tests, and build before merge.


## 19. Time-slot inventory design gate (VYBE-011)

### 19.1 Purpose and launch boundary

Quantity pools (Section 18) represent a number of interchangeable units. They do not by themselves model a resource that is bookable only during a defined time interval. This slice defines controlled time-slot inventory for dining sessions, tables/lounges, and scheduled experiences. It is an inventory capability, not a booking or checkout implementation.

The first time-slot implementation may support:
- **Capacity sessions:** a defined service/experience interval with a finite number of seats, places, or service units.
- **Exclusive resources:** a named table, lounge, room-like venue resource, or other individually controlled asset that cannot be allocated to overlapping intervals.
- **Resource groups:** a provider-defined group of interchangeable exclusive resources, where allocation must still select and lock one actual resource before a hold is successful.

The initial scope is provider-allocated inventory controlled by Vybe. Certified external inventory and provider-confirmation/manual inventory remain excluded. Dining, tables/lounges, and scheduled experiences may use these primitives, but category activation remains gated by its own operational checklist. This design does not activate any category.

### 19.2 Time representation and timezone rules

- Persist interval boundaries as UTC instants and compare/lock using those instants. Intervals are half-open: **[start, end)**. A reservation ending exactly when another begins does not overlap unless a configured buffer makes it overlap.
- Every schedule/offer must retain an IANA timezone (for example, `Africa/Lagos`) as the authority for local service hours, customer display, and recurrence interpretation. A numeric UTC offset is not a substitute for an IANA timezone.
- A generated occurrence stores its resolved UTC start/end and the originating timezone plus local schedule identity. Changing a provider timezone must not silently move already published or held occurrences.
- Recurring schedules are rules for generating concrete occurrences, not inventory by themselves. Generate/materialize occurrences over a bounded booking horizon; edits create or supersede future occurrences explicitly and must not mutate existing holds or commitments.
- Reject nonexistent local times during daylight-saving transitions. If a local time is ambiguous because clocks move backward, require an explicit offset/fold choice at schedule creation. Store the resolved instant so later timezone database updates cannot reinterpret an existing reservation.
- Validate start < end, maximum duration, booking horizon, and minimum notice. These limits are platform policy, configurable by category within bounded values; no universal category values are approved by this design gate.

### 19.3 Duration, buffers, and availability

- Each occurrence has a customer-facing service interval and an effective blocked interval. The blocked interval is calculated as service start minus pre-buffer through service end plus post-buffer.
- Buffers represent setup, cleaning, table turnaround, or provider preparation. They are inventory constraints, not extra customer-facing booking time. A change to buffer policy applies only to unheld future availability; it cannot invalidate active holds or confirmed commitments.
- Capacity sessions have an integer capacity and committed/held quantities. A hold must fit within remaining capacity for the entire occurrence.
- Exclusive resources use actual resource identity. A resource group may offer alternatives, but a successful hold must atomically bind one concrete resource; a group-level count alone is insufficient to prevent overlap.
- Availability is informational. It may be stale immediately after read. Only the successful transactional hold operation reserves the occurrence/resource.
- The availability response must identify the occurrence, service interval, timezone, capacity or resource selection mode, and relevant offering version. It must not expose private venue details or another customer's reservation data.

### 19.4 Allocation and provider authority

- Only an active provider organization with current category/location-scoped Vybe approval, a published offering version, active category launch gate, and recorded supply authority may create or change time-slot allocations.
- Provider allocations must identify the actual resource or capacity session, the offering/version scope, location, effective dates, and evidence reference. Every allocation adjustment records actor, signed delta or resource-state change, reason, timestamp, and evidence reference.
- A provider cannot allocate the same exclusive resource to overlapping Vybe intervals. If a resource is also sold through another channel, the provider must allocate only the capacity it can genuinely reserve for Vybe; external channel synchronization is not implied.
- Suspending provider/category/location approval blocks new occurrences, allocations, and holds in the affected scope. Existing holds/commitments are not silently deleted; continuity handling is a later booking/operations policy.
- An offering edit that changes duration, buffer, capacity semantics, or resource requirements creates a new immutable offering version. Existing occurrences and holds retain their original snapshots.

### 19.5 Hold lifecycle, idempotency, and concurrency

- Reuse the approved 10-minute default hold duration, with category overrides bounded to 60–1800 seconds. The effective duration and expiry are fixed on each hold; later policy changes do not rewrite existing expiry timestamps.
- Holds are scoped to user plus idempotency key and include the exact offering version, occurrence, service interval, selected resource (where applicable), quantity, blocked interval, and expiry snapshot. Replays with a changed payload are rejected.
- For capacity sessions, lock the occurrence/capacity row inside the transaction, synchronously expire stale holds, recalculate held plus committed capacity, and create the hold only if the full requested quantity fits.
- For exclusive resources, enforce non-overlap in PostgreSQL, not only in application read-before-write logic. Use a database-enforced range/exclusion strategy (for example, a `tstzrange` GiST exclusion constraint) over the resource identity and effective blocked interval for active holds/commitments. Expired/released holds must cease blocking; this requires a safe state-aware constraint strategy or a separate active-allocation table whose rows are removed atomically on terminal transition.
- Resource-group selection must occur inside the same transaction as the hold. Lock candidate resources in deterministic order, attempt a database-enforced allocation, and return one concrete resource or a deterministic unavailable result. Never report a group-level hold without a concrete allocation.
- Allocation changes and holds must serialize against one another. Reducing capacity or disabling a resource is rejected if it would invalidate active holds or committed use. Resource reassignment is not an ordinary allocation edit.
- Expiry is synchronous in the transaction that needs capacity; background cleanup may be added later but is not correctness-critical. Release is owner-only and idempotent. Expiry, release, and consumption are mutually exclusive terminal transitions.
- All allocation and hold transitions write audit records and transactional outbox events in the same database transaction.

### 19.6 Physical schema and PostgreSQL verification requirements

Before migrations are authorized, the implementation proposal must specify:
- Whether capacity sessions and exclusive resources share occurrence metadata while retaining distinct allocation/constraint models.
- Database-enforced non-overlap for exclusive resources, including active-hold expiry/release semantics.
- Atomic resource selection for resource groups and deterministic lock ordering.
- Capacity serialization for simultaneous requests and multi-unit holds.
- How buffers are snapshotted and how policy changes interact with existing holds/commitments.
- Idempotency uniqueness, payload fingerprinting, and terminal transition rules.
- Provider approval/category/location revalidation and lock ordering against suspension/deactivation.
- Transactional audit/outbox writes and recovery for retries.
- Query/index strategy for time-range availability without making reads authoritative.

Required PostgreSQL integration tests:
- Two simultaneous requests competing for the final capacity unit: exactly one succeeds.
- Multi-unit capacity hold racing with another hold: persisted totals never exceed capacity.
- Two simultaneous overlapping holds on one exclusive resource: at most one succeeds.
- Adjacent half-open intervals succeed when no buffer overlaps; buffer-expanded intervals correctly conflict.
- Resource-group allocation racing across multiple candidate resources: each successful hold binds a distinct available resource.
- Expiry racing with a new hold: expired capacity/resource is reusable exactly once.
- Duplicate idempotency replay returns the original allocation; changed payload is rejected.
- Release/expiry retries cannot double-free capacity or resources.
- Capacity reduction/resource deactivation against active holds or commitments is rejected safely.
- DST nonexistent and ambiguous local times follow the rules in Section 19.2.
- Provider suspension racing with allocation/hold creation cannot authorize a new hold after suspension wins.
- Audit and outbox records commit atomically with each successful state transition.

### 19.7 Decisions and exclusions

This design gate approves the time-slot inventory model and invariants, but leaves the following values configurable and unresolved: category-specific maximum booking horizon, minimum notice, maximum duration, buffer defaults, recurrence materialization horizon, and the initial set of categories activated for time-slot booking. These must be set in a later category launch-readiness decision, not guessed in schema defaults.

This gate does not authorize:
- Customer booking records or booking lifecycle.
- Commerce carts, orders, checkout, or mixed ticket/Vybe checkout.
- Payment authorization/capture, real Payments integration, refunds, or Finance.
- Provider-confirmation/manual inventory or external supplier adapters.
- Room-night/accommodation allocation (a separate model and design gate).
- Fulfilment, redemption, cancellations, disputes, or settlement.
- Automatic category activation.

After product-owner approval, the next step is a separate physical schema review and implementation plan for time-slot inventory, with migrations and PostgreSQL tests. Booking/Commerce work remains blocked until time-slot and accommodation inventory are both implemented and verified.


## 20. Time-slot physical schema and implementation plan (VYBE-012)

### 20.1 Decision

This section translates the approved time-slot design gate (Section 19) into a proposed PostgreSQL/Prisma shape and a bounded implementation sequence. It is a schema review, not permission to begin migrations. Capacity-session accounting and exclusive-resource conflict enforcement remain separate because an application-only quantity counter cannot guarantee exclusive interval correctness.

### 20.2 Proposed domain records

1. **`VybeTimeSlotOccurrence`** — one concrete materialized service occurrence. Fields: UUID, offering ID, immutable offering-version number, IANA timezone, service start/end UTC instants, pre/post buffer seconds, effective blocked start/end UTC instants, status, timestamps. Store concrete occurrences, not recurrence rules.
2. **`VybeTimeSlotCapacity`** — one-to-one with a capacity occurrence. Fields: occurrence ID (unique), total capacity, committed quantity (initially zero and reserved for future booking conversion), timestamps. Enforce capacity >= 0 and 0 <= committed <= capacity. Derive active held quantity under the occurrence lock rather than maintaining a separately mutable counter.
3. **`VybeTimeSlotResourceGroup`** — an offering-scoped pool of interchangeable exclusive resources, with provider profile, offering, active state, and allocation validity window. A group count is never itself reservable.
4. **`VybeTimeSlotResource`** — one concrete provider-controlled asset (such as table A or lounge B), owned by a provider profile, with active state and stable provider-scoped identifier. Prevent duplicate active representations of the same physical asset within a provider scope.
5. **`VybeTimeSlotResourceGroupMember`** — join record connecting a concrete resource to a group, with effective membership dates. A resource may belong to multiple groups only where their allocation rules cannot grant overlapping use; the hold transaction still locks the concrete resource.
6. **`VybeTimeSlotHold`** — one idempotent temporary reservation. Fields: UUID, occurrence ID, user ID, idempotency key, optional capacity quantity, optional concrete resource ID, status, expiry, immutable service/blocked interval snapshot, timestamps. A database check requires exactly one target: positive quantity with no resource for capacity sessions, or quantity = 1 with a concrete resource for exclusive inventory. Unique idempotency scope is user + key. Store the concrete resource selected from a group, never only the group ID.

Occurrences snapshot offering version, timezone, service interval, and buffers. Holds copy interval values so later schedule or buffer edits cannot alter an existing hold. Use RESTRICT foreign keys; do not cascade-delete historical allocations or holds.

### 20.3 Database constraints and indexes

- UUID primary/foreign keys; `TIMESTAMPTZ(6)` timestamps; service and blocked intervals require start < end.
- CHECK constraints for nonnegative buffers, valid capacity/commitment, valid hold target shape, positive capacity quantity, and exclusive hold quantity exactly one.
- Unique idempotency index on (user_id, idempotency_key); indexes for occurrence status/start, offering/start, active hold expiry by occurrence, and active hold lookup by resource.
- For exclusive resources, enable PostgreSQL `btree_gist` and add a GiST exclusion constraint over concrete `resource_id` and `tstzrange(blocked_start_at, blocked_end_at, '[)')` for rows with status ACTIVE. This is the final race-condition barrier. The transaction synchronously marks expired holds EXPIRED before inserting a new hold. Do not use a time-dependent predicate such as `expires_at > now()` in a partial index.
- Prisma models ordinary schema; a hand-reviewed SQL migration adds the extension, range/exclusion constraint, and any expression/partial indexes. Replay the migration from an empty PostgreSQL 16 database in CI.
- Application read-before-write overlap checks are not sufficient. Do not rely on nullable resource IDs without database-enforced exclusive conflict protection.

### 20.4 Transaction contracts

**Capacity hold:** revalidate active user, provider organization, category/location approval, published offering version, category launch activation, and supply authority using the existing Vybe eligibility lock order; lock occurrence/capacity with `SELECT ... FOR UPDATE`; enforce user+key idempotency and reject changed payloads; synchronously expire stale holds; verify committed + held + requested <= capacity; insert hold, audit, and outbox atomically.

**Exclusive-resource hold:** revalidate the same eligibility; resolve eligible group members; lock candidate concrete resources in deterministic UUID order; synchronously expire stale holds; insert a hold bound to one concrete resource. Let the GiST exclusion constraint arbitrate overlap at commit. On conflict, try the next eligible candidate within a bounded retry; return unavailable if none remain. Write audit/outbox in the same transaction. Never return a successful group-only hold.

**Release/expiry:** lock the capacity occurrence or concrete resource first, then re-read the hold and perform one terminal transition. Release is owner-only and idempotent. Expiry and release cannot double-free capacity or resource time. Keep lock order consistent: provider eligibility rows, occurrence/capacity or concrete resources in deterministic order, then hold rows. Availability reads remain advisory.

### 20.5 API and module boundary

Create `src/modules/vybe-time-slots/` with `db`, `service`, `controller`, `routes`, and `validators`, matching existing domain modules. Keep quantity-pool inventory unchanged.

Initial endpoints cover provider-authorized occurrence creation; resource/group setup and membership; capacity allocation; occurrence/resource pause; customer availability; capacity/resource hold creation; and owner release. Public responses must not expose private resource identifiers or private venue details. Validate IANA timezone names and DST ambiguity/nonexistence at the boundary. Persist resolved UTC instants; never infer an ambiguous DST fold. No recurrence editor is included; a future scheduler may materialize occurrences.

### 20.6 Implementation slices and acceptance criteria

**A — Schema and migration:** add Prisma models/relations/indexes and reviewed SQL for `btree_gist` and exclusion constraint; verify clean PostgreSQL 16 migration and Prisma parity; test overlapping ACTIVE holds are rejected and adjacent half-open intervals are permitted.

**B — Provider occurrence/resource setup:** implement provider-authorized occurrence and resource/group setup; require active provider/category/location eligibility and supply evidence; snapshot offering version, timezone, service interval, and buffers; test provider scope, approval-suspension races, immutable snapshots, invalid intervals, and duplicate resource identifiers.

**C — Capacity holds:** implement advisory availability, serialized holds, idempotency, synchronous expiry, owner release, audit/outbox; test final-unit and multi-unit races, expiry/release races, changed idempotency payload, and capacity reduction against active holds.

**D — Exclusive-resource holds:** implement deterministic resource selection, concrete-resource binding, exclusion-constraint handling, bounded retries, expiry/release; test overlapping requests, adjacent intervals, buffer conflicts, group contention, and resource deactivation/allocation races.

Every slice must pass PostgreSQL integration tests, Prisma validation/generation, typecheck, lint, formatting, and build. Do not merge an unverified migration or concurrency behavior.

### 20.7 Exclusions and remaining approval gate

This plan excludes booking records, Commerce, orders/checkout, payment authorization/capture, real Payments, Finance, refunds, provider-confirmation/manual inventory, external adapters, fulfilment, redemption, cancellation/disputes, and accommodation room-night inventory. No category is activated by this module.

Before Slice A, approve the proposed model boundary and whether capacity sessions and exclusive-resource holds launch together or separately. Recommendation: share occurrence metadata but release capacity and exclusive-resource holds in separate implementation slices. Category-specific booking horizon, minimum notice, maximum duration, and buffer defaults remain launch-policy configuration; do not invent universal schema constants.


### 20.8 Slice B implementation contract

Slice B implements provider-side configuration only. The current implementation exposes:

- `POST /api/v1/vybe/time-slots/occurrences` — create a capacity or exclusive occurrence.
- `POST /api/v1/vybe/time-slots/resource-groups` — create an offering-scoped exclusive resource group.
- `POST /api/v1/vybe/time-slots/resources` — register a concrete provider-owned resource.
- `POST /api/v1/vybe/time-slots/resource-groups/:groupId/members` — allocate a concrete resource to a group for a validity window.

Every operation requires an authenticated organization OWNER or ADMIN, an active provider organization, an active category-scoped approval covering the published offering location, and an active category launch gate. The offering row is locked while its current published version is read and snapshotted.

Occurrence timestamps must be full ISO-8601 instants with an explicit UTC offset. The supplied IANA timezone must render that instant to the same local wall-clock fields. This rejects nonexistent local times and requires an explicit offset to resolve a repeated DST wall-clock time. The service and effective blocked intervals are persisted as UTC instants.

CAPACITY occurrence creation writes its capacity row in the same transaction. EXCLUSIVE occurrence creation requires an active resource group belonging to the same provider and offering, with a validity window covering the full blocked interval; it does not create a capacity row. Resource membership requires same-provider ownership and rejects overlapping validity windows for one physical resource across different groups.

Each creation requires a supply-evidence reference. The reference is retained in the append-only audit metadata and transactional outbox payload; this is a reference to evidence, not a file upload or evidence-storage implementation. No public availability or hold operation is part of Slice B. Slice C and Slice D remain separate.


### 20.9 Slice C capacity-hold implementation contract

Slice C implements customer-facing capacity-session availability and short-lived holds only. It does not implement bookings, checkout, payment, or conversion of holds into commitments.

Endpoints:

- `GET /api/v1/vybe/time-slots/:occurrenceId/availability` — advisory capacity snapshot; never a reservation.
- `POST /api/v1/vybe/time-slots/holds` — authenticated customer creates a capacity hold using occurrence ID, positive quantity, and an idempotency key.
- `DELETE /api/v1/vybe/time-slots/holds/:holdId` — owner-only release.

Capacity writes serialize on the occurrence row with PostgreSQL `FOR UPDATE`. Inside the same transaction, the service revalidates offering/provider/category/location eligibility, verifies the occurrence is active and CAPACITY mode, synchronously transitions expired capacity holds, sums active unexpired held quantities, checks `committedQuantity + activeHeldQuantity + requestedQuantity <= capacity`, and creates the hold. The occurrence lock is the serialization point; availability reads are advisory and may become stale immediately.

Hold duration reuses the existing category-level Vybe inventory policy: 600 seconds by default, configurable only within the existing 60–1800 second database constraint. Each hold snapshots the occurrence's service and effective blocked intervals. Idempotency is unique per user/key: same key and same occurrence/quantity returns the original active hold; changed payload or a terminal hold returns a conflict. Unique-key races are converted to an explicit idempotency conflict.

Expiry, creation, and release each write audit and outbox records in the same transaction. Expiry is synchronous on the next allocation attempt; background cleanup is not required for capacity correctness. Release locks the occurrence, re-reads the hold, and performs one terminal transition. Only the owner can release. Customer holds do not require provider organization privileges; provider setup permissions remain limited to organization OWNER/ADMIN.

Slice C excludes EXCLUSIVE occurrences, resource selection, booking/order records, Commerce, checkout, Payments, Finance, refunds, fulfilment, and room-night inventory. No category activation is implied.


### 20.10 Slice D exclusive-resource hold implementation contract

Slice D implements short-lived holds for EXCLUSIVE time-slot occurrences. Every successful hold is bound to one concrete provider resource; a resource-group-only hold is never returned. Capacity-session behavior from Slice C remains unchanged.

Endpoints:

- `GET /api/v1/vybe/time-slots/:occurrenceId/resource-availability` — advisory count of eligible and currently available resources; never a reservation and never exposes private resource identifiers.
- `POST /api/v1/vybe/time-slots/resource-holds` — authenticated customer creates a hold for an EXCLUSIVE occurrence using an idempotency key. The platform selects the concrete resource.
- `DELETE /api/v1/vybe/time-slots/holds/:holdId` — owner-only release for either capacity or exclusive-resource holds.

The transaction revalidates the active user, published offering, provider organization, category/location approval, category activation, active occurrence, and active same-provider/same-offering resource group. Eligible group members must be active and their membership validity must cover the full blocked interval. The occurrence is locked first; candidate resource rows are then locked in deterministic UUID order and re-read after locking so a concurrent deactivation cannot slip through.

Expired holds on candidate resources are synchronously transitioned to EXPIRED with audit and outbox records before conflict evaluation. A candidate is eligible only when no ACTIVE hold overlaps its effective blocked interval. The hold stores the concrete resource ID and snapshots service and blocked intervals. The PostgreSQL GiST exclusion constraint remains the final overlap barrier. An exclusion conflict identifies and excludes the selected resource, then retries selection in a new transaction up to five attempts; exhaustion returns a conflict rather than claiming inventory.

The hold duration reuses the category-level policy (600 seconds by default, 60–1800 seconds). Idempotency remains unique per user/key: identical active replay returns the original concrete-resource hold; a changed payload or terminal hold conflicts. Creation, release, and expiry write audit/outbox records atomically. Release locks the concrete resource, re-reads the hold, and performs one terminal transition. Resource and resource-group deactivation are rejected while ACTIVE holds depend on them. Resource membership cannot be narrowed or removed across an active hold.

PostgreSQL integration coverage includes same-resource concurrent requests, different-occurrence contention within one group, parallel resource selection, adjacent half-open intervals, overlapping service buffers, synchronous expiry, owner-only/concurrent release, and deactivation protection.

Slice D does not create bookings or convert holds into commitments. Commerce, orders/checkout, Payments, Finance, refunds, fulfilment, cancellation, and accommodation room-night inventory remain excluded.


## 21. Accommodation room-night inventory design gate (VYBE-013)

### 21.1 Purpose and boundary

Define how providers allocate room-category inventory to Vybe and how Vybe safely reserves stays spanning multiple nights. This is a design gate only. It does not authorize Prisma models, SQL migrations, API implementation, booking records, checkout, or payment integration.

The customer reserves a room category and quantity, not a specific physical room. The provider may assign the physical room later, subject to the category specifications and confirmed occupancy. Room-category attributes, occupancy limits, inclusions, restrictions, and the applicable offering version must be snapshotted for each hold and eventual booking.

### 21.2 Provider allocation and independent hotel sales

- A provider allocates explicit room-category quantities to Vybe for a defined property, category, and stay-date range. The allocated pool is the maximum Vybe may sell; it is not a claim on the hotel's total inventory.
- The provider remains free to sell unallocated inventory through its own channels. Vybe must never consume that unallocated stock.
- Every allocation records provider authority/evidence, actor, category, property/location, effective stay dates, quantity, creation time, and any subsequent signed adjustment with reason.
- **Unused Vybe allocation may be reclaimed by the provider only at a provider-agreed release cutoff recorded on that allocation.** The cutoff is an explicit local date/time plus IANA property timezone and must be agreed before the allocation becomes bookable. No universal cutoff is assumed by this gate.
- Reclamation is permitted only for inventory not held or committed by Vybe. A reduction that would put remaining allocation below active holds plus confirmed bookings is rejected. The provider cannot reclaim inventory already held by a customer or committed to a confirmed booking.
- A cutoff change applies prospectively and cannot silently shorten protection for an existing hold or booking. The effective cutoff and timezone are snapshotted on holds/bookings where relevant.
- If a provider fails to define or agree a release cutoff, that allocation is not made bookable until the terms are resolved. Do not invent a default release window.

### 21.3 Room-night accounting and availability

- Represent a stay as a half-open local-date interval **[check-in date, check-out date)**. A stay of 12–15 June consumes inventory for the nights of 12, 13, and 14 June; the 15 June checkout date is not a consumed night.
- Each consumed night must have sufficient allocation for the requested room category and quantity. Availability for the stay is the minimum remaining sellable quantity across every night in the interval.
- Inventory is accounted for per property + room category + local stay date. Property IANA timezone is authoritative for check-in/check-out policy and display; store resolved local dates and timezone identity rather than deriving hotel nights from UTC midnight.
- Check-in and check-out clock times are property/category policy and must be disclosed. They do not change which local calendar nights are consumed.
- A room-category allocation cannot exceed the provider-authorized quantity available to allocate to Vybe. If the provider's source cannot support reliable per-night accounting, it must not be represented as instant-bookable inventory.

### 21.4 Atomic multi-night holds and concurrency

- A hold for multiple rooms and nights is all-or-nothing. Either every night in the requested date range is reserved for the requested quantity, or none is.
- The transaction must lock all affected property/category/night allocation rows in deterministic date order, synchronously expire stale holds for those nights, recompute active holds plus committed quantity, verify every night has sufficient capacity, and create the complete hold atomically.
- Concurrent requests competing for the last room on any one night must not both succeed. No partial stay holds or partial room quantities are allowed.
- Holds use the approved 10-minute default, configurable only within the existing platform-bounded policy (60–1800 seconds). Effective expiry is fixed on each hold. Expiry is enforced synchronously when inventory is next allocated; background cleanup is not required for correctness.
- Idempotency is scoped to customer plus idempotency key. Identical active replays return the original hold; changed property/category/dates/quantity payloads conflict. Expiry, release, and consumption are mutually exclusive terminal transitions.
- Every successful hold, release, expiry, allocation adjustment, and commitment transition writes audit and transactional outbox records in the same transaction.

### 21.5 Allocation changes and booking protection

- Allocation increases are permitted only after provider authority and supply evidence are revalidated.
- Allocation reductions are serialized against holds and commitments and rejected if any affected night would fall below active holds plus committed room quantity.
- A provider may disable future unallocated inventory but may not silently cancel or displace existing holds/confirmed bookings.
- Confirmed bookings retain the room-category, quantity, stay-date, price, inclusions, occupancy, cancellation terms, and allocation snapshots applicable at confirmation.
- Physical room assignment is a separate provider fulfilment operation. It must satisfy the booked category and occupancy; it cannot be used to change the customer's purchased category or terms without an agreed customer-resolution flow.

### 21.6 Provider eligibility and inventory source

- New allocations and holds require an active provider organization, current category/location-scoped Vybe approval, active accommodation launch gate, published offering version, and evidence of authority to control the allocated room supply.
- Provider/category/location suspension blocks new allocations and holds in the affected scope. It does not delete existing holds or confirmed bookings; continuity and customer remedies belong to later booking/operations policy.
- The initial accommodation model is provider-allocated inventory controlled by Vybe. Certified external integrations and provider-confirmation/manual inventory are excluded from this gate and require separate designs.
- Stale or unverifiable availability must fail closed; it must not be advertised as guaranteed instant-bookable inventory.

### 21.7 Required physical schema review

Before migrations, the implementation proposal must specify:
- Property, room-category, offering-version, and provider ownership relationships.
- Per-night allocation representation and unique property/category/stay-date keys.
- Whether committed quantity is maintained transactionally or derived from confirmed bookings, with one authoritative accounting method.
- Multi-night deterministic locking and deadlock/retry behavior.
- Hold header/detail representation and all-or-nothing transaction semantics.
- Idempotency uniqueness, payload fingerprinting, expiry, release, and terminal transition constraints.
- How provider-agreed release cutoff, local time, IANA timezone, and cutoff snapshots are represented.
- Allocation reduction rules against holds and confirmed bookings.
- Provider approval/suspension lock ordering and transactional audit/outbox writes.
- Query/index strategy for date-range availability without treating reads as reservations.

Required PostgreSQL integration tests:
- Two concurrent requests competing for the final unit on one night: exactly one succeeds.
- Multi-night holds with one overlapping constrained night: at most one complete hold succeeds.
- Multi-room/multi-night holds never partially reserve inventory.
- Expiry racing with a new multi-night hold releases capacity exactly once across all nights.
- Idempotent replay returns the same hold; changed payload is rejected.
- Allocation reduction at/above active holds plus commitments succeeds/rejects at the exact boundary.
- Provider release cutoff cannot reclaim held or committed units.
- Cutoff/timezone changes do not rewrite existing hold/booking snapshots.
- Provider suspension racing with allocation/hold creation cannot authorize new inventory after suspension wins.
- Audit/outbox records commit atomically with allocation and hold transitions.

### 21.8 Decisions and exclusions

Approved by product owner:
1. Customers reserve a room category and quantity pool; providers may assign physical rooms later.
2. Hotels may independently sell unallocated inventory.
3. Unused Vybe allocation is released only at a provider-agreed cutoff recorded per allocation.
4. Reclamation cannot consume active holds or confirmed bookings.
5. A missing agreed cutoff blocks bookability; no universal default is invented.

This gate does not authorize booking lifecycle, Commerce, checkout, payment authorization/capture, real Payments, Finance, refunds, fulfilment, cancellation/disputes, external inventory integrations, or category activation. Following approval of this design gate, the next step is a separate physical schema review and implementation plan. Accommodation inventory must pass PostgreSQL concurrency and migration tests before booking/Commerce orchestration is started.
