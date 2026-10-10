/* ---------------------------------------------------------------
   EVERY EVENT LIVES HERE. This is the authority for price, capacity
   and the menu — the browser never tells the server what to charge.
   To add an event: add an entry below, then add its card to the
   EVENTS list in index.html (display copy only).
   --------------------------------------------------------------- */

export type MenuItem = { id: string; name: string; desc?: string; tags?: string[] };

/** One course of a set menu: every place picks exactly one item from each course. */
export type Course = { id: string; label: string; items: MenuItem[] };

export type EventDef = {
  id: string;
  /** Prefix for booking references, e.g. HALL-4F2K */
  refPrefix: string;
  /** false = past/closed: not offered publicly, but its bookings stay visible in /admin */
  open: boolean;
  title: string;
  price: number;
  /** null = no limit */
  capacity: number | null;
  maxPerBooking: number;
  /** When set, every place must choose one item from every course (kitchen counts). */
  courses?: Course[];
  /** Last day (YYYY-MM-DD, inclusive) that bookings are taken, e.g. the kitchen's order deadline. */
  closesAt?: string;
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
    courses: [
      {
        id: "meal",
        label: "Meal",
        items: [
          { id: "stroganoff", name: "Beef Stroganoff with veg rice" },
          { id: "cauliflower", name: "Cauliflower Steak (V)" },
        ],
      },
    ],
    when: "Saturday 14 November 2026 · from 5.30pm",
    where: "Wheadon's Bunker, Castle Emplacement",
    blurb: ["Come and enjoy the many flavours now offered by Wheadon's."],
    callout: "Discounted deals will be available on the night on a range of gins, vodkas and rums.",
  },
  "christmas-lunch": {
    id: "christmas-lunch",
    refPrefix: "XMAS",
    open: true,
    title: "Christmas Crew Lunch",
    price: 27.5,
    capacity: null, // no limit
    maxPerBooking: 30, // sanity limit per single booking only — people can book again
    closesAt: "2026-12-14", // TODO: confirm kitchen order deadline
    courses: [
      {
        id: "main",
        label: "Main",
        items: [
          { id: "turkey", name: "Traditional roast turkey", tags: ["GFO"], desc: "Chestnut stuffing, duck fat roast potatoes, buttered vegetables, homemade pigs in blankets and rich red wine gravy" },
          { id: "salmon", name: "Salmon en croute", desc: "Scottish salmon in flaky puff pastry, with crispy hasselback potatoes, tenderstem broccoli and mornay sauce" },
          { id: "cauliflower", name: "Grilled cauliflower steak", tags: ["V", "GFO"], desc: "Spiced chickpea purée, wild mushrooms, chimichurri and toasted almonds" },
        ],
      },
      {
        id: "dessert",
        label: "Dessert",
        items: [
          { id: "pudding", name: "GYC Christmas pudding", desc: "Homemade, with brandy sauce" },
          { id: "pears", name: "Mulled wine poached pears", tags: ["V", "GF"], desc: "Spiced wine simmered pears with rum and raisin ice cream" },
          { id: "tart", name: "Chocolate and orange tart", tags: ["GF"], desc: "Dark chocolate ganache, candied orange slices and Solero ice cream" },
        ],
      },
    ],
    when: "Saturday 19 December 2026 · from 3pm, once the boats are in",
    where: "Guernsey Yacht Club",
    blurb: [
      "Come straight off the water for a proper Christmas lunch with your crew. Racing or not, everyone is welcome.",
      "V is vegetarian, GF is gluten free, and GFO means the kitchen can make it gluten free. Tell us about any dietary requirements when you book.",
    ],
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

/** Booking is taken until the end of `closesAt` (Guernsey = UK time; December is GMT). */
export function isBookable(ev: EventDef, now = new Date()): boolean {
  if (!ev.open) return false;
  if (ev.closesAt && now.getTime() > new Date(ev.closesAt + "T23:59:59Z").getTime()) return false;
  return true;
}
