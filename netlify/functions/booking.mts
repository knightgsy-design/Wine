import type { Context, Config } from "@netlify/functions";
import {
  allEventStatuses,
  capacityStatus,
  publicStatus,
  eventIdOf,
  isReserving,
  isValidEmail,
  key as bookingKey,
  listBookings,
  makeRef,
  parseNames,
  parsePicks,
  picksOf,
  readBooking,
  store as bookingStore,
  str,
  writeBooking,
  type Booking,
} from "../lib/booking.mts";
import { sendConfirmations } from "../lib/email.mts";
import { EVENTS, getEvent } from "../lib/events.mts";
import { settle } from "../lib/settle.mts";

function isAdmin(req: Request, url: URL): boolean {
  const configuredKey = Netlify.env.get("ADMIN_KEY");
  if (!configuredKey) return false;
  const headerKey = req.headers.get("x-admin-key");
  const queryKey = url.searchParams.get("admin");
  return headerKey === configuredKey || queryKey === configuredKey;
}

// True whenever the request identified itself as an admin call at all
// (right key or wrong) — as opposed to the public page, which never sends
// either of these.
function isAdminAttempt(req: Request, url: URL): boolean {
  return Boolean(req.headers.get("x-admin-key") || url.searchParams.get("admin"));
}

/** What every admin write hands back so the page can redraw itself. */
async function snapshot() {
  const bookings = await listBookings();
  return { events: allEventStatuses(bookings), bookings };
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);

  // ---- GET: one event's availability (public), or everything (admin) ---
  if (req.method === "GET") {
    const bookings = await listBookings();

    if (isAdmin(req, url)) {
      return Response.json({ events: allEventStatuses(bookings), bookings });
    }
    // A wrong admin key must fail loudly, not silently degrade to the
    // public (bookings-less) shape.
    if (isAdminAttempt(req, url)) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    const ev = getEvent(url.searchParams.get("event") || "");
    if (!ev || !ev.open) {
      return Response.json({ error: "Unknown event." }, { status: 404 });
    }
    return Response.json(publicStatus(capacityStatus(bookings, ev)));
  }

  // ---- POST: admin-only — record a booking paid outside the online form
  // (cash, card over the counter, bank transfer, complimentary). Public
  // bookings go through /api/create-checkout + SumUp instead.
  if (req.method === "POST") {
    if (!isAdmin(req, url)) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid request body." }, { status: 400 });
    }

    const ev = EVENTS[str(body.event, 30)];
    if (!ev) return Response.json({ error: "Choose an event." }, { status: 400 });

    const name = str(body.name, 80);
    const email = str(body.email, 120);
    const phone = str(body.phone, 40);
    const notes = str(body.notes, 1000);
    const guests = Number(body.guests);
    const paymentMethod = str(body.paymentMethod, 40) || "cash";
    const addedBy = str(body.addedBy, 80);

    if (!name) return Response.json({ error: "Please enter a name." }, { status: 400 });
    // Unlike the online form, a manual booking is allowed no email — but if
    // one's given it still has to look right.
    if (email && !isValidEmail(email)) {
      return Response.json({ error: "That email address doesn't look right." }, { status: 400 });
    }
    if (!Number.isInteger(guests) || guests < 1 || guests > ev.maxPerBooking) {
      return Response.json({ error: `Please choose between 1 and ${ev.maxPerBooking} places.` }, { status: 400 });
    }

    let picks: Record<string, string[]> | undefined;
    let names: string[] | undefined;
    try {
      picks = parsePicks(body.picks, ev, guests);
      names = parseNames(body.names, ev, guests);
    } catch (e: any) {
      return Response.json({ error: e.message }, { status: 400 });
    }

    const status = capacityStatus(await listBookings(), ev);
    if (status.remaining !== null && guests > status.remaining) {
      return Response.json(
        { error: `Only ${status.remaining} place${status.remaining === 1 ? "" : "s"} left for the ${ev.title}.` },
        { status: 409 },
      );
    }

    // The admin may have taken a different amount than the standard price
    // (a complimentary place, cash rounding), so an override is allowed but
    // the computed price is the default.
    const computed = Math.round(guests * ev.price * 100) / 100;
    const total =
      body.amountPounds !== "" && body.amountPounds != null
        ? Math.round(parseFloat(body.amountPounds) * 100) / 100
        : computed;
    if (!Number.isFinite(total) || total < 0) {
      return Response.json({ error: "Amount is not a valid number." }, { status: 400 });
    }

    // "Card at the door" isn't money in hand yet — it's a promise to pay
    // when they arrive. Every other method here (cash, bank transfer,
    // complimentary) is collected at the moment the admin enters it, so
    // only this one stays pending. The seats are still held either way
    // (capacityStatus counts awaiting_payment same as paid).
    const isPending = paymentMethod === "card at the door";

    const booking: Booking = {
      ref: makeRef(ev, true),
      event: ev.id,
      status: isPending ? "awaiting_payment" : "paid",
      name,
      email,
      phone: phone || undefined,
      notes: notes || undefined,
      guests,
      names,
      picks,
      total,
      source: "manual",
      paymentMethod,
      addedBy: addedBy || undefined,
      createdAt: new Date().toISOString(),
      paidAt: isPending ? undefined : new Date().toISOString(),
    };

    // A "payment received" email would be wrong to send before it's
    // actually been paid — that goes out from the "Mark as paid" action
    // instead, once the door's actually taken the card.
    let emailed: boolean | string = "skipped";
    if (isPending) {
      emailed = "pending-payment";
    } else if (body.sendEmail && email) {
      const result = await sendConfirmations(booking);
      booking.confirmationSent = result.ok;
      emailed = result.ok ? true : result.reason ?? "failed";
    } else if (body.sendEmail && !email) {
      emailed = "no-email";
    }

    await writeBooking(booking);
    return Response.json({ success: true, booking, emailed, ...(await snapshot()) }, { status: 201 });
  }

  // ---- PATCH: admin-only — edit, resend, recheck against SumUp, or void
  if (req.method === "PATCH") {
    if (!isAdmin(req, url)) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid request body." }, { status: 400 });
    }

    const ref = str(body.id ?? body.ref, 40);
    const booking = ref ? await readBooking(ref) : null;
    if (!booking) {
      return Response.json({ error: "Booking not found." }, { status: 404 });
    }
    const ev = getEvent(eventIdOf(booking))!;

    // Resending a confirmation email.
    if (body.action === "resend") {
      const result = await sendConfirmations(booking);
      booking.confirmationSent = result.ok;
      await writeBooking(booking);
      return Response.json({
        success: result.ok,
        outcome: result.ok ? "sent" : result.reason ?? "failed",
        booking,
        ...(await snapshot()),
      });
    }

    // Re-checking an awaiting_payment/failed booking directly against SumUp.
    if (body.action === "recheck") {
      if (!booking.checkoutId) {
        return Response.json({ error: "No SumUp checkout on this booking to check." }, { status: 400 });
      }
      const updated = await settle({ id: booking.checkoutId, ref: booking.ref });
      return Response.json({ success: true, status: updated?.status ?? booking.status, ...(await snapshot()) });
    }

    // Marking an over-the-counter "awaiting payment" booking (card at the
    // door) as actually paid, once the door's taken it. Only meaningful for
    // manual bookings — an online SumUp one gets marked paid by settle(),
    // never by hand.
    if (body.action === "mark-paid") {
      if (booking.source !== "manual") {
        return Response.json({ error: "Only an over-the-counter booking can be marked paid by hand." }, { status: 400 });
      }
      if (booking.status === "paid") {
        return Response.json({ error: "Already marked paid." }, { status: 400 });
      }
      booking.status = "paid";
      booking.paidAt = new Date().toISOString();

      let emailed: boolean | string = "skipped";
      if (body.sendEmail !== false && booking.email) {
        const result = await sendConfirmations(booking);
        booking.confirmationSent = result.ok;
        emailed = result.ok ? true : result.reason ?? "failed";
      } else if (body.sendEmail !== false && !booking.email) {
        emailed = "no-email";
      }

      await writeBooking(booking);
      return Response.json({ success: true, booking, emailed, ...(await snapshot()) });
    }

    // Voiding — deliberately not a delete for a paid booking. A paid
    // booking that vanishes leaves no trace of money taken, so this marks
    // it instead and frees its seats.
    if (body.action === "void") {
      booking.status = "void";
      booking.voidedAt = new Date().toISOString();
      booking.voidReason = str(body.reason, 200) || undefined;
      await writeBooking(booking);
      return Response.json({ success: true, booking, ...(await snapshot()) });
    }

    // Otherwise: editing the booking's own fields.
    const nextName = body.name !== undefined ? str(body.name, 80) : booking.name;
    const nextEmail = body.email !== undefined ? str(body.email, 120) : booking.email;
    const nextPhone = body.phone !== undefined ? str(body.phone, 40) || undefined : booking.phone;
    const nextNotes = body.notes !== undefined ? str(body.notes, 1000) || undefined : booking.notes;
    const nextGuests = body.guests !== undefined ? Number(body.guests) : booking.guests;

    if (!nextName) return Response.json({ error: "Name can't be empty." }, { status: 400 });
    // Only a manual (over-the-counter) booking is ever allowed no email at
    // all — one taken through SumUp always has one, so requires it here too.
    const emailRequired = booking.source !== "manual";
    if (emailRequired && !nextEmail) {
      return Response.json({ error: "This booking needs an email address." }, { status: 400 });
    }
    if (nextEmail && !isValidEmail(nextEmail)) {
      return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
    }
    if (!Number.isInteger(nextGuests) || nextGuests < 1 || nextGuests > ev.maxPerBooking) {
      return Response.json({ error: `Guests must be between 1 and ${ev.maxPerBooking}.` }, { status: 400 });
    }

    // Menu events: the choices have to keep matching the number of places.
    let nextPicks = picksOf(booking, ev);
    let nextNames = booking.names;
    if (ev.courses) {
      try {
        nextPicks = parsePicks(body.picks ?? nextPicks, ev, nextGuests);
        nextNames = parseNames(body.names ?? nextNames, ev, nextGuests);
      } catch {
        return Response.json({ error: "Every place needs a name and a menu choice." }, { status: 400 });
      }
    }

    if (isReserving(booking.status)) {
      const bookings = await listBookings();
      const otherTaken = bookings.reduce(
        (sum, b) =>
          b.ref === ref || eventIdOf(b) !== ev.id || !isReserving(b.status) ? sum : sum + b.guests,
        0,
      );
      const remainingForThis = ev.capacity === null ? Infinity : Math.max(0, ev.capacity - otherTaken);
      if (nextGuests > remainingForThis) {
        return Response.json(
          { error: `Only ${remainingForThis} place${remainingForThis === 1 ? "" : "s"} available for this booking.` },
          { status: 409 },
        );
      }
    }

    booking.name = nextName;
    booking.email = nextEmail;
    booking.phone = nextPhone;
    booking.notes = nextNotes;
    booking.guests = nextGuests;
    booking.picks = nextPicks;
    booking.names = nextNames;
    booking.meals = undefined;
    if (booking.status === "paid") {
      booking.total = Math.round(nextGuests * ev.price * 100) / 100;
    }

    await writeBooking(booking);
    return Response.json({ success: true, booking, ...(await snapshot()) });
  }

  // ---- DELETE: admin-only — remove a booking that never took payment.
  // A paid booking must be voided (PATCH action "void"), not deleted, so
  // there's always a record of money taken.
  if (req.method === "DELETE") {
    if (!isAdmin(req, url)) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // no body is fine — fall back to the query string
    }
    const ref = str(body.id ?? body.ref ?? url.searchParams.get("id"), 40);
    const booking = ref ? await readBooking(ref) : null;
    if (!booking) {
      return Response.json({ error: "Booking not found." }, { status: 404 });
    }
    if (booking.status === "paid") {
      return Response.json(
        { error: "This booking is paid — void it instead so there's a record of the payment." },
        { status: 400 },
      );
    }

    await bookingStore().delete(bookingKey(ref));
    return Response.json({ success: true, ...(await snapshot()) });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/booking",
};
