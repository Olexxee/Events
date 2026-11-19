# Event Platform — Product Blueprint

> **Status:** Discovery and product-definition phase  
> **Market:** Nigeria  
> **Repository purpose:** Product requirements, business rules, architecture decisions, and implementation planning.  
> **Implementation status:** No application implementation is authorized by this document alone.

This document records decisions made during product discovery. It distinguishes confirmed decisions from recommendations and unresolved questions so implementation does not accidentally turn assumptions into business rules.

## 1. Product vision

Build a multi-organizer event commerce and hospitality platform for Nigeria. The platform combines a general event marketplace with curated private events and premium experiences.

Customers discover events, purchase tickets, select eligible add-ons, receive event-specific benefits, and manage attendance. Independent organizers create and operate events through their own workspace. The platform centrally processes payments, governs refunds, reconciles earnings, and provides operational oversight.

The product is more than ticket checkout. It is a modular platform for:

- Event discovery and publishing
- Ticketing, pricing, and admission inventory
- Hospitality and drink entitlements
- Accommodation inventory and reservations
- Guest management and check-in
- Centralized payments, refunds, and financial reconciliation
- Event-specific, opt-in social discovery through **Connect**
- Trust, safety, moderation, and compliance

## 2. Confirmed business decisions

| Area | Confirmed decision |
|---|---|
| Initial market | Nigeria only |
| Geographical coverage | Multiple Nigerian cities |
| Platform direction | Both a general event marketplace and an exclusive private-experiences offering |
| Event categories at launch | Both public and private events |
| Organizer model | Independent organizers can register and create events |
| Organizer publishing | Verified organizers can publish without manual approval of every event; platform moderation and takedown powers remain |
| Payment handling | Platform collects customer payments centrally and reconciles organizer/partner obligations |
| Platform revenue | Dual-sided ticket transaction fees: customer service fee plus organizer commission deducted from ticket sales |
| Organizer charging | No separate organizer invoice or mandatory organizer subscription is part of the agreed initial model; organizer commission is deducted from eligible ticket sales |
| Refund governance | Platform establishes and administers the refund framework |
| Accommodation supply | Both organizer-supplied rooms and rooms supplied by approved accommodation partners |
| Connect scope | Connect is limited to attendees of the same event |
| Connect model | Optional, consent-based social discovery and mutual introductions; it does not sell or guarantee access to another person |

### 2.1 Fee model — confirmed scope and open details

The agreed ticket revenue model has two fee components:

1. **Customer service fee:** displayed to the buyer and added to the ticket checkout total.
2. **Organizer commission:** deducted from eligible ticket face-value sales before the organizer's proceeds are calculated.

There is no separate organizer invoice for this commission. It is withheld through transaction allocation and settlement.

The percentages, fixed-fee options, minimums, caps, tax treatment, processor-fee allocation, and effective dates are **not yet decided**. Previously discussed numerical examples were illustrative only and are not approved rates.

The current decision specifically confirms dual fees on ticket sales. Whether the same fee model applies to accommodation, drinks, or other add-ons remains open and must not be assumed.

Fee rules must be configurable and versioned. Each purchase must retain a snapshot of the pricing rules that applied at the time of purchase.

## 3. Product principles

1. **One platform, shared engines:** public events, private parties, and premium experiences use the same core event, ticketing, commerce, and financial infrastructure.
2. **Configuration over hardcoding:** event access, ticket benefits, fees, venue disclosure, and refund terms should be configurable within platform policy.
3. **Inventory-backed promises:** a ticket description is not proof that a room, seat, drink, or other scarce benefit has been reserved.
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
- Customer service fee
- Organizer commission
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

### 7.3 Fee configuration

The pricing engine should support configurable fee rules, potentially including:

- Percentage and/or fixed fee
- Minimum and maximum fee
- Event or ticket category overrides
- Promotional exemptions
- Effective dates
- Fee-rule versioning

Only the existence of a customer fee plus an organizer commission on ticket sales is confirmed. Exact rates and add-on fee treatment remain open.

### 7.4 Organizer payouts

Payout timing and reserve policy remain undecided. The product should support configurable settlement schedules, payout eligibility checks, payout requests or automated settlement, reconciliation, and holds where contractually and legally permitted.

A proposed risk-based approach is to apply more conservative settlement terms to new or higher-risk organizers and consider more flexible schedules for established organizers. This is a recommendation, not an approved policy.

### 7.5 Financial invariants

- Every verified collection must be recorded once.
- Every allocation must balance.
- Refunds must reverse or offset the original financial allocations accurately.
- Historical fee snapshots must remain immutable.
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

The reservation flow is: temporary inventory hold → payment verification → confirmed reservation. Failed or expired holds release inventory.

If rooms are sold through external channels as well, the supplier must synchronize inventory or allocate a defined room block to the platform. Unsynchronized duplicate inventory is not acceptable.

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

1. **Product and policy foundation:** finalize business rules, roles, organizer terms, refund policy, fee rules, settlement policy, and safety requirements.
2. **Platform foundation:** identity, permissions, organizer onboarding, geography, admin workspace.
3. **Event marketplace:** event lifecycle, discovery, publishing, visibility, access policies.
4. **Ticket commerce:** ticket inventory, checkout, payment verification, ticket issuance, QR validation, dual-sided ticket fees, ledger.
5. **Operational controls:** guest management, check-in, event changes, refunds, reconciliation, settlements.
6. **Hospitality:** drink catalogue, entitlements, redemption, accommodation inventory and reservations, partner workspace.
7. **Connect:** opt-in event-specific profiles, mutual introductions, blocking, reporting, and moderation.
8. **Hardening and launch:** security, privacy, compliance review, payment-provider approval, operational testing, observability, and launch readiness.

Do not start with every module at once. The financial and inventory foundations must be correct before expanding into hospitality and Connect.

## 18. Open decisions register

The following items are not yet approved and must be resolved during product discovery.

### Commercial and financial

- Exact customer service fee rate and calculation method
- Exact organizer commission rate and calculation method
- Whether fee rules vary by event category or organizer
- Whether add-ons, drinks, and accommodation attract platform fees
- Processor-fee allocation
- Tax/accounting treatment
- Organizer payout timing and reserves
- Partner settlement timing
- Who bears refund costs after a supplier/organizer has been paid
- Chargeback and negative-balance recovery policy
- Whether complimentary tickets and promotional discounts incur fees

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

## 19. Product acceptance principles

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
