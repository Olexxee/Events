# Event Marketplace — Design Gate

**Status:** Proposed MVP policy; review before schema implementation
**Owner:** Events
**Depends on:** Identity & Access and approved organizer applications
**Adjacent domains:** Event Access, Ticketing & Admission, Hospitality, Finance

This design defines the event record, publishing, discovery, schedule, venue disclosure, and moderation boundaries. It does not authorize ticket inventory, checkout, payment, ticket issuance, or hospitality inventory implementation.

## 1. Product boundaries

- Events are owned by an Organization and created by an active organization member with event-management authority.
- Only an organization with an approved organizer application may publish events.
- An organizer may create drafts before approval, but cannot publish until the organization is approved.
- An approved organizer may publish eligible events without manual approval of every event.
- Event visibility, purchase/access policy, ticket inventory, admission, and moderation are separate concerns.
- Platform moderation, restrictions, suspension, and takedown remain available.
- Event cancellation and material changes must be auditable and must trigger the applicable customer-notification/refund workflow in later phases.

## 2. Recommended event classification

Do not overload one `type` field with unrelated concepts.

| Concern | Recommended field | Values / examples |
|---|---|---|
| Category | `category` | Music, nightlife, conference, workshop, sports, community, food, arts, education, other |
| Delivery format | `format` | In-person, online, hybrid |
| Visibility | `visibility` | Public, unlisted, invitation-only |
| Purchase/access policy | `accessPolicy` | Open, approval-required, invitation-only |
| Experience positioning | `experienceLevel` (optional) | Standard, premium |

Public/private is not an event category. It is handled through visibility and access policy. Premium is an experience/commercial positioning, not a separate event lifecycle or backend.

Categories should be a controlled, versioned taxonomy with an `OTHER` option rather than a rigid database enum that requires a migration for every new category. Category-specific requirements can be introduced through policy configuration.

## 3. Event lifecycle and moderation

Recommended business lifecycle:

- `DRAFT`: editable; not discoverable or purchasable.
- `PUBLISHED`: eligible for discovery according to visibility and access policy.
- `SALES_PAUSED`: event remains visible, but new purchases are disabled by the later ticketing domain.
- `ONGOING`: event has started and is in progress.
- `COMPLETED`: event has ended.
- `POSTPONED`: date/time has changed and replacement schedule/customer options are being coordinated.
- `CANCELLED`: event is cancelled under platform policy.

Do not store `SOLD_OUT` as the event's primary lifecycle state. It is derived from ticket inventory and can change independently of the event itself.

Moderation is separate from business lifecycle. A moderation restriction/suspension/takedown must be able to block discovery or publishing without rewriting the event's business history. Clients cannot set moderation state.

## 4. Schedule and timezone

- An event may contain one or more schedules/sessions.
- Store event instants in UTC and retain an IANA timezone identifier (for example, `Africa/Lagos`) for display and local-time rules.
- A schedule has a start and end; end must be after start.
- Multi-day and recurring events should use explicit schedule records, not infer occurrences from one start/end pair.
- Changing a schedule after sales begin is a material change and must be versioned and communicated.

## 5. Venue and location disclosure

- Online events do not require a physical venue.
- In-person and hybrid events may reference a venue.
- Public discovery may show city/state and a venue display name where policy permits.
- Exact venue address, access instructions, private links, and security-sensitive details must not be returned by public event/search endpoints.
- For private or invitation-only events, exact details are disclosed only after the relevant access grant or purchase condition is satisfied.
- Venue data must distinguish public display fields from restricted location details. Authorization is checked server-side on every restricted read.

## 6. Publishing authorization

The publishing service must verify all of the following at request time:

1. The owning organization is active.
2. The organization has a current approved organizer application.
3. The acting user has an active organization membership and the required event-management permission.
4. No platform restriction, moderation hold, suspension, or takedown blocks publishing.
5. Required event fields and schedule/venue rules are valid.

Do not trust client-provided organizer status, a cached approval badge, or a stale event projection. Suspension/revocation must block new publishing synchronously.

The initial permission recommendation is OWNER and ADMIN can create/manage events; MEMBER cannot unless a future event-specific staff assignment grants a narrower capability.

## 7. Material changes and cancellation

After an event is published, changes to date/time, venue, access policy, ticket benefits, or other customer-facing commitments must create an auditable event revision.

After ticket sales begin:
- Material changes trigger notification to affected customers.
- Customers receive the applicable refund, transfer, or acceptance options under the policy for that change.
- Organizers cannot silently remove or materially reduce purchased benefits.
- Event cancellation initiates the separate refund and linked-hospitality assessment workflows; it does not directly mutate payment or reservation records.

Exact refund windows and financial allocation rules belong to Ticketing/Finance design, not the Event aggregate.

## 8. MVP scope and API boundaries

The first Event module should cover:
- Create and manage drafts.
- Publish and unpublish/pause discovery where authorized.
- Edit event details with revision history.
- Manage one or more schedules.
- Attach a venue with restricted detail access.
- Browse/search public events and resolve unlisted/private events only through authorized paths.
- Record moderation restrictions and audit actions.

Not included in this phase:
- Ticket types, inventory, holds, checkout, payments, ticket issuance, QR admission, or refunds.
- Hospitality offerings, room/table/drink inventory, or reservations.
- Connect profiles, messaging, or attendee discovery.
- Organizer settlements or pricing/commission logic.

Event Access remains a separate domain for invitations, access requests, grants, and revocation. Ticketing consumes those access decisions but remains authoritative for paid admission.

## 9. Required invariants and tests

1. An unapproved or inactive organization cannot publish.
2. A user cannot manage an event outside their active organization membership and permissions.
3. A client cannot set moderation or publication authorization state.
4. Public event responses never expose restricted venue details or private links.
5. Visibility and purchase/access policy are independent and tested as separate dimensions.
6. `SOLD_OUT` is derived from inventory, not persisted as an event lifecycle state.
7. Event schedule end is after start; timezone is a valid IANA identifier.
8. Material changes create a revision and audit record.
9. Concurrent publication/suspension operations cannot leave an event publicly visible after a restriction commits.
10. Event cancellation does not directly mutate ticket, payment, hospitality, or ledger records.

Required tests include unauthorized organization access, unapproved organizer publishing, moderation enforcement, public/private venue serialization, invalid schedules/timezones, revision history, and concurrent publish/restrict behaviour.

## 10. Decisions to confirm

The recommended defaults above should be confirmed before Prisma schema and API implementation. The most consequential product choice is the category taxonomy; it should be extensible and should not conflate category with public/private/premium presentation.
