import { getStore } from "@netlify/blobs";

/* ---------------------------------------------------------------
   THE PRICE AND CAPACITY LIVE HERE. This is the authority — the
   browser never gets to tell the server what to charge, and every
   capacity check runs off this store, never off anything the client
   sends. If either changes, change it here (public/index.html's
   copy of the price is display only).
   --------------------------------------------------------------- */
export const PRICE_PER_HEAD = 30;
export const CURRENCY = "GBP";
export const CAPACITY = 40;
export const MAX_GUESTS_PER_BOOKING = 8;

export type BookingStatus = "awaiting_payment" | "paid" | "failed" | "void";

export type Booking = {
  ref: string;
  status: BookingStatus;
  name: string;
  email: string;
  phone?: string;
  notes?: string;
  guests: number;
  total: number;
  checkoutId?: string;
  createdAt: string;
  paidAt?: string;
  confirmationSent?: boolean;
  /** Set when the admin page added this instead of the guest paying online
   *  through SumUp — cash on the night, a bank transfer, a card taken over
   *  the counter, or a complimentary place. */
  source?: "manual";
  paymentMethod?: string;
  addedBy?: string;
  voidedAt?: string;
  voidReason?: string;
};

export function store() {
  return getStore({ name: "wine-tasting-2026-09-26", consistency: "strong" });
}

export function key(ref: string) {
  return `booking/${ref}`;
}

export async function readBooking(ref: string): Promise<Booking | null> {
  return (await store().get(key(ref), { type: "json" })) as Booking | null;
}

export async function writeBooking(b: Booking) {
  await store().setJSON(key(b.ref), b);
}

/** Every booking ever started, paid or not. The admin page and the
 *  capacity check both just filter this down differently. */
export async function listBookings(): Promise<Booking[]> {
  const s = store();
  const { blobs } = await s.list({ prefix: "booking/" });
  const all = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" }) as Promise<Booking>));
  return all.filter(Boolean);
}

export function money(n: number) {
  return "£" + n.toFixed(2);
}

export function makeRef(manual = false) {
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  // "M" marks it as added by hand from the admin page, so it can never be
  // confused with a booking that actually paid through SumUp.
  return `WINE-${manual ? "M" : ""}${rnd}`;
}

/** Trims a field to a safe length. Anything that isn't a string comes back empty. */
export function str(v: any, max = 200): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Validates whatever the browser sent for a new booking. Throws on anything suspect. */
export function parseDraft(raw: any) {
  const name = str(raw?.name, 80);
  const email = str(raw?.email, 120);
  const phone = str(raw?.phone, 40);
  const notes = str(raw?.notes, 1000);
  const guests = Number(raw?.guests);

  if (!name) throw new Error("Please enter your name.");
  if (!isValidEmail(email)) throw new Error("Please enter a valid email address.");
  if (!Number.isInteger(guests) || guests < 1 || guests > MAX_GUESTS_PER_BOOKING) {
    throw new Error(`Please choose between 1 and ${MAX_GUESTS_PER_BOOKING} places.`);
  }

  // Total is computed here, never taken from the request.
  const total = Math.round(guests * PRICE_PER_HEAD * 100) / 100;

  return { name, email, phone, notes, guests, total };
}

/** Seats that count against the 40-seat cap: paid, and awaiting payment (so
 *  two people mid-checkout can't both be sold the last seat). A stuck
 *  awaiting_payment booking is freed by voiding it from the admin page. */
export function isReserving(status: BookingStatus) {
  return status === "paid" || status === "awaiting_payment";
}

export function capacityStatus(bookings: Booking[]) {
  const active = bookings.filter((b) => isReserving(b.status));
  const paid = bookings.filter((b) => b.status === "paid");
  const manual = paid.filter((b) => b.source === "manual");
  const online = paid.filter((b) => b.source !== "manual");
  const awaitingPayment = bookings.filter((b) => b.status === "awaiting_payment");

  const taken = active.reduce((sum, b) => sum + b.guests, 0);
  const remaining = Math.max(0, CAPACITY - taken);

  return {
    capacity: CAPACITY,
    taken,
    remaining,
    paid: paid.reduce((sum, b) => sum + b.guests, 0),
    manual: manual.reduce((sum, b) => sum + b.guests, 0),
    online: online.reduce((sum, b) => sum + b.guests, 0),
    awaitingPayment: awaitingPayment.reduce((sum, b) => sum + b.guests, 0),
  };
}

/** Human-readable summary used in emails. */
export function summarise(b: Booking) {
  return [
    `Reference: ${b.ref}`,
    `Name: ${b.name}`,
    `Places: ${b.guests}`,
    b.phone ? `Phone: ${b.phone}` : null,
    b.notes ? `Notes: ${b.notes}` : null,
    `Paid: ${money(b.total)}`,
  ]
    .filter(Boolean)
    .join("\n");
}
