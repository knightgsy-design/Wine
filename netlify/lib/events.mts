/* ---------------------------------------------------------------
   EVERY EVENT LIVES HERE. This is the authority for price, capacity
   and the menu — the browser never tells the server what to charge.
   To add an event: add an entry below, then add its card to the
   EVENTS list in index.html (display copy only).
   --------------------------------------------------------------- */

export type MenuItem = { id: string; name: string };

export type EventDef = {
  id: string;
  /** Prefix for booking references, e.g. HALL-4F2K */
  refPrefix: string;
  /** false = past/closed: not offered publicly, but its bookings stay visible in /admin */
  open: boolean;
  title: string;
  price: number;
  capacity: number;
  maxPerBooking: number;
  /** When set, every place must choose one of these (kitchen counts). */
  menu?: MenuItem[];
  /** Used in emails */
  when: string;
  where: string;
  blurb: string[];
  callout?: string;
};

export const EVENTS: Record<string, EventDef> = {
  halloween: {
    id: "halloween",
    refPrefix: "HALL",
    open: true,
    title: "Halloween Buffet Supper",
    price: 20,
    capacity: 60, // TODO: confirm — no capacity was given for this event
    maxPerBooking: 10,
    when: "Saturday 31 October 2026 · from 6.30pm",
    where: "Guernsey Yacht Club",
    blurb: ["Dress to impress! (optional) — there's a prize for the best costume."],
  },
  "gin-rum": {
    id: "gin-rum",
    refPrefix: "GINR",
    open: true,
    title: "Gin & Rum Tasting",
    price: 35,
    capacity: 24,
    maxPerBooking: 8,
    menu: [
      { id: "stroganoff", name: "Beef Stroganoff with veg rice" },
      { id: "cauliflower", name: "Cauliflower Steak (V)" },
    ],
    when: "Saturday 14 November 2026 · from 5.30pm",
    where: "Wheadon's Bunker, Castle Emplacement",
    blurb: ["Come and enjoy the many flavours now offered by Wheadon's."],
    callout: "Discounted deals will be available on the night on a range of gins, vodkas and rums.",
  },
  // The original event — over, so closed to new bookings, but its
  // bookings (which predate the `event` field) still show in /admin.
  wine: {
    id: "wine",
    refPrefix: "WINE",
    open: false,
    title: "Wine Tasting Evening",
    price: 30,
    capacity: 40,
    maxPerBooking: 8,
    when: "Saturday 26 September 2026 · 6.30pm",
    where: "Guernsey Yacht Club",
    blurb: [],
  },
};

export const LEGACY_EVENT = "wine";

export function getEvent(id: string | undefined | null): EventDef | null {
  return EVENTS[id || LEGACY_EVENT] ?? null;
}
