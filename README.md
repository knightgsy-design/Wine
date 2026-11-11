# GYC Events — Booking Site

The Guernsey Yacht Club events home page: an animated intro, then a tabbed
booking page where guests choose an event and **pay in advance** (SumUp) to
confirm their place. Repurposed from the original wine tasting booking page.

| Event | Date | Price | Places |
|---|---|---|---|
| ~~Halloween Buffet Supper~~ *(suspended — hidden and closed to bookings)* | Sat 31 Oct 2026, from 6.30pm | £20 | 60 |
| Gin & Rum Tasting — Wheadon's Bunker | Sat 14 Nov 2026, 5.30pm | £35 (dinner: Beef Stroganoff / Cauliflower Steak (V)) | 24 |
| GYC Junior Sailing Awards Evening 2026 | Sat 28 Nov 2026, 6pm–8pm (awards 6pm Club Room, dinner 7pm Main Bar) | Awards only: free · Adult dinner £20 · Child dinner £10 (two courses) | no limit *(confirm)* |
| Christmas Crew Lunch | Sat 19 Dec 2026, from 3pm | £27.50 (main + dessert each) | no limit; bookings close 14 Dec *(confirm)* |
| Wine Tasting Evening *(past — closed, bookings kept in /admin)* | Sat 26 Sep 2026 | £30 | 40 |

## Adding / changing an event

`netlify/lib/events.mts` is the single source of truth for each event's
**price, capacity, per-booking limit, menu, and email wording** — the browser
never sets what's charged. Display copy (hero text, facts list) lives in the
`EVENTS` array at the top of the script in `index.html`. Deep links:
`/#halloween`, `/#gin-rum`, `/#junior-awards` (these are what the QR codes in `qr/` point at —
regenerate them if the site's URL changes).

Events with a `menu` make every place choose a meal; the kitchen counts show
in `/admin`.

### Tiered events (Junior Awards)

An event with `tiers` in `events.mts` makes every place pick a **ticket type**
(awards only £0 / adult dinner / child dinner), each with its own price; the
total is the sum of the tickets. Menu items carry a `tier` so adults and
children see and can only pick their own dishes; awards-only places have no
meal. The booking stores `types` per place. If the total is £0 (everyone awards
only) SumUp is skipped (it can't take a £0 checkout): the booking is confirmed
and emailed immediately. `/admin` shows a ticket column per place, and kitchen
totals include a "Places" count by ticket. QR code: `qr/junior-awards.png`.

## How it works

- `index.html` — the home page: animated intro, event tabs, one booking
  form per event. Submitting opens a SumUp Hosted Checkout for payment.
- `confirmed.html` — where SumUp redirects back to after payment. Polls
  `/api/booking-status` until the payment is confirmed (or has failed).
- Bookings live in **Netlify Blobs**, one record per booking (keyed by
  reference), with a status of `awaiting_payment` → `paid` (or `failed` /
  `void`), tagged with its `event`. Each event's own cap counts `paid` **and** `awaiting_payment` bookings,
  so two people can't both be sold the last seat while one is mid-checkout —
  see "Stuck awaiting-payment bookings" below for what happens if someone
  abandons checkout.

### The payment flow

1. `POST /api/create-checkout` (`netlify/functions/create-checkout.mts`) —
   validates the form, capacity-checks it, saves an `awaiting_payment`
   booking, opens a SumUp checkout, returns the payment URL. The browser is
   redirected there.
2. SumUp calls `POST /api/sumup-webhook` when the payment status changes.
   That handler just queues `confirm-payment-background.mts` (a background
   function) and answers SumUp immediately — SumUp times out webhooks after
   10 seconds, and Hosted Checkout surfaces that timeout to the payer as a
   failure, so the actual work (re-checking SumUp, marking the booking paid,
   sending the email) happens off that critical path.
3. The payer lands on `/confirmed?ref=...`, which polls
   `GET /api/booking-status?ref=...`. That endpoint **also** settles the
   booking against SumUp directly if it isn't marked paid yet — so even if
   the webhook is late, slow, or never arrives, the confirmation page and
   the booking itself still resolve correctly, just a couple of seconds
   later.
4. `GET /reconcile?key=<ADMIN_KEY>` is a safety net: it walks every
   `awaiting_payment` booking and re-checks it against SumUp directly.
   Worth hitting occasionally (or on a schedule) to catch anything stranded
   by a webhook that was accepted (2xx'd) but not actually acted on.

### Stuck awaiting-payment bookings

If someone opens checkout and never completes it, their seats stay counted
against capacity as `awaiting_payment` until either SumUp reports it failed
(picked up by the confirmation page's poll or `/reconcile`) or an admin
**Voids** it from `/admin` to free the seats immediately.

## Admin page — `/admin`

Set an `ADMIN_KEY` environment variable, then visit `https://<your-site>/admin`
and enter it once (remembered in that browser). You get:

- A live capacity summary (capacity / paid places / awaiting payment / remaining)
- The full guest list — read-only by default; **Edit** turns one row into
  editable fields (name/email/phone/places/notes) with Save/Cancel
- **Resend** — re-sends the confirmation email
- **Recheck** — for an `awaiting_payment` or `failed` booking, asks SumUp
  directly what actually happened (the same check `/reconcile` runs)
- **Void** — marks a booking void and frees its seats, keeping the record
  (with an optional reason). This is the normal way to remove a **paid**
  booking — deliberately not a delete, so there's always a trace of money
  taken.
- **Delete** — only offered for bookings that never took payment
  (`awaiting_payment` / `failed` / already-`void`); a `paid` booking can't be
  deleted, only voided.
- **"Mark a payment taken over the counter"** — records a booking paid by
  cash, card-at-the-door, bank transfer, or as a complimentary place. Books
  the seats and marks them paid immediately; email is optional (a manual
  booking doesn't require one) and only sent if you tick the box.

Treat `/admin` and the admin key as sensitive — anyone with the key can see
and edit the guest list and mark payments. The key is also accepted as
`?admin=YOUR_ADMIN_KEY` on `GET /api/booking` for scripted/manual checks.

### Admin API (used by `/admin`, callable directly too)

All admin calls require the key, either as header `x-admin-key: <key>` or
query param `?admin=<key>`.

- `GET /api/booking?admin=<key>` → capacity summary + full `bookings` array
- `POST /api/booking` with `{ name, guests, paymentMethod, email?, phone?, notes?, addedBy?, sendEmail? }`
  → records an over-the-counter booking, marked paid immediately
- `PATCH /api/booking` with `{ id, name?, email?, phone?, guests?, notes? }`
  → edits a booking (capacity-checked against the other active bookings)
- `PATCH /api/booking` with `{ id, action: "resend" }` → re-sends the
  confirmation email
- `PATCH /api/booking` with `{ id, action: "recheck" }` → re-settles an
  `awaiting_payment`/`failed` booking against SumUp directly
- `PATCH /api/booking` with `{ id, action: "void", reason? }` → voids a
  booking, freeing its seats
- `DELETE /api/booking` with `{ id }` → removes a booking that never took
  payment (refused for `status: "paid"`)

## Confirmation emails

Same pattern as the club's other event sites (`gyc-jog-dinner`,
`gyc-air-display-bbq`): emails go out via **Brevo**, sent from
`netlify/lib/email.mts`, triggered automatically once a booking is marked
paid (online or over the counter).

Set these environment variables for it to actually send:

- `BREVO_API_KEY` — a Brevo transactional API key (same one used on the
  club's other sites, if you're reusing that account)
- `FROM_EMAIL` — the verified sender address (e.g. `commodore@gyc.org.gg`)
- `CLUB_EMAIL` *(optional)* — if set, a plain-text copy of each booking's
  details is also sent here

If `BREVO_API_KEY` or `FROM_EMAIL` isn't set, sending is skipped (logged,
not thrown) — a booking is never lost over a missing email key. Each
booking records whether its confirmation actually sent
(`confirmationSent`), shown on `/admin` with a **Resend** button per row.

## SumUp payment setup

Set these environment variables for the payment flow to work:

- `SUMUP_API_KEY` *(secret)* — a SumUp API key for the club's merchant account
- `SUMUP_MERCHANT_CODE` — the club's SumUp merchant code

No separate `SITE_URL` variable is needed — Netlify's built-in `URL`
environment variable is used to build the SumUp `return_url` (the webhook)
and `redirect_url` (`/confirmed`).

## Local development

```bash
npm install
netlify dev
```

This runs the static pages and all the functions together (with a local,
sandboxed Blobs store) at `http://localhost:8888`. SumUp's webhook can't
reach a local dev server, so a full payment round-trip needs a real deploy —
locally, `/confirmed` will fall back to its "still waiting" state until you
hit `/api/booking-status` after the payment settles some other way (e.g. via
`/reconcile` once deployed).

## Deploying

Push this repo to Netlify (via the Netlify UI "Import from Git", or the
Netlify CLI: `netlify deploy --prod`). No build command is required — the
publish directory is the repo root and functions are picked up from
`netlify/functions` automatically, as configured in `netlify.toml`.

## Notes

- Bookings made before multi-event support have no `event` field and are treated as the wine tasting.
- `GET /api/booking?event=<id>` is the public availability endpoint; admin `GET` returns every event's status plus all bookings.

## New Members Party RSVPs (`/new-members`, admin → "RSVPs")

`/new-members` is an unlisted RSVP page (Netlify Forms, form `new-members-rsvp`;
not linked from anywhere, `noindex`). Responses always live in Netlify's
**Forms** tab. `/admin` has a second section, **RSVPs**:
names, email, dietary requirements and when each arrived, with counts, delete
and **Export CSV**.

How it gets the data:

- `netlify/functions/submission-created.mts` runs automatically on every form
  submission and keeps a copy of each new RSVP in the site's own Blobs store
  (no email is sent; it ignores other forms). This works with no setup but only
  covers RSVPs from the moment it's deployed.
- `netlify/functions/rsvps.mts` (`/api/rsvps`, admin key required) serves the
  list and handles delete. If a **`NETLIFY_API_TOKEN`** environment variable is
  set (a Netlify personal access token: User settings → Applications →
  Personal access tokens), it also reads the Forms tab directly, so RSVPs
  from before the copy existed appear too, and deleting removes the RSVP from
  the Forms tab as well. Without the token, delete only removes it from the
  admin list.

### AGM Dinner RSVP (`/agm-dinner`)

A second unlisted RSVP page (Netlify form `agm-dinner-rsvp`): the dinner shortly
after the conclusion of the AGM on Wednesday 11 November 2026, £14.95 per head.
Each guest gets a row (name + a choice of creamy pork stew with cumin rice or
wild mushroom cannelloni; "+ Add another guest" for more), plus one optional
dietary-requirements box. A submission confirms the place; no payment is taken.
The page copies the rows into plain fields (`attendees`, `menu_choices`,
`pork_count`, `mushroom_count`, `dietary`) so Netlify records them. The admin
RSVPs section switches between the two forms and, for this one, shows each
guest's choice and **kitchen totals** (how many of each dish); its CSV export
is per form. To add another RSVP form: copy one of the pages, then add an entry
to `RSVP_FORMS` in `netlify/lib/rsvp.mts`.

### Suspending / reopening an event

To suspend an event: set `open: false` in `netlify/lib/events.mts` (the server
stops taking bookings; public availability 404s; its bookings stay visible in
`/admin`, tab marked "closed") and add `suspended: true` to its entry in the
`EVENTS` list in `index.html` (hides its tab and panel). Halloween is
suspended this way. To reopen, reverse both. Old QR codes / `#event` links to a
suspended event simply land on the first visible event.
