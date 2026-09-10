import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// --- Event configuration -----------------------------------------------
const CAPACITY = 40;
// Places already accounted for outside this booking form (e.g. taken in
// person or by phone before the page went live).
const RESERVED_SEATS = 4;
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
}

interface BookingData {
  bookings: Booking[];
}

function getBookingStore() {
  return getStore(STORE_NAME);
}

async function loadData(store: ReturnType<typeof getStore>): Promise<BookingData> {
  const data = (await store.get(BOOKINGS_KEY, { type: "json" })) as BookingData | null;
  return data ?? { bookings: [] };
}

function computeStatus(data: BookingData) {
  const online = data.bookings.reduce((sum, b) => sum + b.guests, 0);
  const taken = RESERVED_SEATS + online;
  const remaining = Math.max(0, CAPACITY - taken);
  return { capacity: CAPACITY, reserved: RESERVED_SEATS, online, taken, remaining };
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default async (req: Request, context: Context) => {
  const store = getBookingStore();

  if (req.method === "GET") {
    const url = new URL(req.url);
    const data = await loadData(store);
    const status = computeStatus(data);

    const adminKey = url.searchParams.get("admin");
    const configuredKey = Netlify.env.get("ADMIN_KEY");
    if (adminKey && configuredKey && adminKey === configuredKey) {
      return Response.json({ ...status, bookings: data.bookings });
    }

    return Response.json(status);
  }

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
    await store.setJSON(BOOKINGS_KEY, data);

    const updated = computeStatus(data);
    return Response.json({ success: true, booking, ...updated }, { status: 201 });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/booking",
};
