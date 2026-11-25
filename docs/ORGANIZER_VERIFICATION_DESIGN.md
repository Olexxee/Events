# Organizer Verification — Design Gate

**Status:** Policy direction updated; implementation design requires revision  
**Owner:** Organizations / Trust  
**Depends on:** Identity & Access foundation (merged in PR #2)  
**Scope:** Organizer publishing verification. Hospitality-provider approval remains a separate scope and lifecycle.

This document turns the current product requirements into a reviewable workflow. The product policy direction is that organizer access is open by application with lightweight onboarding; this document still requires detailed workflow and technical review before schema implementation.

## 1. Product requirements already established

- An organization may have multiple users through scoped memberships.
- A user may participate in more than one organization and may hold different roles in each.
- Organizer verification is an auditable case/history, not a boolean field that overwrites prior decisions.
- Any registered user may apply for organizer access.
- Ordinary organizers do not need CAC or business-registration documents.
- Initial approval is lightweight: a basic application, reachable email and phone verification, acceptance of organizer terms, and platform approval of the organizer role.
- Approved organizers may publish eligible events without manual approval of every event. Platform moderation, proportionate limits, risk-based event review, suspension, and takedown authority remain.
- Payout beneficiary verification is separate from organizer onboarding and is required before the first settlement, not before applying or publishing.
- Additional identity/business evidence may be requested only where a specific risk, legal obligation, event category, or transaction threshold justifies it.
- Hospitality-provider approval is separate from organizer/event-publishing verification. An organization may use the same account and workspace, but must pass the additional hospitality approval before listing hospitality inventory.

## 2. Recommended separation of concerns

Do not put a single `verified` boolean or a single `verificationStatus` on `Organization`.

Keep these records separate:

| Record | Purpose | Mutability |
|---|---|---|
| VerificationCase | One verification attempt for one organization and one approval scope | Current workflow state changes; history retained |
| VerificationEvidence | A submitted evidence reference and its review state | Append-only submission; later review metadata may be added |
| VerificationDecision | Reviewer decision, reason, actor, and timestamp | Append-only |
| VerificationCaseEvent | State transition and actor history | Append-only |
| OrganizationTermsAcceptance | Exact terms version accepted, by whom, and when | Append-only |
| OrganizationTrustAssessment | Risk/trust level and the policy version/reason supporting it | Versioned history |

The identity and access layer remains authoritative for users, sessions, and memberships. The Organizations module owns verification cases and organization trust. A verification decision must not mutate a user's global role or membership role.

## 3. Verification scopes

Use independent approval scopes:

- `ORGANIZER_PUBLISHING`
- `HOSPITALITY_PROVIDER`

A future scope may be added only with its own requirements and authorization rules. Approval for one scope never implies approval for another.

Each case is attached to an Organization. Evidence may relate to the organization or to a representative user acting for it. The data model must retain the evidence subject and the submitter separately.

## 4. Proposed case lifecycle

Recommended states:

- `DRAFT`: not submitted; editable by an authorized organization representative.
- `SUBMITTED`: evidence and declarations submitted; awaiting triage.
- `UNDER_REVIEW`: assigned to an authorized reviewer.
- `NEEDS_INFORMATION`: reviewer requests specific additional evidence.
- `APPROVED`: all required checks passed for the case scope.
- `REJECTED`: the application did not meet requirements.
- `SUSPENDED`: a previously approved scope is temporarily disabled.
- `REVOKED`: approval withdrawn by an authorized platform decision.
- `EXPIRED`: approval or evidence validity period ended and re-verification is required.

Proposed transitions:

| From | To | Actor / condition |
|---|---|---|
| DRAFT | SUBMITTED | Organization owner or explicitly authorized representative |
| SUBMITTED | UNDER_REVIEW | Verification queue/reviewer assignment |
| UNDER_REVIEW | NEEDS_INFORMATION | Reviewer records required evidence and reason |
| NEEDS_INFORMATION | SUBMITTED | Authorized representative supplies requested information |
| UNDER_REVIEW | APPROVED | Reviewer confirms every required check and a final approver authorizes |
| UNDER_REVIEW | REJECTED | Reviewer records reason and any permitted re-application condition |
| APPROVED | SUSPENDED | Authorized trust/safety intervention |
| APPROVED | REVOKED | Authorized final decision with reason |
| APPROVED | EXPIRED | Validity period or evidence expiry reached |
| SUSPENDED | UNDER_REVIEW | Reinstatement/review process explicitly opened |

No controller may set an arbitrary state. The service must validate every transition and append the corresponding event and decision record in the same transaction.

## 5. Evidence handling and privacy

Evidence should be stored outside PostgreSQL in an approved private object-storage service once that provider is selected. PostgreSQL stores only references and review metadata.

Minimum evidence metadata:

- Evidence type and verification scope.
- Subject type and subject reference (organization or representative user).
- Submitter user ID.
- Private storage object reference.
- MIME type, byte size, checksum, and upload timestamp.
- Issuer/provider and external verification reference, where applicable.
- Valid-from/valid-until dates, where the document has an expiry.
- Review status, reviewer, review timestamp, and reason.

Security requirements:

- Never expose storage object keys or signed URLs through public organization/event APIs.
- Generate short-lived download access only after an authorization and purpose check.
- Log evidence view, download, submission, replacement, and deletion/purge actions.
- Do not log document contents, full identity numbers, bank account numbers, OTPs, passwords, or raw provider payloads.
- Encrypt evidence at rest and in transit; define access roles and retention before collecting real documents.
- Retain only the minimum evidence required for the stated purpose and applicable legal obligations. Exact retention periods are unresolved.
- A checksum detects accidental change; it is not proof that a document is genuine.

## 6. Authorization

Proposed access boundaries:

- Organization OWNER: submit, view status, and respond to information requests for their organization.
- Organization ADMIN: same only if the organization owner explicitly grants the verification-management capability; do not assume every admin should view identity evidence.
- Verification reviewer: inspect assigned cases and evidence, request information, and recommend an outcome.
- Final approver: approve/reject/revoke within the assigned approval scope.
- Platform support: no default access to identity evidence.
- Super admin: privileged access is still purpose-limited and audited; it is not an excuse to bypass workflow history.

Reviewer and approver separation is recommended for high-risk or settlement-enabled organizations. Whether it is mandatory for every case is an open policy decision.

Platform permissions should be explicit, for example:

- `verification:case:read`
- `verification:case:review`
- `verification:case:decide`
- `verification:evidence:read`
- `verification:case:override`

These permissions must be granted through trusted platform-role administration, never from client input. Organization membership permissions must not grant platform review authority.

## 7. Publishing and settlement gates

Recommended capability checks:

**Organizer publishing**
- Organization is active.
- The user has an approved organizer-role application/current organizer authorization.
- Required account email and phone verification are complete.
- Current organizer terms version has been accepted.
- No active platform restriction blocks publishing.
- No blanket CAC/business-registration or identity-document requirement applies to ordinary organizers; additional checks must be tied to a documented risk, legal obligation, event category, or transaction threshold.

**Settlements**
- All publishing eligibility checks above remain valid.
- A payout beneficiary is verified and linked to the organization through the Finance-owned payout-account workflow before the first settlement.
- No settlement hold, risk restriction, or compliance block applies.

The event-publishing service must ask the Organizations/Trust service for current eligibility. It must not trust a client-side badge, cached organization flag, or old approval event as the sole authorization source. If an organization is suspended or its approval is revoked, new publishing must be blocked synchronously.

Exact eligibility rules, evidence freshness, and whether some checks can be deferred until the first settlement remain open.

## 8. Trust level is not verification status

The README lists potential trust levels: Pending, Verified, Established, Restricted, and Suspended.

These should not be stored as case states. A case records whether a specific approval scope was approved. Trust assessment may consider history, risk signals, operational performance, and compliance status to determine configurable limits.

Do not implement trust scoring or transaction/payout limits until the scoring inputs, review rights, appeal process, and policy versioning are approved. Never use an opaque score as the only reason for a high-impact restriction.

## 9. Required invariants and tests

Before implementation, the design must guarantee:

1. An organization cannot publish without current organizer-publishing approval and all required gates.
2. Hospitality approval is independent and does not follow automatically from organizer approval.
3. A user cannot submit, inspect, or change a case for an organization without current scoped authority.
4. Client requests cannot set verification status, trust level, reviewer, approver, or decision reason.
5. A decision always records actor, scope, reason, timestamp, and prior/current state.
6. Evidence is private by default; public event and organization responses never serialize evidence metadata or storage references.
7. Rejection, expiry, suspension, or revocation does not erase prior decisions or evidence history.
8. Re-submission creates a traceable case version/attempt; it does not rewrite a rejected case.
9. Duplicate concurrent approvals/rejections cannot create contradictory final decisions.
10. A revoked or suspended approval blocks new publishing without waiting for asynchronous projection cleanup.
11. Platform overrides require a dedicated permission, reason, and audit record.
12. Organization membership removal immediately removes the former member's case/evidence access.

Required tests include cross-organization access denial, reviewer scope denial, evidence privacy, illegal state transitions, duplicate concurrent decisions, suspension/revocation propagation, expired evidence, and audit completeness.

## 10. Remaining decisions — resolve before schema implementation

| Decision | Recommended default | Why it is still open |
|---|---|---|
| Who may apply for organizer access? | Any registered user; organization owner or authorized creator completes the application | Open access is a product requirement; delegation applies only after an organization exists |
| Required evidence by organizer type | Basic application, verified email/phone, and accepted terms; request additional evidence only for documented risk/legal triggers | Avoid unnecessary KYC and barriers to ordinary event organizers |
| Representative identity | No blanket identity-document check for ordinary organizers; apply additional checks only when justified by risk or law | Avoid imposing full KYC on every applicant |
| Email/phone verification | Verify the accountable representative before publishing | Channel/provider, expiry, resend, and recovery rules are not selected |
| Payout beneficiary | Verify the beneficiary before first settlement, not before organizer approval or publishing | Finance owns payout controls and data minimization |
| Reviewer/approver separation | Two-person approval for high-risk or payout-enabled cases | Staffing and operational burden |
| Rejection and appeal | Reasoned rejection plus one documented appeal/re-application path | Appeal deadlines and reviewer independence |
| Evidence expiry/re-verification | Expiring documents trigger re-review before continued publishing/settlement | Exact validity periods vary by document and law |
| Evidence retention/deletion | Minimum necessary retention, with legal hold support | Nigerian legal and provider requirements require specialist review |
| Trust levels and limits | Keep trust labels informational until policy is approved | Thresholds and impact are not defined |
| Organizer publishing during review | Block publishing until the lightweight organizer application is approved | Role approval remains a clear gate; individual event approval is not the default |

## 11. Explicitly out of scope

- Selecting an identity, CAC, phone OTP, bank verification, email, or object-storage vendor.
- Implementing payment, payout, settlement, or commercial rules.
- Implementing hospitality-provider approval (it shares the framework but requires a separate checklist and policy).
- Event-by-event approval for every event from an already verified organizer.
- Automatic risk scoring or opaque trust ranking.
- Creating a public API that exposes identity evidence or private venue information.

**Exit gate:** resolve the open decisions, review this workflow with operational/legal stakeholders, then produce the physical schema, migration, service contracts, and concurrency/security test plan.
