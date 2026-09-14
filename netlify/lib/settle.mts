import { readBooking, writeBooking, type Booking } from "./booking.mts";
import { fetchCheckout, isFailed, isPaid, sendConfirmations } from "./services.mts";

/**
 * Reads the truth from SumUp and brings the stored booking into line with it.
 * Safe to call repeatedly — it only confirms and emails once.
 */
export async function settle(opts: { id?: string; ref?: string }): Promise<Booking | null> {
  const checkout = await fetchCheckout(opts);
  if (!checkout) {
    console.warn("Could not read checkout back from SumUp", opts);
    return null;
  }

  const bookingRef = checkout.checkout_reference || opts.ref;
  if (!bookingRef) return null;

  const booking = await readBooking(bookingRef);
  if (!booking) {
    console.warn("No booking for reference", bookingRef);
    return null;
  }

  if (isPaid(checkout)) {
    const alreadyDone = booking.status === "paid" && booking.confirmationSent;
    if (!alreadyDone) {
      booking.status = "paid";
      booking.paidAt = booking.paidAt || new Date().toISOString();
      if (!booking.confirmationSent) {
        booking.confirmationSent = (await sendConfirmations(booking)).ok;
      }
      await writeBooking(booking);
      console.log("Booking paid", booking.ref, booking.name, booking.guests);
    }
  } else if (isFailed(checkout) && booking.status !== "paid") {
    booking.status = "failed";
    await writeBooking(booking);
  }

  return booking;
}
