import type { Config, Context } from "@netlify/functions";
import { mealSummary, readBooking } from "../lib/booking.mts";
import { getEvent } from "../lib/events.mts";
import { settle } from "../lib/settle.mts";

/**
 * The confirmation page polls this. If the webhook hasn't landed yet (or
 * never does), settle() asks SumUp directly — so the booking still gets
 * confirmed and the email still goes out.
 */
export default async (req: Request, _context: Context) => {
  const ref = new URL(req.url).searchParams.get("ref") || "";
  let booking = await readBooking(ref);

  if (!booking) {
    return Response.json({ error: "No booking with that reference." }, { status: 404 });
  }

  if (booking.status !== "paid") {
    booking = (await settle({ id: booking.checkoutId, ref: booking.ref })) || booking;
  }

  const ev = getEvent(booking.event);
  return Response.json({
    ref: booking.ref,
    event: ev?.title ?? "GYC Event",
    when: ev?.when ?? "",
    where: ev?.where ?? "",
    meals: ev ? mealSummary(booking, ev) : "",
    status: booking.status,
    name: booking.name,
    email: booking.email,
    guests: booking.guests,
    total: booking.total,
    notes: booking.notes,
    emailed: !!booking.confirmationSent,
  });
};

export const config: Config = { path: "/api/booking-status" };
