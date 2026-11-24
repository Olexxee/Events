# Events + Connect — Domain Model and Data Design

> **Status:** Conceptual domain specification  
> **Scope:** Domain ownership, entity relationships, data dictionary, lifecycle boundaries, and Prisma design constraints  
> **Implementation status:** Design only. This document does not authorize application code, a Prisma schema, migrations, or provider integrations.

This document expands the confirmed product decisions in the root README. It is a conceptual model, not a description of an implemented database. Recommendations and unresolved policies are identified explicitly.

## 1. Design principles

1. **Explicit domain ownership:** Each module owns its records and state transitions. Other modules use its service contract or consume published domain events.
2. **User and organization are different concepts:** A user may act in multiple organizations and events under different scoped permissions.
3. **Access approval is not admission:** Private-event approval, ticket purchase, ticket issuance, and check-in are separate facts.
4. **An order is not fulfilment:** One order may contain independently fulfilled items with separate cancellation and refund outcomes.
5. **Payment is not revenue:** Collections, liabilities, fees, refunds, reserves, and payouts are distinct accounting facts.
6. **Inventory matches the resource:** Admission quantity, room-night availability, table time slots, and voucher quantities require appropriate concurrency controls.
7. **Connect is event-scoped and consent-based:** Eligibility and consent are independent. Ticket cancellation or refund immediately removes eligibility.
8. **Operational projections are not financial truth:** Cached balances and eligibility projections may improve performance, but authoritative state remains in owned domain records and the immutable ledger.
9. **Avoid polymorphic foreign-key shortcuts:** Prefer explicit relation tables and typed records where referential integrity matters.
10. **Do not infer unresolved policy:** Physical schema decisions must follow the open payment, refund, settlement, provider, and retention policies.

## 2. Domain ownership map

| Domain | Owns | Must not own |
|---|---|---|
| Identity & access | User identity, sessions, account status, platform permissions | Event admission or commercial entitlements |
| Organizations | Organizations, memberships, scoped roles, verification cases | Ticket inventory or global user identity |
| Events | Event definition, visibility, schedule, venue disclosure, lifecycle | Ticket issuance, payment settlement, Connect messages |
| Event access | Invitations, access requests, organizer decisions, access grants | Ticket payment or check-in |
| Ticketing & admission | Ticket types, inventory, holds, issued tickets, transfers, check-in | Payment-provider truth or organizer payout balances |
| Hospitality | Provider profiles, offerings, inventory, bookings, fulfilment, redemption | General ticket state or platform ledger |
| Commerce | Cart/checkout orchestration, orders, order items, purchase snapshots | Provider payment status or ledger balances |
| Payments | Provider references, payment attempts, verified collections, refund execution | Ticket or hospitality fulfilment decisions |
| Finance | Accounts, journal entries, fee allocations, settlement eligibility, batches and payouts | Editing original order or provider records |
| Connect | Event participation projection, consent, discovery, connections, messages, blocks and reports | Ticket ownership or private hospitality details |
| Operations & trust | Support, moderation, audit, operational incidents | Silent mutation of another domain's authoritative state |
| Platform infrastructure | Outbox, job execution, notifications, integrations, observability | Domain-specific business decisions |

### 2.1 Dependency direction

- Identity and Organizations are foundational.
- Events depends on Organizations and Identity.
- Event Access depends on Events and Identity.
- Ticketing depends on Events and Identity.
- Hospitality depends on Organizations and may reference Events.
- Commerce orchestrates Ticketing and Hospitality through their service contracts.
- Payments processes instructions from Commerce and reports verified outcomes.
- Finance consumes financial facts from Commerce, Payments, Ticketing, Hospitality, and Refunds.
- Connect consumes participation/eligibility facts from Ticketing and Event Access; it does not query or mutate ticket tables directly.
- Notifications and Outbox are shared infrastructure, not substitutes for domain ownership.

Use synchronous service calls when an immediate decision is required, such as reserving inventory. Use durable domain events for downstream work such as notifications and analytics. A database-backed outbox is required when a committed business change must reliably publish an event.

## 3. Conceptual entity relationship diagrams

These diagrams show principal relationships, not every field or join table.

### 3.1 Identity, organizations, and event access

~~~mermaid
erDiagram
  USER ||--o{ ORGANIZATION_MEMBERSHIP : joins
  ORGANIZATION ||--o{ ORGANIZATION_MEMBERSHIP : has
  ORGANIZATION ||--o{ VERIFICATION_CASE : undergoes
  ORGANIZATION ||--o{ EVENT : organizes
  USER ||--o{ EVENT : creates
  EVENT ||--o{ EVENT_STAFF_ASSIGNMENT : assigns
  USER ||--o{ EVENT_STAFF_ASSIGNMENT : receives
  EVENT ||--o{ EVENT_INVITATION : issues
  USER ||--o{ EVENT_INVITATION : receives
  EVENT ||--o{ EVENT_ACCESS_REQUEST : receives
  USER ||--o{ EVENT_ACCESS_REQUEST : submits
  EVENT ||--o{ EVENT_ACCESS_GRANT : grants
  USER ||--o{ EVENT_ACCESS_GRANT : receives
  EVENT ||--o{ EVENT_SCHEDULE : contains
  VENUE ||--o{ EVENT : hosts
~~~

### 3.2 Ticketing, commerce, and payments

~~~mermaid
erDiagram
  EVENT ||--o{ TICKET_TYPE : offers
  TICKET_TYPE ||--|| TICKET_INVENTORY : controls
  TICKET_TYPE ||--o{ TICKET_HOLD : held_as
  USER ||--o{ TICKET_HOLD : creates
  USER ||--o{ ORDER : places
  ORDER ||--o{ ORDER_ITEM : contains
  CHECKOUT ||--|| ORDER : creates
  ORDER_ITEM ||--o| TICKET : fulfils_as
  ORDER_ITEM ||--o| HOSPITALITY_BOOKING : fulfils_as
  TICKET_TYPE ||--o{ TICKET : issues
  USER ||--o{ TICKET : holds
  TICKET ||--o{ TICKET_TRANSFER : transfer_history
  TICKET ||--o{ CHECK_IN : admission_attempts
  ORDER ||--o{ PAYMENT : paid_by
  PAYMENT ||--o{ PAYMENT_ATTEMPT : attempts
  PAYMENT ||--o{ PAYMENT_ALLOCATION : allocates
  ORDER_ITEM ||--o{ PAYMENT_ALLOCATION : funded_by
  PAYMENT ||--o{ REFUND : refunded_by
~~~

### 3.3 Hospitality, Connect, and finance

~~~mermaid
erDiagram
  ORGANIZATION ||--o| HOSPITALITY_PROVIDER : operates
  HOSPITALITY_PROVIDER ||--o{ HOSPITALITY_OFFERING : publishes
  EVENT ||--o{ HOSPITALITY_OFFERING : features
  HOSPITALITY_OFFERING ||--o{ INVENTORY_RESOURCE : has
  HOSPITALITY_OFFERING ||--o{ HOSPITALITY_BOOKING : booked_as
  HOSPITALITY_BOOKING ||--o{ FULFILMENT : fulfilled_by
  EVENT ||--o{ EVENT_PARTICIPATION : scopes
  USER ||--o{ EVENT_PARTICIPATION : participates
  EVENT_PARTICIPATION ||--o{ CONNECT_CONSENT : controls
  CONNECT_CONNECTION }o--|| EVENT_PARTICIPATION : participant
  CONNECT_CONNECTION ||--o| CONVERSATION : enables
  CONVERSATION ||--o{ MESSAGE : contains
  USER ||--o{ MESSAGE : sends
  LEDGER_ACCOUNT ||--o{ JOURNAL_LINE : records
  JOURNAL_ENTRY ||--|{ JOURNAL_LINE : balances
  SETTLEMENT_BATCH ||--o{ SETTLEMENT_LINE : contains
  SETTLEMENT_BATCH ||--o{ PAYOUT : executes
~~~

The diagrams are conceptual. The physical schema must use explicit foreign keys, unique constraints, appropriate check constraints, and database transactions. Some infrastructure metadata relationships are intentionally omitted.

## 4. Relationship rules

### 4.1 Identity and organizations

- A User may have many OrganizationMembership records.
- An Organization has memberships and may own many events.
- Membership role/status is scoped to the organization. A single global role on User must not be the authorization source.
- Event staff assignments are scoped to one event and one user, optionally requiring valid organization membership.
- Verification is a case/history, not a boolean that erases reviewer, reason, or decision history.

### 4.2 Events and access

- An event belongs to one owning organization and records its creating user.
- An event may contain multiple schedules or sessions.
- A venue may host many events over time.
- Visibility (public, unlisted, invitation-only) is distinct from purchase policy.
- An access request, invitation, and access grant are distinct records.
- Organizer approval permits the approved purchase/access path; it does not issue a ticket or prove payment.
- Admin oversight is an intervention and audit capability, not a requirement that every event be manually approved.

### 4.3 Ticketing

- A ticket type belongs to one event.
- A ticket inventory record is scoped to a ticket type, unless a reviewed inventory-pool design is required.
- A hold reserves inventory temporarily and must expire or be consumed exactly once.
- A ticket has one current holder and one event/ticket type. Transfer history is retained separately.
- Check-in records are append-only attempts/outcomes. Repeated scans must not create multiple admissions.
- Ticket state changes use validated transitions, not arbitrary controller updates.

### 4.4 Commerce and payments

- A checkout creates one order in the initial model.
- An order contains one or more order items.
- Each order item snapshots description, quantity, unit amount, fee treatment, policy references, and supplier/organizer allocation context at purchase time.
- Each order item is fulfilled by a typed domain record such as Ticket or HospitalityBooking.
- An order may have multiple payment attempts. Retries must not duplicate order items or fulfilments.
- PaymentAllocation records how a verified collection funds order items and supports partial refunds/reconciliation.
- Provider payment status is not the fulfilment status of an order item.

### 4.5 Hospitality

- A HospitalityProvider is an approved provider profile associated with an Organization. Organizer-provided hospitality still needs an accountable owner and applicable approval status.
- A provider can publish offerings for multiple events.
- An offering may be event-specific or provider-wide only if policy explicitly permits it.
- Inventory resources represent the scarce thing sold: quantity, capacity, time slot, room, or room-night.
- A booking references one offering and one order item; it may have multiple fulfilment steps.
- Provider-confirmed bookings remain pending until provider acceptance. Customer payment alone does not prove supplier acceptance.

### 4.6 Connect

- EventParticipation is one user's participation record for one event; enforce uniqueness on (eventId, userId).
- Eligibility requires a current active verified ticket or approved guest grant. Registration, a pending request, or a cancelled/refunded ticket is insufficient.
- ConnectConsent is a separate event-scoped record; eligibility does not imply opt-in.
- A connection joins two distinct participation records from the same event. Normalize participant ordering and enforce uniqueness.
- A conversation belongs to a connection. Message authorization checks current connection state, blocks, moderation restrictions, and current event/post-event access policy.
- Ticket cancellation/refund immediately revokes event eligibility. The authoritative authorization path must enforce this synchronously; asynchronous cleanup is not sufficient.
- Existing connections may remain available for a configured post-event period. Duration is unresolved and must be configurable.
- Organizer/provider roles do not grant access to attendee conversations or private hospitality details.

### 4.7 Finance

- Journal entries contain two or more lines and balance per currency.
- Journal lines reference ledger accounts and retain source references.
- Posted journal entries are immutable. Corrections use reversal and replacement entries.
- A settlement batch groups eligible payable amounts for an organizer or provider.
- Settlement lines explain included, withheld, reserved, released, or adjusted payable obligations.
- A payout is an execution attempt against an approved settlement amount. A failed payout does not erase the payable liability.
- Settlement milestones are data-driven and versioned. Percentages, dates, reserves, and exact release conditions remain unresolved.

## 5. Principal data dictionary

This is the conceptual minimum, not a final scalar-field specification.

### 5.1 Identity and organizations

| Entity | Owner | Purpose |
|---|---|---|
| User | Identity | Account identity, authentication subject, account status |
| UserProfile | Identity | User-controlled profile attributes; separate public and private fields |
| Session | Identity | Revocable authenticated session/device record |
| Organization | Organizations | Organizer or hospitality business identity |
| OrganizationMembership | Organizations | Scoped user relationship, role, and membership status |
| VerificationCase | Organizations / Trust | Subject, evidence references, decision, reviewer, timestamps, reason, history |
| EventStaffAssignment | Events / Access | Event-specific staff assignment and permission set |

### 5.2 Events and access

| Entity | Owner | Purpose |
|---|---|---|
| Event | Events | Owner organization, creator, lifecycle, visibility, access and venue disclosure policies |
| EventSchedule | Events | Start/end times, timezone, session/occurrence identity |
| Venue | Events | Venue/location; exact address may require restricted access |
| EventInvitation | Event Access | Recipient, inviter, status, expiry, response |
| EventAccessRequest | Event Access | Request, review status, reviewer, reason, timestamps |
| EventAccessGrant | Event Access | Approved access entitlement, source and revocation details |
| EventModerationCase | Trust | Platform oversight, restrictions, suspension, takedown history |

### 5.3 Ticketing and admission

| Entity | Owner | Purpose |
|---|---|---|
| TicketType | Ticketing | Event admission category, price reference, sales window, benefits |
| TicketInventory | Ticketing | Capacity and reserved/issued inventory controls |
| TicketHold | Ticketing | Temporary inventory hold, expiry, owner, consume/release state |
| Ticket | Ticketing | Issued admission credential, current holder, status, order-item source |
| TicketTransfer | Ticketing | Transfer request/acceptance history and old/new holder |
| CheckIn | Ticketing / Operations | Scan outcome, staff/device, timestamp |
| TicketEntitlement | Ticketing | Included benefit, quantity, validity, redemption policy |
| EntitlementRedemption | Ticketing / Operations | Auditable benefit use or reversal |

### 5.4 Hospitality

| Entity | Owner | Purpose |
|---|---|---|
| HospitalityProvider | Hospitality | Approved provider profile linked to an organization |
| HospitalityOffering | Hospitality | Accommodation, table, dining, transport, voucher, experience |
| OfferingEvent | Hospitality | Explicit join when an offering serves multiple events |
| InventoryResource | Hospitality | Resource being reserved: room, table, capacity pool, voucher pool |
| InventorySlot | Hospitality | Date/time or room-night availability slice |
| InventoryHold | Hospitality | Temporary resource reservation with expiry and concurrency-safe allocation |
| HospitalityBooking | Hospitality | Customer booking, provider, offering, order item, status, price and policy snapshots |
| HospitalityFulfilment | Hospitality | Provider acceptance, service delivery, rejection, failure, completion |
| HospitalityRedemption | Hospitality / Operations | Voucher/benefit redemption, staff, timestamp |

**Inventory warning:** Do not model all inventory as one integer availableQuantity. Room-night ranges and time-bound tables require conflict-aware allocations. The final design may use typed inventory tables for accommodation, time slots, and quantity pools.

### 5.5 Commerce, payments, refunds

| Entity | Owner | Purpose |
|---|---|---|
| Cart | Commerce | Mutable pre-purchase selection; not financial truth |
| Checkout | Commerce | Checkout attempt, idempotency key, totals and outcome |
| Order | Commerce | Durable commercial purchase aggregate and customer |
| OrderItem | Commerce | Independently priced/fulfilled item with immutable purchase snapshot |
| Payment | Payments | Verified collection intent/transaction and provider references |
| PaymentAttempt | Payments | Provider attempt, request/response references and status |
| PaymentAllocation | Payments / Finance | Allocation of collection to order items and currency |
| Refund | Payments | Refund execution state, amount, provider reference and reason |
| RefundAllocation | Payments / Finance | Refund amount attributed to items and financial obligations |

### 5.6 Finance and settlement

| Entity | Owner | Purpose |
|---|---|---|
| LedgerAccount | Finance | Chart-of-accounts account, owner/scope, currency, account type |
| JournalEntry | Finance | Immutable accounting event, source, posting time, reversal relationship |
| JournalLine | Finance | Debit/credit amount, currency, ledger account |
| FeeRule | Finance / Commerce | Versioned customer fee/commission rule and effective dates |
| FeeSnapshot | Commerce / Finance | Exact fee calculation applied to a purchase item |
| SettlementPolicy | Finance | Versioned milestone/reserve policy for organizer/provider class |
| SettlementMilestone | Finance | Configurable eligibility/release condition and amount/percentage rule |
| SettlementBatch | Finance | Approved settlement grouping and status |
| SettlementLine | Finance | Traceable payable allocation, reserve, hold, release, adjustment |
| Payout | Finance | Payout execution and reconciliation reference |
| ReconciliationRun | Finance | Comparison of internal records with provider/bank statements |
| ReconciliationItem | Finance | Matched, unmatched, or exception record |

### 5.7 Connect and trust

| Entity | Owner | Purpose |
|---|---|---|
| EventParticipation | Connect | Event-scoped participant projection and current eligibility source/status |
| ConnectConsent | Connect | Opt-in scope, policy version, withdrawal and timestamps |
| ConnectPreference | Connect | Discovery and profile visibility preferences |
| ConnectConnection | Connect | Mutual connection between two participants of one event |
| Conversation | Connect | Conversation enabled by a valid connection |
| Message | Connect | Message content/reference, sender, status, moderation metadata |
| ConnectBlock | Connect | Directional block relation and timestamps |
| ConnectReport | Connect / Trust | Reported participant/content, reason, evidence and outcome |
| ModerationCase | Trust | Investigation and enforcement history |

### 5.8 Platform operations

| Entity | Owner | Purpose |
|---|---|---|
| SupportCase | Support | Customer/organizer/provider issue, assignment, status, resolution |
| AuditLog | Platform | Actor, action, resource, reason, timestamp, safe metadata |
| OutboxEvent | Infrastructure | Domain event committed with source transaction |
| JobExecution | Infrastructure | Durable worker attempt, retry, result, failure metadata |
| Notification | Notifications | Recipient, channel, template/version, delivery state |
| ExternalIntegration | Infrastructure | Provider configuration/reference and integration health |

## 6. Integrity, uniqueness, and concurrency constraints

| Area | Required invariant |
|---|---|
| Membership | Unique active membership for (organizationId, userId), unless explicit membership versioning is used |
| Event participation | Unique (eventId, userId) |
| Ticket type | Belongs to exactly one event |
| Ticket issuance | Idempotent per order item; no duplicate active ticket for one fulfilled ticket item |
| Ticket hold | Held quantity cannot exceed available inventory; expiry/release/consume occurs once |
| Check-in | One successful admission per ticket unless explicit re-entry policy exists |
| Access grant | No duplicate active grant for the same event/user/source scope |
| Provider offering | Provider must be approved and active before new sales |
| Inventory allocation | No overlapping allocation for exclusive room/table resources; aggregate quantity cannot exceed capacity |
| Booking | Provider acceptance and customer payment are separate states |
| Order item | Purchase snapshot is immutable except through explicit adjustment records |
| Payment | Provider transaction/reference unique in provider/account scope |
| Payment allocation | Cannot exceed verified captured amount |
| Refund | Cumulative successful refunds cannot exceed refundable captured amount |
| Ledger | Debits equal credits per journal entry and currency |
| Ledger immutability | Posted entries cannot be edited/deleted |
| Settlement | Payout cannot exceed approved, reconciled, available payable balance |
| Connect connection | Unique normalized participant pair per event; both belong to same event |
| Connect message | Sender is a conversation participant and currently authorized |
| Outbox | Event identity/deduplication key unique for originating domain transition |

### 6.1 Concurrency strategy

- Use short database transactions for inventory holds and state transitions.
- Use conditional updates or row locks for quantity inventory.
- Use database constraints/locking to prevent overlapping room/table allocations.
- Never keep a database transaction open while waiting for an external provider response.
- Use idempotency keys for checkout, payment initiation, ticket issuance, refunds, and payouts.
- Use a transactional outbox for committed events.
- Expiry workers use conditional state transitions so a hold cannot be both consumed and released.
- Race-condition tests must run against PostgreSQL, not only mocked repositories.

## 7. Cross-domain events

| Event | Authoritative owner | Consumer responsibility |
|---|---|---|
| OrganizerVerified | Organizations | Events enables eligible publishing |
| EventPublished | Events | Discovery, notifications, analytics |
| EventAccessGranted | Event Access | Ticketing permits approved purchase path |
| EventAccessRevoked | Event Access | Ticketing/Operations reevaluate admission; Connect revokes eligibility |
| TicketHoldCreated | Ticketing | Commerce updates checkout |
| TicketIssued | Ticketing | Connect reevaluates eligibility; Notifications sends access |
| TicketCancelled | Ticketing | Connect immediately revokes eligibility; Finance evaluates reversals |
| PaymentVerified | Payments | Commerce advances paid state; fulfilment is requested; Finance posts collection |
| PaymentFailed | Payments | Commerce applies retry/failure policy; holds may expire |
| HospitalityBookingRequested | Hospitality | Provider or instant-confirmation workflow |
| HospitalityBookingConfirmed | Hospitality | Commerce marks item fulfilled; Notifications confirms |
| HospitalityBookingRejected | Hospitality | Commerce/Payments apply cancellation/refund policy; Finance records liabilities |
| RefundCompleted | Payments | Ticketing invalidates admission; Connect revokes eligibility; Finance posts reversal |
| EventCancelled | Events | Each affected domain executes its own cancellation policy |
| EventCompleted | Events | Finance calculates final settlement eligibility; Connect starts retention window |
| SettlementApproved | Finance | Payout execution begins |
| PayoutSucceeded | Finance | Payable is settled and reconciliation updated |
| PayoutFailed | Finance | Payable remains outstanding; retry/review is scheduled |

Events are integration contracts, not permission to mutate another domain's tables. Consumers invoke the owning service or update their own projections.

## 8. State machine requirements

Exact enum names require naming review, but every transition must be explicit and validated.

- **Event:** draft → published → ongoing → completed. Controlled alternatives include postponed, cancelled, suspended, and sales_paused. Moderation state should be separate where possible.
- **Event access:** requested → approved/rejected; approved access may later be revoked or expired. Invitations have their own pending/accepted/declined/expired/revoked lifecycle.
- **Ticket hold:** active → consumed/released/expired. Terminal transitions are idempotent.
- **Ticket:** issued → transferred (with history), checked_in, cancelled, refunded, or voided under policy. Transfer must never create two valid holders.
- **Instant hospitality:** held → payment_pending → confirmed → fulfilled, with expired/cancelled/refunded/disputed paths.
- **Provider-confirmed hospitality:** pending_provider → accepted → confirmed → fulfilled, or rejected/expired/cancelled. Payment authorization/capture while pending remains unresolved.
- **Order:** pending → paid/partially_paid → partially_fulfilled/fulfilled. Item-level outcomes must not be collapsed into one order status.
- **Payment:** provider-attempt states and internally verified collection states are distinct. A client redirect is not proof of payment.
- **Settlement:** draft → calculated → under_review → approved → processing → partially_paid/paid. Failure and hold states preserve payable liability.
- **Connect:** eligibility, consent, connection status, and conversation access are separate. Eligibility can be revoked immediately without erasing audit history.

## 9. Prisma design constraints

This section guides a future schema review; it is not a generated Prisma schema.

### 9.1 General conventions

- Confirm PostgreSQL and Prisma as the final stack before implementation.
- Prefer UUID identifiers unless a reviewed domain reason requires otherwise.
- Use explicit relation names for multiple User relations (creator, owner, reviewer, sender, recipient).
- Use database foreign keys and appropriate delete restrictions.
- Use Restrict/controlled archival for financial, ticket, access, and audit records. Cascading deletion is inappropriate for immutable financial history.
- For NGN, store payment amounts in integer minor units (kobo) using BigInt or a deliberately bounded integer strategy. Document provider limits.
- Store currency on every monetary aggregate/ledger line; do not assume all future records are NGN.
- Store timestamps in UTC and retain event/provider timezone as an IANA timezone identifier.
- Use enums for stable finite states; use versioned policy records for changing business rules.
- Add createdAt/updatedAt where meaningful; append-only records should not pretend to be mutable.
- Avoid JSON for fields needing relational constraints, authorization, reporting, or joins. JSON is suitable for bounded provider payload snapshots and controlled metadata.

### 9.2 Money and ledger

- Monetary fields identify currency and minor-unit semantics.
- Snapshot applied prices and fee rules on each order item.
- Use immutable journal entry and line models.
- Enforce balanced posting in a single transaction and verify it in service logic; add database safeguards where feasible.
- Corrections post reversals, never edit posted lines.
- Do not derive financial truth from mutable cached balances.

### 9.3 Inventory and booking

- An availability read followed by an unguarded booking insert is race-prone.
- Implement atomic holds with expiry and unique/overlap protections.
- Room-night allocation must detect conflicts for every night in a stay.
- Time-slot resources need overlap prevention.
- Provider-confirmed and instant-confirmed offerings need explicit confirmation modes and distinct transitions.
- Do not call provider inventory reliable unless controlled by the platform or synchronized under sufficiently fresh, contractually reliable guarantees.

### 9.4 Connect authorization

- EventParticipation is a scoped projection, not the source of admission rights.
- Reevaluate ticket/access status when authorizing discovery, connection, or message operations.
- On cancellation/refund, update the authoritative eligibility path in the same business operation where possible; outbox events handle downstream cleanup.
- Enforce connection uniqueness, same-event membership, mutual consent, blocking, moderation, and post-event access in services.
- Do not expose discovery through unscoped global user search.

### 9.5 External side effects

- Provider calls happen outside long-running database transactions.
- Persist provider attempt references and idempotency keys according to provider contract.
- Webhook signature validation, replay protection, and idempotent processing are mandatory.
- Reconcile provider statements against internal payment and ledger records.
- Reconcile provider refund success with internal reversal posting.

### 9.6 Deletion and retention

- Financial records, ticket admission history, moderation evidence, and audit records require retention policies and controlled access.
- User deletion must not cascade-delete records that must be retained for legal/accounting reasons.
- Use pseudonymization or restricted access where deletion of direct identifiers is required and legally permissible.
- Connect message/profile retention remains undecided; post-event connection duration must be configurable.
- Venue addresses, identity evidence, and hospitality details require least-privilege access and retention controls.

## 10. Security and authorization invariants

1. Verified organizers may publish eligible events without manual event-by-event approval; platform oversight, moderation, suspension, and takedown powers remain.
2. Private-event access is approved by the organizer or authorized event manager, with platform admin oversight.
3. Access approval does not create a ticket or prove payment.
4. Only the current holder may use an active ticket, subject to event policy.
5. Ticket cancellation/refund immediately revokes Connect eligibility.
6. Connect requires both current eligibility and explicit event-scoped consent.
7. Organizers and providers cannot read attendee private messages.
8. Hospitality providers access only their own offerings, inventory, bookings, and minimum fulfilment data.
9. Exact private venue details are not exposed through public event endpoints or search metadata.
10. Finance permissions are distinct from general event administration.
11. Privileged overrides, refund decisions, manual adjustments, and settlement approvals are audited.
12. Support access to sensitive records is purpose-limited and logged.

## 11. Unresolved decisions affecting physical schema

| ID | Decision | Why it matters |
|---|---|---|
| DM-OPEN-001 | Exact post-event Connect retention duration | Expiry policy and access enforcement |
| DM-OPEN-002 | Settlement milestones, percentages, reserves, release conditions | Versioned settlement rules and payable lifecycle |
| DM-OPEN-003 | Payment authorization/capture while provider-confirmed accommodation is pending | Payment/refund state transitions |
| DM-OPEN-004 | Whether organizer-supplied accommodation follows the same provider approval workflow | Provider ownership and authorization |
| DM-OPEN-005 | Whether event cancellation automatically cancels hospitality bookings or permits provider exceptions | Cross-domain cancellation orchestration |
| DM-OPEN-006 | External hotel inventory integration and synchronization guarantees | Inventory source of truth |
| DM-OPEN-007 | Ticket transfer rules after Connect opt-in | Participant eligibility and ownership transitions |
| DM-OPEN-008 | Fee treatment for accommodation, drinks, and other hospitality items | Fee snapshots and payable allocation |
| DM-OPEN-009 | Refund cost/liability after organizer or provider has been settled | Ledger, reserves, recovery, negative balances |
| DM-OPEN-010 | Launch cities and venue/geography reference source | Geography seed and discovery constraints |
| DM-OPEN-011 | Final runtime, payment provider, email, media, hosting, and worker choices | Integration and operational design |

The organizer settlement model is confirmed as milestone releases with a final post-event balance. The exact milestone configuration remains open; settlement timing is not wholly undecided.

## 12. Review gates before Prisma implementation

- [ ] Resolve open policies in Section 11 that affect persistence and transaction design.
- [ ] Review the ERD against real customer, organizer, provider, and finance workflows.
- [ ] Define exact state-transition tables and forbidden transitions.
- [ ] Define currency and minor-unit limits for payment providers.
- [ ] Decide inventory representation for room-night, time-slot, capacity, and quantity resources.
- [ ] Define idempotency scope/retention for checkout, payment, ticket issuance, refund, and payout.
- [ ] Define event and order-item cancellation/refund orchestration.
- [ ] Define settlement accounting entries, reserves, and payout reconciliation.
- [ ] Define Connect eligibility revocation and post-event retention enforcement.
- [ ] Review privacy, access controls, retention, and audit requirements.
- [ ] Review indexes, unique constraints, deletion policies, and concurrency tests.
- [ ] Produce a migration plan only after conceptual and physical models are approved.

## 13. Implementation boundary

This document authorizes design discussion and review only. It does not authorize:

- Creating a Prisma schema or migration.
- Building backend or frontend modules.
- Selecting or provisioning payment, email, media, or hosting providers.
- Setting fee percentages, settlement percentages, reserve amounts, or retention durations.
- Reusing Jami source code or schemas.

The Events platform should learn from Jami's failure modes without inheriting its implementation. Domain boundaries, explicit contracts, transactional correctness, authorization, and failure-path testing must be designed independently.

---

**Document status:** Conceptual domain model for review. Confirmed product decisions remain in the root README. Unresolved decisions are listed explicitly above.
