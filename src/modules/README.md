# Module implementation convention

Each business module owns its routes, request schemas, controllers, services, repositories, and domain types.

Recommended module layout:

- <module>.routes.ts
- <module>.controller.ts
- <module>.service.ts
- <module>.repository.ts
- <module>.schemas.ts
- <module>.types.ts

Rules:

- Routes compose authentication, permission checks, request validation, and controllers in that order.
- Controllers translate HTTP input/output; they do not contain business rules or database queries.
- Services own domain policy and coordinate transactions/use cases.
- Repositories own persistence queries. A module must not write another module's tables directly.
- Modules communicate through exported application contracts or versioned domain events, not by importing another module's repository.
- Cross-module workflows must state transaction boundaries and failure/retry behaviour explicitly.
- Keep shared infrastructure in src/shared or src/infrastructure; do not move domain rules into shared helpers.
- Do not create empty placeholder modules. Add a module when its domain design and implementation scope are approved.
- Module access/entitlements must remain independent of future pricing, subscriptions, or billing implementation.
