import type { Context, Config } from "@netlify/functions";
import {
  CAPACITY,
  MAX_GUESTS_PER_BOOKING,
  PRICE_PER_HEAD,
  capacityStatus,
  isReserving,
  key as bookingKey,
  listBookings,
  makeRef,
  readBooking,
  store as bookingStore,
  str,
  writeBooking,
  type Booking,
} from "../lib/booking.mts";
import { sendConfirmations } from "../lib/email.mts";
import { settle } from "../lib/settle.mts";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

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

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);

  // ---- GET: availability, or the full guest list for admins ------------
  if (req.method === "GET") {
    const bookings = await listBookings();
    const status = capacityStatus(bookings);

    if (isAdmin(req, url)) {
      return Response.json({ ...status, bookings });
    }
    // A wrong admin key must fail loudly, not silently degrade to the
    // public (bookings-less) shape.
    if (isAdminAttempt(req, url)) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }
    return Response.json(status);
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
    if (!Number.isInteger(guests) || guests < 1 || guests > MAX_GUESTS_PER_BOOKING) {
      return Response.json(
        { error: `Please choose between 1 and ${MAX_GUESTS_PER_BOOKING} places.` },
        { status: 400 },
      );
    }

    const bookings = await listBookings();
    const status = capacityStatus(bookings);
    if (guests > status.remaining) {
      return Response.json(
        { error: `Only ${status.remaining} place${status.remaining === 1 ? "" : "s"} left.` },
        { status: 409 },
      );
    }

    // The admin may have taken a different amount than the standard price
    // (a complimentary place, cash rounding), so an override is allowed but
    // the computed price is the default.
    const computed = Math.round(guests * PRICE_PER_HEAD * 100) / 100;
    const total =
      body.amountPounds !== "" && body.amountPounds != null
        ? Math.round(parseFloat(body.amountPounds) * 100) / 100
        : computed;
    if (!Number.isFinite(total) || total < 0) {
      return Response.json({ error: "Amount is not a valid number." }, { status: 400 });
    }

    const booking: Booking = {
      ref: makeRef(true),
      status: "paid",
      name,
      email,
      phone: phone || undefined,
      notes: notes || undefined,
      guests,
      total,
      source: "manual",
      paymentMethod,
      addedBy: addedBy || undefined,
      createdAt: new Date().toISOString(),
      paidAt: new Date().toISOString(),
    };

    let emailed: boolean | string = "skipped";
    if (body.sendEmail && email) {
      const result = await sendConfirmations(booking);
      booking.confirmationSent = result.ok;
      emailed = result.ok ? true : result.reason ?? "failed";
    } else if (body.sendEmail && !email) {
      emailed = "no-email";
    }

    await writeBooking(booking);
    const updated = capacityStatus(await listBookings());
    return Response.json({ success: true, booking, emailed, ...updated, bookings: await listBookings() }, { status: 201 });
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

    // Resending a confirmation email.
    if (body.action === "resend") {
      const result = await sendConfirmations(booking);
      booking.confirmationSent = result.ok;
      await writeBooking(booking);
      const status = capacityStatus(await listBookings());
      return Response.json({
        success: result.ok,
        outcome: result.ok ? "sent" : result.reason ?? "failed",
        booking,
        ...status,
        bookings: await listBookings(),
      });
    }

    // Re-checking an awaiting_payment/failed booking directly against SumUp.
    if (body.action === "recheck") {
      if (!booking.checkoutId) {
        return Response.json({ error: "No SumUp checkout on this booking to check." }, { status: 400 });
      }
      const updated = await settle({ id: booking.checkoutId, ref: booking.ref });
      const status = capacityStatus(await listBookings());
      return Response.json({ success: true, status: updated?.status ?? booking.status, ...status, bookings: await listBookings() });
    }

    // Voiding — deliberately not a delete for a paid booking. A paid
    // booking that vanishes leaves no trace of money taken, so this marks
    // it instead and frees its seats.
    if (body.action === "void") {
      booking.status = "void";
      booking.voidedAt = new Date().toISOString();
      booking.voidReason = str(body.reason, 200) || undefined;
      await writeBooking(booking);
      const status = capacityStatus(await listBookings());
      return Response.json({ success: true, booking, ...status, bookings: await listBookings() });
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
    if (!Number.isInteger(nextGuests) || nextGuests < 1 || nextGuests > MAX_GUESTS_PER_BOOKING) {
      return Response.json({ error: `Guests must be between 1 and ${MAX_GUESTS_PER_BOOKING}.` }, { status: 400 });
    }

    if (isReserving(booking.status)) {
      const bookings = await listBookings();
      const otherTaken = bookings.reduce(
        (sum, b) => (b.ref === ref || !isReserving(b.status) ? sum : sum + b.guests),
        0,
      );
      const remainingForThis = Math.max(0, CAPACITY - otherTaken);
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
    if (booking.status === "paid") {
      booking.total = Math.round(nextGuests * PRICE_PER_HEAD * 100) / 100;
    }

    await writeBooking(booking);
    const status = capacityStatus(await listBookings());
    return Response.json({ success: true, booking, ...status, bookings: await listBookings() });
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
    const status = capacityStatus(await listBookings());
    return Response.json({ success: true, ...status, bookings: await listBookings() });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/booking",
};
