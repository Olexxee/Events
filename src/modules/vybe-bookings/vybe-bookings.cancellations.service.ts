import { cancelMyVybeBooking } from "./vybe-bookings.cancellations.db.js";

export function cancelMyVybeBookingService(input: {
  bookingId: string;
  customerUserId: string;
  idempotencyKey: string;
  reason: string;
}) {
  return cancelMyVybeBooking(input);
}
