import { getPrismaClient } from "../../infrastructure/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";

const bookingSelect = {
  id: true,
  publicReference: true,
  customerUserId: true,
  offeringId: true,
  offeringVersion: true,
  status: true,
  serviceStartsAt: true,
  serviceEndsAt: true,
  timezone: true,
  quantity: true,
  offeringSnapshot: true,
  priceQuoteSnapshot: true,
  acceptedTermsSnapshot: true,
  confirmedAt: true,
  cancelledAt: true,
  completedAt: true,
  noShowAt: true,
  createdAt: true,
  updatedAt: true
} as const;

type BookingReadRecord = Awaited<ReturnType<typeof findBookingRecord>>;

async function findBookingRecord(bookingId: string, customerUserId: string) {
  return getPrismaClient().vybeBooking.findFirst({
    where: { id: bookingId, customerUserId },
    select: bookingSelect
  });
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function customerBookingDto(record: NonNullable<BookingReadRecord>) {
  const offeringSnapshot = asObject(record.offeringSnapshot);
  const content = asObject(offeringSnapshot.content);
  const quote = asObject(record.priceQuoteSnapshot);
  const terms = asObject(record.acceptedTermsSnapshot);
  const acceptedPolicy = asObject(terms.cancellationPolicy);
  const cancellation = asObject(acceptedPolicy.customerCancellation);

  return {
    publicReference: record.publicReference,
    status: record.status,
    offering: {
      title:
        typeof content.title === "string" ? content.title : "Vybe experience",
      description:
        typeof content.description === "string" ? content.description : null,
      category: typeof content.category === "string" ? content.category : null,
      version: record.offeringVersion
    },
    service: {
      startsAt: record.serviceStartsAt,
      endsAt: record.serviceEndsAt,
      timezone: record.timezone,
      quantity: record.quantity
    },
    price: {
      amountMinor:
        typeof quote.amountMinor === "number" ? quote.amountMinor : null,
      currency: typeof quote.currency === "string" ? quote.currency : null,
      breakdown: quote.breakdown ?? null
    },
    acceptedTerms: {
      version: typeof terms.version === "string" ? terms.version : null,
      cancellationPolicy: Object.keys(acceptedPolicy).length
        ? {
            policyVersion: acceptedPolicy.policyVersion ?? null,
            acceptedAt: acceptedPolicy.acceptedAt ?? null,
            customerCancellation: {
              allowed: cancellation.allowed ?? null,
              cutoffAt: cancellation.cutoffAt ?? null,
              timezone: cancellation.timezone ?? null,
              displayText: cancellation.displayText ?? null
            }
          }
        : null
    },
    confirmedAt: record.confirmedAt,
    cancelledAt: record.cancelledAt,
    completedAt: record.completedAt,
    noShowAt: record.noShowAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

export async function listMyVybeBookings(input: {
  customerUserId: string;
  status?: "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
  limit: number;
  cursor?: string;
}) {
  const prisma = getPrismaClient();
  const where = {
    customerUserId: input.customerUserId,
    ...(input.status ? { status: input.status } : {})
  };
  const records = await prisma.vybeBooking.findMany({
    where,
    select: bookingSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {})
  });
  const hasMore = records.length > input.limit;
  const page = hasMore ? records.slice(0, input.limit) : records;
  return {
    bookings: page.map(customerBookingDto),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null
  };
}

export async function getMyVybeBooking(input: {
  bookingId: string;
  customerUserId: string;
}) {
  const record = await findBookingRecord(input.bookingId, input.customerUserId);
  if (!record) {
    throw new AppError("VYBE_BOOKING_NOT_FOUND", "Booking was not found", 404);
  }
  return customerBookingDto(record);
}
