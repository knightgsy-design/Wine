import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { sendConfirmations } from "../lib/email.mts";

// --- Event configuration -----------------------------------------------
const CAPACITY = 40;
// Places already accounted for outside this booking form (e.g. taken in
// person or by phone before the page went live). Stored in the blob so an
// admin can amend it later; this is only the starting value.
const DEFAULT_RESERVED_SEATS = 4;
const MAX_GUESTS_PER_BOOKING = 8;

const STORE_NAME = "wine-tasting-2026-09-26";
const BOOKINGS_KEY = "bookings";

interface Booking {
  id: string;
  name: string;
  email: string;
  phone?: string;
  guests: number;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
  confirmationSent?: boolean;
}

interface BookingData {
  reserved: number;
  bookings: Booking[];
}

function getBookingStore() {
  return getStore(STORE_NAME);
}

async function loadData(store: ReturnType<typeof getStore>): Promise<BookingData> {
  const data = (await store.get(BOOKINGS_KEY, { type: "json" })) as Partial<BookingData> | null;
  return {
    reserved: typeof data?.reserved === "number" ? data.reserved : DEFAULT_RESERVED_SEATS,
    bookings: data?.bookings ?? [],
  };
}

function computeStatus(data: BookingData) {
  const online = data.bookings.reduce((sum, b) => sum + b.guests, 0);
  const taken = data.reserved + online;
  const remaining = Math.max(0, CAPACITY - taken);
  return { capacity: CAPACITY, reserved: data.reserved, online, taken, remaining };
}

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

export default async (req: Request, context: Context) => {
  const store = getBookingStore();
  const url = new URL(req.url);

  // ---- GET: availability, or full guest list for admins ----------------
  if (req.method === "GET") {
    const data = await loadData(store);
    const status = computeStatus(data);

    if (isAdmin(req, url)) {
      return Response.json({ ...status, bookings: data.bookings });
    }
    return Response.json(status);
  }

  // ---- POST: create a booking (used by both the public form and admin) -
  if (req.method === "POST") {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid request body." }, { status: 400 });
    }

    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim();
    const phone = body.phone ? String(body.phone).trim() : undefined;
    const notes = body.notes ? String(body.notes).trim() : undefined;
    const guests = Number(body.guests);

    if (!name) {
      return Response.json({ error: "Please enter your name." }, { status: 400 });
    }
    if (!email || !isValidEmail(email)) {
      return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
    }
    if (!Number.isInteger(guests) || guests < 1 || guests > MAX_GUESTS_PER_BOOKING) {
      return Response.json(
        { error: `Please choose between 1 and ${MAX_GUESTS_PER_BOOKING} places.` },
        { status: 400 },
      );
    }

    const data = await loadData(store);
    const status = computeStatus(data);

    if (guests > status.remaining) {
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
      id: crypto.randomUUID(),
      name,
      email,
      phone,
      guests,
      notes,
      createdAt: new Date().toISOString(),
    };
    data.bookings.push(booking);

    // A missing/misconfigured email key can never lose a booking — the
    // booking is already in `data.bookings` regardless of how this goes.
    const emailResult = await sendConfirmations(booking);
    booking.confirmationSent = emailResult.ok;

    await store.setJSON(BOOKINGS_KEY, data);

    const updated = computeStatus(data);
    return Response.json(
      { success: true, booking, ...updated, emailed: emailResult.ok ? true : emailResult.reason ?? false },
      { status: 201 },
    );
  }

  // ---- PATCH: admin-only — edit a booking, or update reserved seats ----
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

    const data = await loadData(store);

    // Updating the "reserved elsewhere" seat count (no booking id supplied).
    if (!body.id && body.reserved !== undefined) {
      const reserved = Number(body.reserved);
      if (!Number.isInteger(reserved) || reserved < 0 || reserved > CAPACITY) {
        return Response.json({ error: "Reserved seats must be between 0 and the venue capacity." }, { status: 400 });
      }
      data.reserved = reserved;
      await store.setJSON(BOOKINGS_KEY, data);
      const status = computeStatus(data);
      return Response.json({ success: true, ...status, bookings: data.bookings });
    }

    // Editing an individual booking.
    const id = String(body.id ?? "");
    const booking = data.bookings.find((b) => b.id === id);
    if (!booking) {
      return Response.json({ error: "Booking not found." }, { status: 404 });
    }

    // Resending a confirmation — no field changes, just re-send and report.
    if (body.action === "resend") {
      const result = await sendConfirmations(booking);
      booking.confirmationSent = result.ok;
      await store.setJSON(BOOKINGS_KEY, data);
      const status = computeStatus(data);
      return Response.json({
        success: result.ok,
        outcome: result.ok ? "sent" : result.reason ?? "failed",
        booking,
        ...status,
        bookings: data.bookings,
      });
    }

    const nextName = body.name !== undefined ? String(body.name).trim() : booking.name;
    const nextEmail = body.email !== undefined ? String(body.email).trim() : booking.email;
    const nextPhone = body.phone !== undefined ? String(body.phone).trim() || undefined : booking.phone;
    const nextNotes = body.notes !== undefined ? String(body.notes).trim() || undefined : booking.notes;
    const nextGuests = body.guests !== undefined ? Number(body.guests) : booking.guests;

    if (!nextName) {
      return Response.json({ error: "Name can't be empty." }, { status: 400 });
    }
    if (!nextEmail || !isValidEmail(nextEmail)) {
      return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
    }
    if (!Number.isInteger(nextGuests) || nextGuests < 1 || nextGuests > MAX_GUESTS_PER_BOOKING) {
      return Response.json(
        { error: `Guests must be between 1 and ${MAX_GUESTS_PER_BOOKING}.` },
        { status: 400 },
      );
    }

    // Capacity check, excluding this booking's current guest count.
    const otherOnline = data.bookings.reduce((sum, b) => (b.id === id ? sum : sum + b.guests), 0);
    const otherTaken = data.reserved + otherOnline;
    const remainingForThis = Math.max(0, CAPACITY - otherTaken);
    if (nextGuests > remainingForThis) {
      return Response.json(
        { error: `Only ${remainingForThis} place${remainingForThis === 1 ? "" : "s"} available for this booking.` },
        { status: 409 },
      );
    }

    booking.name = nextName;
    booking.email = nextEmail;
    booking.phone = nextPhone;
    booking.notes = nextNotes;
    booking.guests = nextGuests;
    booking.updatedAt = new Date().toISOString();

    await store.setJSON(BOOKINGS_KEY, data);
    const status = computeStatus(data);
    return Response.json({ success: true, booking, ...status, bookings: data.bookings });
  }

  // ---- DELETE: admin-only — cancel a booking ----------------------------
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
    const id = String(body.id ?? url.searchParams.get("id") ?? "");

    const data = await loadData(store);
    const index = data.bookings.findIndex((b) => b.id === id);
    if (index === -1) {
      return Response.json({ error: "Booking not found." }, { status: 404 });
    }

    data.bookings.splice(index, 1);
    await store.setJSON(BOOKINGS_KEY, data);
    const status = computeStatus(data);
    return Response.json({ success: true, ...status, bookings: data.bookings });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/booking",
};
