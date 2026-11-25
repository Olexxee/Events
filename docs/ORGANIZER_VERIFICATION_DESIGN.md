# Organizer Role Applications

**Status:** Initial application workflow implemented in PR (pending CI and merge)
**Owner:** Organizations / Trust
**Scope:** Permission for an organization to publish events. Hospitality-provider approval and payout verification remain separate.

## 1. Product policy

- Any registered user may become an organizer by creating an organization and applying for the organizer role.
- Ordinary organizers are not required to submit CAC documents, business-registration records, identity documents, or other routine KYC evidence.
- The application is short: select an existing organization and explain what it intends to organize. A website is optional.
- Platform administrators approve or reject applications with a recorded reason.
- An approved organization may publish eligible events without event-by-event manual approval.
- Platform moderation, event restrictions, suspension, and takedown remain available.
- Organizer approval does not authorize hospitality listings and does not release funds. Hospitality approval and payout-beneficiary verification are separate workflows.

## 2. Application workflow

An applicant first creates an organization through the existing organization endpoint. Organization creation is open to any authenticated user; the creator becomes its OWNER. The owner can then submit an application for that organization.

Current API:

| Method | Path | Purpose | Authorization |
|---|---|---|---|
| POST | `/api/v1/organizer-applications` | Submit an application | Authenticated organization OWNER |
| GET | `/api/v1/organizer-applications/mine` | List own applications and decisions | Authenticated applicant |
| GET | `/api/v1/organizer-applications` | Review queue (first 100) | Platform admin or super admin |
| PATCH | `/api/v1/organizer-applications/:id/decision` | Approve or reject with reason | Platform admin or super admin |

Submission fields:
- `organizationId`: existing active organization owned by the applicant.
- `applicationMessage`: 20–2,000 characters describing the organizer's intended activity.
- `websiteUrl`: optional HTTP/HTTPS URL.

The application is not a global user role. Approval is attached to the organization, while each user's ability to act within that organization continues to come from active organization membership and scoped permissions.

## 3. Status and decision rules

Statuses are persisted as:
- `SUBMITTED`
- `UNDER_REVIEW`
- `NEEDS_INFORMATION`
- `APPROVED`
- `REJECTED`
- `WITHDRAWN`
- `SUSPENDED`
- `REVOKED`

The initial API implements submission and final approval/rejection. The other states are reserved for later review and enforcement workflows; they are not directly writable by clients.

Rules:
- Only an active organization OWNER may submit.
- At most one active application may exist per organization. A PostgreSQL partial unique index enforces this under concurrent submissions.
- An organization with an approved, suspended, or revoked application cannot bypass that state by submitting another application.
- A rejected organization may submit a new application; prior decisions remain in history.
- Only users with the trusted `platform:organizers:review` permission may review. The permission is granted to PLATFORM_ADMIN and SUPER_ADMIN, not SUPPORT or FINANCE_ADMIN.
- Approval/rejection is conditional on the application still being active, so concurrent decisions cannot overwrite one another.
- Every submission and final decision is written to the append-only audit log with actor, organization, outcome, and decision reason.

## 4. Privacy and KYC boundaries

The ordinary application collects no identity-document numbers, CAC records, bank-account details, or private identity evidence. The review queue returns applicant email and display name only; it does not expose phone numbers or identity data.

Additional evidence may be introduced only for a documented legal requirement or a specific risk trigger. If that becomes necessary, it must have a separate purpose, access policy, retention policy, and audit trail. Do not turn exceptional checks into a default onboarding checklist.

No payout data is collected here. Finance must verify a payout beneficiary before the first settlement. Hospitality providers must pass their own approval before listing hospitality inventory.

## 5. Publishing integration requirement

The future Events publishing service must query the current organizer approval for the owning organization. It must not rely on a client-side badge or a cached application result. Pending or rejected applications do not grant publishing access; suspension or revocation must block new publishing synchronously.

The application workflow does not yet implement event publishing, payout verification, hospitality approval, applicant notifications, or organizer-terms acceptance. These remain explicit follow-up work before public launch.
