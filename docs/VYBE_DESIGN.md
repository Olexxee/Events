# Vybe — Experiences Marketplace Design Gate

**Status:** Design in progress; Vybe branding and staged catalogue rollout (VYBE-001) approved  
**Customer-facing brand:** Vybe  
**Domain owner:** Vybe  
**Depends on:** Identity & Access, Organizations, Events, Event Access  
**Integrates with:** Ticketing & Admission, Commerce, independent Payments, Finance, Notifications, Operations & Trust  
**Implementation authorization:** None. Product scope decisions are being approved incrementally; this document does not authorize Prisma models, migrations, APIs, workers, or provider integrations.

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
| VYBE-009 | External inventory certification | Require atomic hold/reserve, idempotency, callbacks, cancellation and reconciliation | Read-only availability cannot prevent overselling |
| VYBE-010 | Vybe hold duration | Proposed 10 minutes, configurable by category/platform limits | Controls inventory contention |
| VYBE-011 | Booking changes | Define amendment versus cancel/rebook for date/time/party-size changes | Impacts inventory and refund audit |
| VYBE-012 | Standalone/event-linked discovery | Support both; decide launch prominence | Impacts navigation and event coupling |

### Approval gate

The product owner must approve or amend the proposed directions in Section 15 before implementation. Update the root README and this document together. Then review the physical schema against the domain model and define PostgreSQL concurrency/integration tests before writing Prisma migrations.

---

**Document status:** Vybe branding, staged catalogue rollout (VYBE-001), and risk-based category-scoped provider approval (VYBE-008) are approved. The remaining marketplace policies are still under product design and must be resolved before implementation. This document consolidates existing accommodation/hospitality policies under the Vybe brand, preserves independent Payments and Finance boundaries, and distinguishes approved decisions from proposals. No schema, migration, API, or provider implementation is authorized.
