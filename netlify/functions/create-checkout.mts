import type { Config, Context } from "@netlify/functions";
import { capacityStatus, listBookings, makeRef, parseDraft, writeBooking, type Booking } from "../lib/booking.mts";
import { createCheckout } from "../lib/services.mts";

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Use POST." }, { status: 405 });
  }

  let draft;
  try {
    draft = parseDraft(await req.json());
  } catch (e: any) {
    return Response.json({ error: e.message || "That booking didn't look right." }, { status: 400 });
  }

  const status = capacityStatus(await listBookings());
  if (draft.guests > status.remaining) {
    return Response.json(
      {
        error:
          status.remaining === 0
            ? "Sorry, the wine tasting evening is fully booked."
            : `Only ${status.remaining} place${status.remaining === 1 ? "" : "s"} left — please choose a smaller number.`,
        ...status,
      },
      { status: 409 },
    );
  }

  const booking: Booking = {
    ...draft,
    ref: makeRef(),
    status: "awaiting_payment",
    createdAt: new Date().toISOString(),
  };

  // Save before sending them to SumUp, so the webhook always finds a record.
  await writeBooking(booking);

  try {
    const checkout = await createCheckout(booking);
    booking.checkoutId = checkout.id;
    await writeBooking(booking);
    return Response.json({ ref: booking.ref, total: booking.total, paymentUrl: checkout.url });
  } catch (e: any) {
    console.error("Checkout creation failed for", booking.ref, e);
    return Response.json(
      { error: "We couldn't open the payment page. Nothing has been charged — please try again." },
      { status: 502 },
    );
  }
};

export const config: Config = { path: "/api/create-checkout" };
