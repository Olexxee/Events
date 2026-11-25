# Event Platform — Product Blueprint

> **Status:** Foundation implementation  
> **Market:** Nigeria  
> **Repository purpose:** Product requirements, business rules, architecture decisions, and implementation tracking.  
> **Implementation status:** Shared backend foundation is authorized and underway. Product-domain modules remain gated by their design and review phases.

The initial backend stack is Node.js 22, TypeScript (strict mode, ESM), Express 5, PostgreSQL, Prisma 6, Zod, and Vitest. The API namespace is /api/v1. The foundation is being implemented before Events, Hospitality, Connect, and other domain modules.

This document records decisions made during product discovery. It distinguishes confirmed decisions from recommendations and unresolved questions so implementation does not accidentally turn assumptions into business rules.

## 1. Product identity and vision

**Product identity:** Events is an integrated event ecosystem connecting organizers, attendees, hospitality providers, and communities through one coordinated platform.

**Product purpose:** Build infrastructure that connects the event industry by coordinating the relationships, services, and transactions involved in discovering, organizing, attending, and participating in events.

The ecosystem has three interconnected pillars:

- **Events:** Event creation, publishing, discovery, ticketing, admission, attendee management, and organizer operations.
- **Hospitality:** Accommodation, drinks, VIP experiences, tables, lounges, and other reservable event-related services.
- **Connect:** Event-scoped, opt-in participant discovery, mutual connections, and communication around shared event participation.

These are connected product capabilities, not three unrelated applications. They should share appropriate identity, organization relationships, commerce infrastructure, and platform governance while retaining clear domain ownership.

The product is intended to support the event lifecycle:

- **Before:** discovery, registration, ticketing, hospitality reservations, and participant connections.
- **During:** admission, check-in, hospitality fulfilment, attendee services, and event coordination.
- **After:** settlement, reviews, continued connections within the applicable policy, community engagement, and future event discovery.

The long-term ambition is industry-wide event infrastructure. This is a strategic direction, not a commitment to launch every capability simultaneously. Initial market focus, release boundaries, and MVP scope remain to be defined.

The platform's initial market remains Nigeria. Product scope must be validated against the needs of organizers, attendees, and providers rather than assuming every event category or stakeholder can be served equally well at launch.

## 2. Confirmed business decisions

| Area | Confirmed decision |
|---|---|
| Initial launch market | Osun State, Nigeria |
| Initial geographic coverage | Statewide product coverage across Osun State; initial organizer/provider recruitment concentration remains to be selected |
| Expansion direction | Broader Nigerian market after validating the Osun State launch |
| Platform direction | Both a general event marketplace and an exclusive private-experiences offering |
| Event categories at launch | Both public and private events |
| Primary organizer customers | Independent organizers and professional event organizers |
| Additional supported organizer segments | Corporate and institutional organizers; curated-experience operators |
| Organizer access | The customer priority does not exclude other eligible organizer segments; verification and publishing controls still apply |
| Organizer publishing | Verified organizers can publish without manual approval of every event; platform moderation and takedown powers remain |
| Payment handling | Platform collects customer payments centrally and reconciles organizer/partner obligations |
| Monetization architecture | Deferred until the billing phase; do not encode a final charging model in the shared foundation |
| Module charging | Each module may carry its own commercial rules; the eventual model may use module-level charges, organizer subscriptions/entitlements, or a combination |
| Provider charging | Commercial charging rules and commission treatment remain open pending the billing phase |
| Paid event promotion | Deferred; no paid placement or sponsored ranking at initial launch |
| Refund governance | Events retains final authority over refunds governed by platform policy; organizers and providers may supply evidence but cannot independently override platform decisions |
| Service delivery responsibility | Organizers and hospitality providers are responsible for delivering the events and services they offer; Events owns marketplace governance and dispute coordination |
| Customer support | One centralized support system with domain-specific routing and escalation |
| Financial source of truth | Events maintains the authoritative ledger, financial records, and settlement records |
| Accommodation supply | Organizers and approved accommodation partners may supply rooms; every supplier must pass hospitality-specific approval before listing, separate from organizer/event-publishing verification. Existing organizer accounts can be reused without creating duplicate organizations. |
| Connect scope | Connect is limited to attendees of the same event |
| Connect model | Optional, consent-based social discovery and mutual introductions; it does not sell or guarantee access to another person |
| Hospitality providers | Organizers and platform-approved hospitality partners; organizer verification does not grant hospitality approval. Organizers must pass the separate hospitality-provider approval before listing hospitality inventory, using their existing organization account. |
| Hospitality checkout | Standalone hospitality bookings and combined ticket + hospitality checkout |
| Connect eligibility | Verified ticket holders and organizer-approved guests, with explicit event-scoped opt-in |
| Post-event Connect | Existing connections may continue for a defined period; exact duration remains open |
| Private-event access | Organizer approval with platform admin oversight |
| Hospitality reservation model | Every hospitality provider publishes reservable inventory; controlled/synchronized inventory is held during checkout and confirmed after verified payment, without per-booking provider approval. Provider confirmation is an explicitly disclosed exception when inventory cannot be guaranteed. |
| Accommodation inventory | Customers reserve a defined room category/quantity pool; the provider may assign the physical room later. Price is attached to category specifications, not used as the sole category definition. Hotels may allocate selected room categories/quantities to the platform while continuing to sell unallocated inventory independently. |
| Connect after cancellation | Ticket cancellation/refund immediately revokes event Connect eligibility |
| Organizer settlements | Milestone releases with a final post-event balance; exact milestone configuration remains open |
| Event cancellation and hospitality | Event cancellation triggers an item-by-item assessment of linked hospitality reservations, not automatic blanket cancellation. Event-dependent bookings normally follow the applicable event cancellation policy; independently valid bookings may remain active if the customer chooses and supplier terms allow. Partner-supplied bookings are coordinated under disclosed supplier terms. |

### 2.1 Monetization — deferred

The commercial model is intentionally deferred. The product may charge independently for the modules an organizer chooses to use, use subscriptions that grant access to selected modules, or combine these approaches. No option has been selected.

Keep these concerns separate:

- **Module capability/access:** whether an organizer or account is entitled to use a module.
- **Commercial agreement:** what is charged, to whom, and under which pricing terms.
- **Transaction accounting:** what was collected, earned, owed, refunded, or settled.

The shared foundation must not hardcode subscription plans, module prices, commission rates, customer fees, or billing eligibility. When billing is designed, pricing rules must be configurable and versioned, and each transaction must retain the applicable pricing snapshot. Existing product policies about refunds, centralized financial records, and settlement governance remain product requirements; they do not authorize choosing fee rates or a charging model now.

## 3. Product principles

1. **One platform, shared engines:** public events, private parties, and premium experiences use the same core event, ticketing, commerce, and financial infrastructure.
2. **Configuration over hardcoding:** event access, ticket benefits, fees, venue disclosure, and refund terms should be configurable within platform policy.
3. **Inventory-backed promises:** a ticket description is not proof that a room, seat, drink, or other scarce benefit has been reserved. Hospitality providers publish defined reservable inventory; controlled inventory is held during checkout and confirmed only after verified payment.
4. **Central financial truth:** all collections, allocations, refunds, reversals, fees, liabilities, and payouts must be represented in an auditable ledger.
5. **Least-privilege access:** organizers, staff, and partners only see the data required for their responsibilities.
6. **Consent and personal autonomy:** Connect participation is voluntary. A ticket never entitles its holder to another attendee, a date, intimacy, sexual activity, or private contact details.
7. **Safety by design:** identity verification, incident reporting, moderation, privacy, and venue safety are product requirements, not optional later additions.
8. **Nigeria-first operations:** currency, cities, payment rails, customer communications, applicable law, and operational policies must be designed for the Nigerian market.

## 4. Event categories and access

### 4.1 Event categories

The platform supports at least:

- Public events: concerts, festivals, parties, networking, and other public gatherings.
- Private events: restricted guest lists, private venues, limited capacity, and controlled admission.
- Premium experiences: curated experiences that may bundle hospitality, accommodation, premium access, or other defined benefits.

These are product categories/configurations, not separate applications or backends.

### 4.2 Visibility

Each event should support:

- **Public:** discoverable through platform browsing and search.
- **Unlisted:** not generally discoverable; accessible through a private link.
- **Invitation-only:** visible or purchasable only by invited/approved accounts, according to event rules.

Visibility is separate from purchase eligibility.

### 4.3 Purchase/access policy

Each event should be able to select:

- **Open:** eligible customers can purchase while inventory is available.
- **Approval required:** customer requests access and must be approved before purchase is finalized.
- **Invitation-only:** only invited/approved accounts can purchase.

Open organizer publishing does not mean every event is automatically unrestricted. Organizers must be verified, and the platform retains moderation, suspension, and emergency takedown powers. Higher-risk event configurations may trigger additional review.

### 4.4 Event lifecycle

Proposed lifecycle:

- Draft
- Published
- Sales paused
- Sold out
- Ongoing
- Completed
- Cancelled

An event may also have a separate review/moderation state. Organizers must not silently change material details such as date, venue, price, or included benefits after sales begin. Material changes require customer notification and the applicable refund/transfer options.

## 5. User roles and workspaces

An account may hold more than one role, subject to verification and authorization.

| Role | Main responsibilities |
|---|---|
| Attendee | Discover events, buy tickets, manage bookings, attend events, optionally use Connect |
| Organizer | Create and manage events, tickets, guests, event operations, and view financial statements |
| Organizer staff | Perform explicitly assigned event operations such as check-in |
| Hospitality partner | Fulfil assigned hospitality orders or reservations |
| Platform admin | Organizer/event verification, moderation, support, operational oversight |
| Platform finance/admin | Reconciliation, refunds, payout review, financial reporting |
| Super admin | Platform-wide configuration and privileged administration |

### 5.1 Organizer onboarding

Before publishing or receiving settlements, an organizer should complete applicable checks:

- Email and phone verification
- Identity verification, or business/CAC verification where applicable
- Bank-account verification
- Acceptance of organizer terms
- Platform risk/compliance review
- Administrative approval of the organizer account

After verification, organizers can publish eligible events directly. The platform may apply event-level flags, limits, review, suspension, or takedown where necessary.

### 5.2 Trust levels

Potential organizer states:

- Pending
- Verified
- Established
- Restricted
- Suspended

Trust levels may influence transaction limits, payout schedules, or additional checks. They must not exempt organizers from platform rules.

## 6. Ticketing and entitlements

Keep these concepts separate:

### 6.1 Ticket

The ticket represents the admission right for a specific attendee to a specific event, subject to the event's terms and validation rules.

### 6.2 Entitlements

Entitlements are benefits included with a ticket, for example:

- General or VIP admission
- Drink tokens or defined beverage allocations
- Lounge or seating access
- Hospitality access
- Other organizer-defined, operationally fulfilable benefits

An entitlement must have clear quantity, eligibility, validity, and redemption rules where applicable.

### 6.3 Add-ons

Add-ons are optional purchases made alongside or after ticket purchase, such as extra hospitality packages or accommodation. Add-on fee treatment is still undecided.

### 6.4 Reservations

Reservations allocate scarce inventory, such as a specific room or room category. A reservation is not merely descriptive ticket text.

### 6.5 Inventory and checkout requirements

- Inventory holds must expire after a defined checkout period.
- Inventory reservation and order creation must be concurrency-safe and transactional.
- Payment confirmation must be verified server-side with the payment provider.
- A ticket or reservation must not be confirmed solely because the frontend reports payment success.
- Failed, abandoned, or expired checkouts must release held inventory safely.
- Duplicate payment notifications must not create duplicate tickets, reservations, or ledger entries.
- Idempotency must protect payment, ticket issuance, refunds, and other financial operations.

## 7. Payments, fees, ledger, and settlements

### 7.1 Centralized collection

The platform is the central payment collection and reconciliation point. The customer pays through the platform's supported payment provider. The backend verifies the transaction and allocates the resulting obligations.

The exact legal, payment-provider, tax, and settlement structure must be validated before production launch. Central collection must not be treated as permission to commingle funds or disregard applicable payment-provider rules.

### 7.2 Financial records

The platform should maintain an auditable double-entry ledger. Do not use a mutable organizer balance as the sole source of financial truth.

Track at least:

- Customer gross payment
- Ticket face value
- Any customer-facing charge, where the selected commercial model applies one
- Any organizer/provider charge or commission, where the selected commercial model applies
- Processor charges
- Taxes and statutory deductions where applicable
- Organizer payable
- Hospitality/accommodation partner payable where applicable
- Refund liabilities
- Refunds and reversals
- Chargebacks and disputes
- Payouts and settlement references
- Platform revenue

Customer payment, organizer proceeds, and platform revenue are different amounts and must be reported separately.

### 7.3 Commercial configuration

The charging model is deferred to the billing phase. The eventual design may charge per module, grant module access through organizer subscriptions/entitlements, or combine these approaches. No model or rates are approved.

The architecture must keep module access/entitlement separate from commercial pricing and transaction accounting. When billing is designed, pricing rules must be configurable and versioned, and each charge must retain an immutable snapshot of the applicable rule. Do not implement fee rules, subscription plans, module prices, or commission calculations in the shared foundation.

### 7.4 Organizer payouts

**Confirmed model:** organizer earnings are released through milestones, followed by a final post-event balance. The exact milestone percentages, dates, reserve amounts, eligibility conditions, and release approvals remain open and must be configurable/versioned rather than hardcoded.

The settlement engine must support eligibility checks, reconciliation, holds for documented disputes/refunds/risk controls, payout execution, failed-payout recovery, and a final post-event reconciliation. A payout must never exceed the organizer's reconciled, eligible payable balance. Any risk-based variation by organizer trust level requires an approved policy and must be disclosed contractually.

**Hospitality purchasing and organizer control are separate from organizer settlement.** Hospitality may be purchased through attendee-led checkout (including as a ticket add-on) or arranged/booked by the organizer for the event. The purchaser is responsible for the applicable payment: attendees pay for their selected items; organizers pay for hospitality they arrange for the event. Full payment before provider commitment is the default. Deposits or staged payments are permitted only where the provider explicitly agrees to those commercial terms; instalments are not a default platform entitlement.

Organizers may configure and offer approved hospitality features they own, control, or are contractually authorized to sell. An organizer must not advertise or sell inventory that has not been secured or contractually allocated. Partial or delayed organizer earnings settlements must not, by themselves, prevent the organizer from managing otherwise-authorized event features. Purchasing/booking, offering/configuration, fulfilment, and organizer/provider settlement are separate workflows. Settlement milestones do not delay a customer's paid reservation or a provider's commitment once the applicable purchase conditions have been satisfied.

### 7.5 Financial invariants

- Every verified collection must be recorded once.
- Every allocation must balance.
- Refunds must reverse or offset the original financial allocations accurately.
- Any applied price/charge snapshots must remain immutable; do not create snapshots for hypothetical or unapplied fees.
- Payouts must not exceed eligible payable balances.
- Manual adjustments require a reason, actor, timestamp, and audit trail.
- Payment-provider webhooks must be authenticated and processed idempotently.

## 8. Refunds, cancellations, and disputes

The platform owns the refund framework and administers refund decisions. Organizers may offer terms more generous than the platform minimum, but cannot override mandatory platform protections or applicable law.

Proposed scenarios to define in the detailed policy:

| Scenario | Product requirement |
|---|---|
| Organizer cancels event | Provide the applicable full-refund path |
| Platform cancels event | Provide the applicable full-refund path |
| Material date or venue change | Notify affected buyers and provide defined options |
| Event postponed | Define transfer, acceptance, and refund options |
| Duplicate payment | Reverse the duplicate collection |
| Payment fails | Do not issue ticket or confirm reservation |
| Customer cancellation | Apply the disclosed ticket/add-on policy and applicable law |
| Hospitality benefit unavailable | Define replacement or affected-benefit refund |
| Chargeback/dispute | Record evidence, status, deadlines, and financial impact |

The checkout must display the applicable terms before payment and retain the exact policy version accepted by the customer.

Ticket, add-on, accommodation, partial, and chargeback cases must be represented separately. The platform must not assume they share identical refund rules.

### Event cancellation and linked hospitality

Cancelling an event must trigger an assessment of each linked hospitality order item or reservation; it must not blindly cancel every booking. Determine whether the booking was event-dependent or independently valid, then apply the disclosed customer terms and supplier agreement:

- Hospitality booked specifically to attend the cancelled event will normally follow the applicable event-cancellation policy.
- An independently useful accommodation or hospitality reservation may remain valid when the customer chooses to keep it and the supplier terms permit continuation.
- For partner-supplied inventory, the platform coordinates the outcome with the supplier under the terms disclosed before purchase; supplier involvement does not remove the platform's responsibility to administer the customer-facing process.
- Track cancellation, continuation, replacement, and refund outcomes per order item/reservation. Do not infer that cancelling one item cancels the entire order.
- Notify affected customers of the available outcomes and any action or deadline required from them.

The financial policy must also define who bears costs when a refund is required after an organizer or supplier has already been paid. This is still an open business decision.

## 9. Accommodation

Both supply models are supported.

### 9.1 Organizer-supplied

The organizer controls the room inventory they are authorized to offer and is responsible for accurate availability and fulfilment.

### 9.2 Partner-supplied

An approved accommodation partner supplies inventory and fulfils reservations through a restricted partner workspace.

### 9.3 Shared reservation engine

Every room or room category should have:

- Supplier/owner
- City and location
- Inventory identifier
- Room category
- Available quantity or synchronized availability
- Occupancy limit
- Price and pricing rules
- Check-in/check-out rules
- Cancellation terms
- Reservation status

The accommodation confirmation flow depends on inventory reliability. Where inventory is controlled by the platform or synchronized with sufficiently reliable availability, reserve inventory atomically, verify payment, and confirm instantly. Where availability cannot be guaranteed, create a provider-confirmation request and do not represent the booking as confirmed until the provider accepts. The payment authorization/capture policy while awaiting provider confirmation remains open. Failed, rejected, or expired requests must release inventory and follow the applicable refund policy.

**Confirmed external-inventory policy:** use a phased hybrid model. At launch, allocated inventory is the default: a hotel allocates selected room categories and quantities to the platform, retains control of unallocated categories/rooms, and must honour the platform's confirmed allocation. The platform controls holds and consumption inside its allocated pool. Allocation size, effective dates, release/cut-off rules, and reconciliation responsibilities must be agreed and recorded; unused-inventory release terms are not yet standardized.\n\nExternal inventory integrations may be enabled after technical and operational certification. An integration qualifies for instant confirmation only if it supports sufficiently fresh availability plus an actual atomic reservation/hold operation, idempotent requests, confirmation and cancellation outcomes, and reconciliation for missed or delayed callbacks. A read-only or stale availability response is not proof that inventory can be reserved. If the external system cannot guarantee a reservation, use the explicitly disclosed provider-confirmation path instead.\n\nProviders without reliable integrations may use provider-confirmed requests; customers must see pending status and the payment authorization/capture policy for this path remains open. The platform must never show a reservation as confirmed merely because an external availability lookup returned a positive result. Unsynchronized duplicate inventory is not acceptable.

Accommodation commission/fee treatment, supplier settlement terms, and the exact division of refund liability remain open.

## 10. Hospitality and drinks

Organizers may provide hospitality themselves or use approved partners.

The catalogue may support alcoholic and non-alcoholic beverages, subject to applicable licensing, age restrictions, and responsible-service requirements.

Ticket entitlements and add-on purchases should generate auditable redemption records. A token or benefit must not be redeemed more than once.

Operational requirements:

- Staff see only the fulfilment information they need.
- Redemption is linked to the ticket/order and recorded with timestamp and staff identity.
- Corrections and reversals are audited.
- Age checks and refusal-of-service procedures apply where legally required.
- The platform must not imply that a beverage entitlement overrides venue licensing or responsible-service rules.

## 11. Private events and venue disclosure

Private events may withhold the exact venue address until a defined post-purchase point.

Proposed disclosure levels:

| Information | Suggested disclosure |
|---|---|
| City | Before purchase |
| General area/neighbourhood | Before purchase, where appropriate |
| Exact venue address | After verified payment/eligibility |
| Detailed access instructions | After confirmation, potentially nearer event time |
| Sensitive entry code | Restricted to eligible attendees and only when needed |

This is a proposed policy, not a final legal or operational rule. Buyers must receive enough location information before purchase to make an informed decision.

Exact venue data must not leak through public event APIs, page metadata, search indexing, image metadata, or unauthenticated endpoints. If a ticket is refunded or revoked, access to restricted event details should be reviewed/revoked as appropriate.

Private events require suitable venue capacity controls, admission validation, safety procedures, and incident reporting.

## 12. Connect — event-specific social discovery

Connect is limited to attendees of the same event and is optional.

Initial product requirements:

- Connect eligibility is limited to verified ticket holders and organizer-approved guests.
- Eligibility and consent are separate: every eligible participant must explicitly opt in for that event.
- Ticket cancellation or refund immediately revokes event Connect eligibility; asynchronous cleanup cannot be the only authorization control.
- Existing connections may continue for a defined post-event period; the exact duration remains open and configurable.
- Only eligible, verified adults may participate.
- Each participant creates and controls their own profile.
- No administrator-created or uploaded profiles without the individual's direct application and consent.
- Participants explicitly opt in to each event.
- Participants control which profile details are visible.
- Interest is voluntary.
- An introduction requires mutual acceptance.
- Declining does not trigger a penalty or repeated unwanted requests.
- Blocking and reporting are available.
- Participants can withdraw at any time.
- Private contact details are not disclosed by default.
- Organizers cannot treat attendee profiles as inventory or assign people to ticket buyers.

Connect does not sell or guarantee access to another person, companionship, a date, intimacy, or sexual activity. Ticket purchase does not create any entitlement to another attendee. The platform should not facilitate paid sexual-service arrangements.

Messaging after mutual acceptance may be considered, subject to safety, moderation, privacy, and abuse-prevention requirements.

## 13. Safety, privacy, and compliance

This platform will process identity, payment, location, attendance, and potentially sensitive social-profile data. Privacy and safety must be designed into the system.

Requirements include:

- Adult eligibility and proportionate age/identity verification
- Data minimization and purpose limitation
- Explicit opt-in for Connect
- Strong access controls and audit logs
- Secure handling of identity documents and private venue data
- Retention and deletion policies
- User blocking and reporting
- Incident escalation and response workflows
- Organizer and partner terms
- Venue safety and emergency procedures
- Abuse, fraud, and suspicious-event monitoring
- Appropriate consent and privacy notices

Before launch, obtain Nigerian legal and compliance advice on the actual operating model, including applicable event/venue requirements, data protection, consumer protection, payment processing, tax, alcohol licensing, and any restrictions relevant to social-discovery features. Do not assume that describing an event as private removes regulatory obligations.

## 14. Workspaces

### Customer workspace

- Account and verification
- Event discovery and filters
- Event details and access requirements
- Ticket selection and checkout
- Tickets and QR codes
- Entitlements and redemption status
- Add-ons and accommodation reservations
- Event notifications
- Optional Connect
- Refund and support requests

### Organizer workspace

- Organizer profile and verification
- Event creation and management
- Ticket categories, prices, and capacity
- Entitlement and add-on configuration
- Guest list and admission operations
- Staff access and permissions
- Hospitality/accommodation coordination
- Sales and financial statements
- Refund requests and event-change workflows
- Payout/settlement visibility

### Hospitality partner workspace

- Partner profile and approval
- Assigned inventory or fulfilment orders
- Room availability and reservations, where applicable
- Drink/order fulfilment, where applicable
- Limited guest information required for fulfilment
- Settlement statements
- Support and incident reporting

### Platform administration workspace

- Organizer verification and risk controls
- Event moderation and takedowns
- Customer support
- Refund administration
- Payment and ledger reconciliation
- Payout oversight
- Partner verification
- Safety reports and incident management
- Platform fee and policy configuration
- Audit logs and operational reporting

## 15. Geography and discovery

The platform launches in multiple Nigerian cities. The initial city list and launch sequence are not yet finalized.

The data model should support:

- Multiple cities
- State and city association
- Venue and neighbourhood/area
- Organizer operating across cities
- Event discovery by city, date, category, and access type
- Accommodation and hospitality suppliers by service area

Potential initial city candidates discussed include Lagos, Abuja, Port Harcourt, and Ibadan. This is a shortlist for evaluation, not a final launch commitment or market ranking.

## 16. Proposed technical direction — not yet locked

The following is a candidate stack based on existing project conventions. Confirm it before implementation:

- Runtime: Node.js 22
- Backend: Express 5, ES modules
- Database: PostgreSQL
- ORM: Prisma
- Validation: Zod
- Frontend: React + TypeScript
- Payments: Paystack, subject to merchant/product approval and settlement design
- Email: Resend
- Media: Cloudinary

### Backend architecture

Prefer a modular monolith initially. Keep clear domain boundaries without introducing microservices prematurely.

Preferred request flow:

route → authentication/authorization → validator → controller → service → repository/database

- Controllers remain thin.
- Services own business rules.
- Database/repository layer owns persistence and transaction boundaries.
- Centralized error handling and consistent response envelopes.
- Payment, inventory, ticket issuance, refunds, and ledger posting require explicit idempotency and transaction design.
- Background jobs should be durable and observable; job ownership and hosting strategy are still open.

Potential domains:

- identity-and-access
- organizers
- events
- venues-and-geography
- ticketing
- inventory
- orders-and-checkout
- payments
- ledger-and-settlements
- refunds-and-disputes
- hospitality
- accommodation
- guest-operations
- connect
- notifications
- moderation-and-safety
- reporting-and-audit

## 17. Proposed delivery phases

1. **Product and policy foundation:** finalize foundational business rules, roles, organizer terms, refund policy, settlement policy, and safety requirements. Commercial pricing remains deferred to the billing phase.
2. **Platform foundation:** identity, permissions, organizer onboarding, geography, admin workspace.
3. **Event marketplace:** event lifecycle, discovery, publishing, visibility, access policies.
4. **Ticket commerce:** ticket inventory, checkout, payment verification, ticket issuance, QR validation, and ledger integration.
5. **Operational controls:** guest management, check-in, event changes, refunds, reconciliation, settlements.
6. **Hospitality:** drink catalogue, entitlements, redemption, accommodation inventory and reservations, partner workspace.
7. **Connect:** opt-in event-specific profiles, mutual introductions, blocking, reporting, and moderation.
8. **Hardening and launch:** security, privacy, compliance review, payment-provider approval, operational testing, observability, and launch readiness.

Do not start with every module at once. The financial and inventory foundations must be correct before expanding into hospitality and Connect.

## 18. Open decisions register

The following items are not yet approved and must be resolved during product discovery.

### Commercial and financial

- Whether organizers are charged per enabled module, through subscriptions/entitlements, or through a combination
- Which modules and capabilities are included in each future commercial package
- Whether and how customers, organizers, and providers are charged for specific transactions
- Any fee/commission calculation bases, rates, caps, exemptions, and category variations
- Processor-fee allocation
- Tax/accounting treatment
- Exact organizer settlement milestone percentages, dates, reserve amounts, release conditions, and approval rules within the confirmed milestone-release model
- Partner settlement timing
- Who bears refund costs after a supplier/organizer has been paid
- Chargeback and negative-balance recovery policy
- Whether complimentary tickets, promotional discounts, and no-charge transactions affect future commercial calculations

### Ticketing and event operations

- Ticket transfer policy and transfer limits
- Whether resale is prohibited or supported under controlled rules
- Group booking rules
- Guest approval workflow details
- Exact venue disclosure timing
- Event postponement and material-change options
- Event staff permissions and check-in procedures
- Capacity and waitlist behaviour

### Accommodation and hospitality

- Whether room selection is by room type or specific room
- External inventory synchronization method
- Room cancellation windows and supplier liability
- Hospitality supplier onboarding and licensing checks
- Add-on pricing and fee treatment

### Connect and safety

- Profile fields and visibility controls
- Whether post-match messaging is included in the first release
- Age/identity verification provider and process
- Moderation and incident-response staffing
- Data retention and deletion schedule
- Legal review of the final Connect feature set

### Technology and operations

- Final stack confirmation
- Hosting and background-job strategy
- Payment-provider approval and settlement configuration
- Notification channels
- Analytics and reporting requirements
- Backup, disaster recovery, and operational support expectations

## 19. Domain model and technical design

The conceptual entity relationship model, domain ownership map, principal data dictionary, integrity constraints, cross-domain event contracts, Prisma design constraints, and schema review gates are maintained in [docs/DOMAIN_MODEL.md](docs/DOMAIN_MODEL.md).

That document is design-only. It does not authorize a Prisma schema, migrations, or application implementation. The root README remains the product decision source of truth; the domain model expands the approved requirements and identifies unresolved design dependencies.

## 20. Product acceptance principles

A release should not be considered production-ready unless:

- Payment callbacks and webhooks are authenticated and idempotent.
- No ticket or room can be oversold under concurrent checkout.
- No ticket is issued before verified payment.
- Refunds and reversals reconcile against the original transaction.
- Platform and organizer financial positions are auditable.
- Restricted venue details are not publicly exposed.
- Organizer, staff, and partner permissions are tested.
- Connect is opt-in, event-scoped, and supports blocking/reporting/withdrawal.
- Material event changes notify affected customers and invoke the applicable policy.
- Privacy, safety, legal, and payment-provider reviews are completed for the actual launch model.

---

**Document status:** Initial product blueprint. Confirmed decisions are recorded in Section 2. Recommendations and unresolved questions are explicitly marked throughout. Update this document as business decisions are made; do not silently convert proposals into approved requirements.
