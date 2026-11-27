import type { Prisma } from "@prisma/client";

export type VybeBookingSourceType =
  | "QUANTITY_POOL"
  | "CAPACITY_SESSION"
  | "EXCLUSIVE_RESOURCE";

export type VybeBookingConfirmationKind =
  | "FREE_ORDER_ACCEPTED"
  | "PAYMENT_VERIFIED";

export interface VybeBookingConfirmationRequest {
  sourceType: VybeBookingSourceType;
  sourceHoldId: string;
  customerUserId: string;
  externalOrderItemReference?: string;
}

export interface VybeBookingVerifiedQuote {
  quoteReference: string;
  amountMinor: number;
  currency: string;
  breakdown?: Prisma.InputJsonObject;
}

export interface VybeBookingVerifiedConfirmation {
  kind: VybeBookingConfirmationKind;
  reference: string;
  verifiedAt: Date;
  quote: VybeBookingVerifiedQuote;
}

/**
 * Trusted server-to-server boundary. Implementations must verify a zero-value
 * Commerce order for FREE_ORDER_ACCEPTED or a server-verified successful
 * collection for PAYMENT_VERIFIED. This port must never be backed by browser
 * assertions or payment-provider redirects.
 */
export interface VybeBookingConfirmationVerifier {
  verify(
    request: VybeBookingConfirmationRequest
  ): Promise<VybeBookingVerifiedConfirmation>;
}

export interface ConfirmVybeBookingInput extends VybeBookingConfirmationRequest {
  acceptedTermsSnapshot: Prisma.InputJsonObject;
}
