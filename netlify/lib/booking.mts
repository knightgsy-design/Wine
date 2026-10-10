import { getStore } from "@netlify/blobs";
import { EVENTS, LEGACY_EVENT, isBookable, type EventDef } from "./events.mts";

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
  /** Who each place is for (menu events only): index = place. */
  names?: string[];
  /** Menu choices: course id → one item id per place (index = place). */
  picks?: Record<string, string[]>;
  /** Legacy: single-course events stored a flat list. Read via picksOf(), never written. */
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

/** Checks menu choices against an event's courses. Throws on anything off. */
export function parsePicks(raw: any, ev: EventDef, guests: number): Record<string, string[]> | undefined {
  if (!ev.courses) return undefined;
  const out: Record<string, string[]> = {};
  for (const course of ev.courses) {
    const list = Array.isArray(raw?.[course.id]) ? raw[course.id] : [];
    if (list.length !== guests) throw new Error(`Please choose a ${course.label.toLowerCase()} for every place.`);
    out[course.id] = list.map((m: any, i: number) => {
      const id = str(m, 30);
      if (!course.items.some((item) => item.id === id)) {
        throw new Error(`Place ${i + 1} has no ${course.label.toLowerCase()} chosen.`);
      }
      return id;
    });
  }
  return out;
}

/** Names for every place of a menu event. Throws if any is missing. */
export function parseNames(raw: any, ev: EventDef, guests: number): string[] | undefined {
  if (!ev.courses) return undefined;
  const list = Array.isArray(raw) ? raw : [];
  if (list.length !== guests) throw new Error("Please give a name for every place.");
  return list.map((n: any, i: number) => {
    const name = str(n, 60);
    if (!name) throw new Error(`Please give a name for place ${i + 1}.`);
    return name;
  });
}

/** A booking's picks, whether stored the new way or the legacy flat `meals` way. */
export function picksOf(b: Booking, ev: EventDef | null): Record<string, string[]> | undefined {
  if (!ev?.courses) return undefined;
  if (b.picks) return b.picks;
  if (b.meals?.length && ev.courses.length === 1) return { [ev.courses[0].id]: b.meals };
  return undefined;
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
  const picks = parsePicks(raw?.picks, ev, guests);
  const names = parseNames(raw?.names, ev, guests);

  // Total is computed here, never taken from the request.
  const total = Math.round(guests * ev.price * 100) / 100;

  return { name, email, phone, notes, guests, names, picks, total };
}

/** Seats that count against an event's cap: paid, and awaiting payment (so
 *  two people mid-checkout can't both be sold the last seat). A stuck
 *  awaiting_payment booking is freed by voiding it from the admin page. */
export function isReserving(status: BookingStatus) {
  return status === "paid" || status === "awaiting_payment";
}

/** Capacity picture for ONE event. `capacity`/`remaining` are null when the event has no limit. */
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
    bookable: isBookable(ev),
    closesAt: ev.closesAt ?? null,
    courses: ev.courses ?? null,
    taken,
    remaining: ev.capacity === null ? null : Math.max(0, ev.capacity - taken),
    paid: sum(mine.filter((b) => b.status === "paid")),
    awaitingPayment: sum(mine.filter((b) => b.status === "awaiting_payment")),
    kitchen: kitchenTotals(active, ev),
  };
}

/** What the kitchen needs to cook: per course, how many of each item (held seats only). */
export function kitchenTotals(active: Booking[], ev: EventDef) {
  if (!ev.courses) return null;
  return ev.courses.map((course) => ({
    course: course.label,
    items: course.items.map((item) => ({
      name: item.name,
      count: active.reduce((n, b) => n + (picksOf(b, ev)?.[course.id] ?? []).filter((id) => id === item.id).length, 0),
    })),
  }));
}

/** What the public booking page may know: never how many have booked or how many places remain. */
export function publicStatus(status: ReturnType<typeof capacityStatus>) {
  const soldOut = status.remaining !== null && status.remaining <= 0;
  return {
    event: status.event,
    title: status.title,
    price: status.price,
    maxPerBooking: status.maxPerBooking,
    // how many places one booking may ask for right now (the form's dropdown limit)
    maxGuests: status.remaining === null ? status.maxPerBooking : Math.min(status.maxPerBooking, status.remaining),
    open: status.open,
    bookable: status.bookable,
    soldOut,
    closesAt: status.closesAt,
    courses: status.courses,
  };
}

/** Status for every event at once — what the admin page wants. */
export function allEventStatuses(bookings: Booking[]) {
  return Object.fromEntries(Object.values(EVENTS).map((ev) => [ev.id, capacityStatus(bookings, ev)]));
}

/** "Main: 2 × Roast turkey, 1 × Salmon · Dessert: 3 × Pudding" */
export function pickSummary(b: Booking, ev: EventDef | null): string {
  const picks = picksOf(b, ev);
  if (!picks || !ev?.courses) return "";
  return ev.courses
    .map((course) => {
      const counts: Record<string, number> = {};
      (picks[course.id] ?? []).forEach((id) => {
        const name = course.items.find((i) => i.id === id)?.name ?? id;
        counts[name] = (counts[name] || 0) + 1;
      });
      const text = Object.entries(counts).map(([n, c]) => `${c} × ${n}`).join(", ");
      return ev.courses!.length > 1 ? `${course.label}: ${text}` : text;
    })
    .join(" · ");
}

/** One line per place for the kitchen/guest: "Sam — Main: Roast turkey · Dessert: Christmas pudding". */
export function placeLines(b: Booking, ev: EventDef | null): string[] {
  const picks = picksOf(b, ev);
  if (!picks || !ev?.courses) return [];
  return Array.from({ length: b.guests }, (_, i) => {
    const who = b.names?.[i] || `Place ${i + 1}`;
    const what = ev.courses!
      .map((course) => {
        const item = course.items.find((it) => it.id === picks[course.id]?.[i]);
        return item ? (ev.courses!.length > 1 ? `${course.label}: ${item.name}` : item.name) : null;
      })
      .filter(Boolean)
      .join(" · ");
    return `${who} — ${what}`;
  });
}
