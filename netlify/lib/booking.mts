import { getStore } from "@netlify/blobs";
import { EVENTS, LEGACY_EVENT, type EventDef } from "./events.mts";

export const CURRENCY = "GBP";

export type BookingStatus = "awaiting_payment" | "paid" | "failed" | "void";

export type Booking = {
  ref: string;
  /** Which event. Bookings made before multi-event support have none → "wine". */
  event?: string;
  status: BookingStatus;
  name: string;
  email: string;
  phone?: string;
  notes?: string;
  guests: number;
  /** One menu id per place, for events that have a menu. */
  meals?: string[];
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

export function eventIdOf(b: Booking): string {
  return b.event || LEGACY_EVENT;
}

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

/** Every booking ever started, for every event, paid or not. */
export async function listBookings(): Promise<Booking[]> {
  const s = store();
  const { blobs } = await s.list({ prefix: "booking/" });
  const all = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" }) as Promise<Booking>));
  return all.filter(Boolean);
}

export function money(n: number) {
  return "£" + n.toFixed(2);
}

export function makeRef(ev: EventDef, manual = false) {
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  // "M" marks it as added by hand from the admin page, so it can never be
  // confused with a booking that actually paid through SumUp.
  return `${ev.refPrefix}-${manual ? "M" : ""}${rnd}`;
}

/** Trims a field to a safe length. Anything that isn't a string comes back empty. */
export function str(v: any, max = 200): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Checks a list of menu choices against an event's menu. Throws on anything off. */
export function parseMeals(raw: any, ev: EventDef, guests: number): string[] | undefined {
  if (!ev.menu) return undefined;
  const list = Array.isArray(raw) ? raw : [];
  if (list.length !== guests) throw new Error("Please choose a meal for every place.");
  return list.map((m: any, i: number) => {
    const id = str(m, 30);
    if (!ev.menu!.some((item) => item.id === id)) throw new Error(`Place ${i + 1} has no meal chosen.`);
    return id;
  });
}

/** Validates whatever the browser sent for a new booking. Throws on anything suspect. */
export function parseDraft(raw: any, ev: EventDef) {
  const name = str(raw?.name, 80);
  const email = str(raw?.email, 120);
  const phone = str(raw?.phone, 40);
  const notes = str(raw?.notes, 1000);
  const guests = Number(raw?.guests);

  if (!name) throw new Error("Please enter your name.");
  if (!isValidEmail(email)) throw new Error("Please enter a valid email address.");
  if (!Number.isInteger(guests) || guests < 1 || guests > ev.maxPerBooking) {
    throw new Error(`Please choose between 1 and ${ev.maxPerBooking} places.`);
  }
  const meals = parseMeals(raw?.meals, ev, guests);

  // Total is computed here, never taken from the request.
  const total = Math.round(guests * ev.price * 100) / 100;

  return { name, email, phone, notes, guests, meals, total };
}

/** Seats that count against an event's cap: paid, and awaiting payment (so
 *  two people mid-checkout can't both be sold the last seat). A stuck
 *  awaiting_payment booking is freed by voiding it from the admin page. */
export function isReserving(status: BookingStatus) {
  return status === "paid" || status === "awaiting_payment";
}

/** Capacity picture for ONE event. */
export function capacityStatus(bookings: Booking[], ev: EventDef) {
  const mine = bookings.filter((b) => eventIdOf(b) === ev.id);
  const active = mine.filter((b) => isReserving(b.status));
  const sum = (list: Booking[]) => list.reduce((n, b) => n + b.guests, 0);

  const taken = sum(active);
  return {
    event: ev.id,
    title: ev.title,
    price: ev.price,
    capacity: ev.capacity,
    maxPerBooking: ev.maxPerBooking,
    open: ev.open,
    menu: ev.menu ?? null,
    taken,
    remaining: Math.max(0, ev.capacity - taken),
    paid: sum(mine.filter((b) => b.status === "paid")),
    awaitingPayment: sum(mine.filter((b) => b.status === "awaiting_payment")),
  };
}

/** Status for every event at once — what the admin page wants. */
export function allEventStatuses(bookings: Booking[]) {
  return Object.fromEntries(Object.values(EVENTS).map((ev) => [ev.id, capacityStatus(bookings, ev)]));
}

/** "2 × Beef Stroganoff with veg rice, 1 × Cauliflower Steak (V)" */
export function mealSummary(b: Booking, ev: EventDef | null): string {
  if (!b.meals?.length || !ev?.menu) return "";
  const counts: Record<string, number> = {};
  b.meals.forEach((id) => {
    const name = ev.menu!.find((m) => m.id === id)?.name ?? id;
    counts[name] = (counts[name] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([name, n]) => `${n} × ${name}`)
    .join(", ");
}
