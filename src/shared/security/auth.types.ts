/* eslint-disable @typescript-eslint/no-namespace -- Express request augmentation requires declaration merging. */

export type PrincipalType = "user" | "service";

export interface AuthPrincipal {
  subjectId: string;
  subjectType: PrincipalType;
  permissions: readonly string[];
  sessionId?: string;
}

declare global {
  namespace Express {
    interface Request {
      /**
       * Set only by a trusted credential-verification adapter.
       * Never populate this from client-supplied identity headers or request bodies.
       */
      auth?: AuthPrincipal;
    }
  }
}

export {};
