# Authentication integration boundary

The shared authentication contract is intentionally provider-neutral.

A future credential-verification adapter must:

1. Verify the credential cryptographically or through a trusted identity provider.
2. Resolve the subject and current session/account state.
3. Load or derive permissions from trusted server-side authorization data.
4. Attach the resulting AuthPrincipal to req.auth.
5. Reject expired, revoked, malformed, or otherwise invalid credentials.

Only after that adapter is implemented should protected routes use requireAuthenticated and requirePermission.

Never populate req.auth from user-controlled headers, request bodies, query parameters, or unsigned token claims. A permission list supplied by the client is not authorization evidence.

This foundation does not yet implement login, registration, password storage, JWT issuance/verification, refresh-token rotation, MFA, session revocation, or organization membership resolution. Those belong to the Identity and Access implementation phase.
