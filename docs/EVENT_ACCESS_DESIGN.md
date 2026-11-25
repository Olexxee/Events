# Event Access — Design Gate

**Status:** Proposed policy; approval required before schema/API implementation  
**Owner:** Event Access  
**Depends on:** Identity & Access, Organizations, and the Event marketplace  
**Integrates with:** Ticketing & Admission, Notifications, Trust & Safety

Event Access controls invitations, access requests, organizer decisions, and event-scoped access grants. It does not issue tickets, reserve inventory, process payments, or validate admission.

## 1. Confirmed product requirements

The product blueprint establishes these requirements:

- Private-event access is controlled by organizer approval, with platform-admin oversight.
- Public, unlisted, and invitation-only visibility are distinct from open, approval-required, and invitation-only purchase/access policies.
- A private event may disclose its city or general area before purchase while withholding its exact address and sensitive entry instructions until the defined post-purchase point.
- Exact venue data must not leak through public APIs, metadata, search indexing, or unauthenticated endpoints.
- Access to restricted event details must be reviewed or revoked when a ticket is refunded or revoked, as applicable.
- Connect eligibility can include verified ticket holders and organizer-approved guests, but only with separate event-scoped opt-in.
- Event Access grants are not tickets, do not reserve capacity, and do not guarantee admission.

The exact venue-disclosure timing and some guest-approval details remain unresolved in the product blueprint. This design must not silently finalize them.

## 2. Domain boundary and terminology

Keep four facts separate:

1. **Invitation:** an organizer-issued offer to a named person to access an event under stated conditions.
2. **Access request:** an authenticated user's request for organizer approval.
3. **Access grant:** a revocable, event-scoped authorization created by an accepted invitation or approved request (or an explicitly audited platform action).
4. **Ticket/admission:** a separate Ticketing-owned purchase, ticket, inventory, and check-in fact.

A grant can authorize a user to view restricted event details and/or proceed to checkout according to the event's policy. It must never represent a paid ticket, capacity reservation, or successful admission.

## 3. Visibility and access-policy matrix

Visibility controls who can discover or resolve an event. Access policy controls who can proceed to checkout after resolving the event. These dimensions remain independent.

| Visibility | Discovery/detail resolution | Access-policy effect |
|---|---|---|
| PUBLIC | Public listing and public event summary are available | OPEN permits checkout; APPROVAL_REQUIRED requires an active grant; INVITATION_ONLY requires an invitation-backed grant |
| UNLISTED | Not listed in search; link can resolve a safe event summary | Same checkout rules as above; an unlisted URL is not an access grant |
| INVITATION_ONLY | Full event detail is available only to users with an active event grant | OPEN means any granted viewer may proceed to checkout; APPROVAL_REQUIRED additionally requires an approved request; INVITATION_ONLY requires an invitation-backed grant |

Recommended guardrails:

- A guessed event UUID or slug must not bypass visibility or grant checks.
- Public discovery and public event endpoints must never return restricted fields.
- A shareable unlisted URL is not secret authentication.
- A valid access grant does not bypass ticket inventory, payment, age, capacity, or admission rules.
- A grant does not reveal the exact venue address before the separate post-purchase disclosure condition is met.
- Invitation-only visibility is a strict identity gate even when the checkout policy is OPEN.

## 4. Proposed lifecycle models

### 4.1 Invitation

Recommended states:

- PENDING: issued and awaiting acceptance.
- ACCEPTED: accepted by the intended account; creates or activates an access grant.
- DECLINED: declined by recipient.
- EXPIRED: expiry reached before acceptance.
- REVOKED: organizer or authorized platform action invalidated it before acceptance.

An invitation is single-use and bound to one event and one intended recipient. Reissuing an invitation creates a new invitation record; it does not reactivate a revoked or expired token.

### 4.2 Access request

Recommended states:

- SUBMITTED: awaiting organizer decision.
- APPROVED: approved; creates an access grant.
- REJECTED: declined by organizer with a recorded reason.
- WITHDRAWN: withdrawn by the requester before decision.

Rules:
- Only authenticated, active accounts can request access.
- Only events with accessPolicy=APPROVAL_REQUIRED accept access requests.
- One pending request per user/event.
- A requester may withdraw a pending request.
- A rejected user may submit a new request only if the organizer has not blocked further requests and the event remains eligible.
- Request text should be optional, short, and must not invite sensitive personal information.

### 4.3 Access grant

Recommended states:

- ACTIVE
- REVOKED
- EXPIRED

Every grant records its source: approved request, accepted invitation, or audited platform action. It is scoped to one user and one event and carries explicit permissions (for example, resolve restricted event details and/or proceed to checkout). No broad organization or platform permission is implied.

Revocation is immediate for subsequent access checks. It must be audited with actor, timestamp, reason, and source. Revoking a grant does not silently refund or cancel a separately purchased ticket; Ticketing and Finance own those outcomes under their policies.

## 5. Organizer and platform permissions

Recommended initial authority:

- Active organization OWNER and ADMIN can issue invitations, review requests, approve/reject, and revoke organizer-issued grants for their events.
- Organization MEMBER has no Event Access management authority unless a later event-staff permission is explicitly granted.
- Platform admins have oversight visibility and may place an access-control hold or revoke a grant for a documented safety, fraud, legal, or policy reason.
- Platform admins do not routinely replace organizer decisions or approve requests on an organizer's behalf.
- Every platform intervention requires a reason and immutable audit record.
- A platform hold must block new grants and relevant restricted reads until resolved.

The service must re-check active organization membership, organization status, event status, organizer approval where required, and moderation restrictions at action time. Client-supplied roles or approval flags are never trusted.

## 6. Recipient identity and invitation delivery

**Recommendation for MVP:** issue invitations to an existing Events account, identified by its verified account email. The recipient must authenticate as that account to accept.

Do not put raw access tokens in database rows. Invitation acceptance tokens should be cryptographically random, stored only as a one-way digest, single-use, time-limited, and compared in constant time where applicable. Do not expose whether an email address belongs to an account through public responses.

External recipients without an account, phone-based invitations, bulk guest-list imports, and reusable household/group invitations should be deferred until registration binding, notification delivery, consent, and abuse controls are designed.

## 7. Expiry, revocation, and event changes

Recommended defaults to confirm:

- Invitations expire after 7 days unless the organizer chooses a shorter event-specific expiry.
- An access grant expires at the event's configured access cutoff, or at event completion if no earlier cutoff is configured.
- Pending access requests close when the event is cancelled, completed, or access requests are disabled.
- Event cancellation, postponement, organizer suspension, moderation restriction, and event visibility/access-policy changes trigger a synchronous access re-evaluation.
- Event cancellation or a restrictive policy change must not leave old invitation tokens usable.
- Revocation and expiry do not erase history.

The product owner must decide whether grants survive a change from PUBLIC/UNLISTED to INVITATION_ONLY, and what happens to already approved users when an organizer changes the access policy after requests have been submitted.

## 8. API surface proposal

Illustrative routes; final route naming follows existing /api/v1 conventions:

- POST /events/:eventId/access-requests — submit request.
- GET /me/events/:eventId/access — resolve the caller's own access state.
- DELETE /events/:eventId/access-requests/:requestId — withdraw pending request.
- GET /organizations/:organizationId/events/:eventId/access-requests — organizer review queue.
- POST /organizations/:organizationId/events/:eventId/access-requests/:requestId/decision — approve/reject.
- POST /organizations/:organizationId/events/:eventId/invitations — issue invitation.
- POST /event-invitations/:token/accept and /decline — recipient action.
- POST /organizations/:organizationId/events/:eventId/access-grants/:grantId/revoke — revoke organizer-issued grant.
- Platform-only oversight routes — inspect event access decisions and apply/release a documented access hold.

The API must not return other invitees, guest lists, or requesters' personal data to ordinary attendees.

## 9. Persistence and reliability requirements

Likely records:

- EventInvitation
- EventAccessRequest
- EventAccessGrant
- EventAccessHold (if platform-wide/event-wide holds are approved)

Required database protections:

- Foreign keys to event, organization, user, and actor records where appropriate.
- Unique active/pending invitation and request constraints scoped to event and recipient.
- One active grant per event/user, with an explicit way to record multiple grant sources without duplicate active authorization.
- Token digests only; no plaintext invitation tokens.
- State transitions guarded by conditional updates to prevent double acceptance or concurrent contradictory decisions.
- Audit log and transactional outbox writes in the same transaction as state changes.
- Idempotency for invitation acceptance and organizer decisions.
- Expiry enforced at read/action time; background jobs may clean up projections but are not the authorization source of truth.
- Rate limits for request creation, invitation issuance, token attempts, and review actions.

## 10. Required integration and security tests

- A public event can be discovered without an access grant, while a restricted event cannot be resolved by an unauthorized user.
- An unlisted URL does not create a grant or bypass access policy.
- A request is accepted only for APPROVAL_REQUIRED events and only from an authenticated active user.
- A user cannot request twice while a request is pending.
- Only an active OWNER/ADMIN can review or issue organizer invitations.
- An accepted invitation is bound to its intended account, is single-use, and creates one grant.
- Expired, revoked, or guessed invitation tokens fail without revealing recipient existence.
- A grant never creates a ticket, reserves inventory, or marks admission complete.
- Revocation blocks subsequent restricted reads and checkout authorization.
- Public event responses never disclose exact address, access instructions, or private links.
- Platform interventions are permission-checked, reasoned, and audited.
- Concurrent acceptance, approval, rejection, and revocation cannot create contradictory active states.
- Event cancellation and organizer suspension invalidate the applicable access pathways without mutating ticket/payment/ledger records.

## 11. Decisions required before implementation

Please confirm or change these recommendations:

1. **Invitation recipients:** existing registered accounts only for MVP, using verified email; external email/phone invites deferred.
2. **Invitation effect:** acceptance creates a grant for restricted details and checkout eligibility, but never a ticket or inventory hold.
3. **Access requests:** enabled only when accessPolicy=APPROVAL_REQUIRED; invitation-only events require an organizer invitation.
4. **Organizer authority:** OWNER/ADMIN issue and revoke invitations/grants and decide requests; platform admins oversee and can intervene for documented reasons, but do not routinely approve requests.
5. **Default expiry:** invitation 7 days; grant expires at event cutoff/completion unless revoked earlier.
6. **Policy changes:** changing visibility/access policy triggers immediate re-evaluation; existing grants are not silently treated as tickets.
7. **No attendee directory:** organizers see only the request/invitation information needed to decide access; attendees cannot browse the guest list.

Schema, migrations, APIs, and background jobs remain blocked until these policies are approved.
