# Wine Tasting Evening — Booking Page

A poster-style landing page with a working booking form for the wine tasting
evening on **Saturday 26th September, 6.30pm at the GYC**.

- 10 wines to taste — red, white & rosé
- Charcuterie & cheese board
- Wines supplied by Richard Allisette (The Grape Vine), presented by Robin Fuller
- Wholesale purchase window open until close of business Monday 28th September
- £30 per head, maximum 40 places

## How it works

- `index.html` — the poster / booking page (static, no build step).
- `netlify/functions/booking.mts` — serverless function backing the booking
  form, available at `/api/booking`:
  - `GET /api/booking` → `{ capacity, reserved, online, taken, remaining }`
  - `POST /api/booking` with `{ name, email, phone?, guests, notes? }` → creates
    a booking if there's room, or a `409` with the current status if not.
- Bookings are stored in **Netlify Blobs** (no database to set up).
- Capacity is set to **40**, with **4 seats already reserved** outside the
  online form (adjust `RESERVED_SEATS` in `booking.mts` if that number
  changes). Remaining places = 40 − reserved − sum of online bookings.

## Admin page — view & amend bookings live

Set an `ADMIN_KEY` environment variable on the Netlify site (Site
configuration → Environment variables). Then visit:

```
https://<your-site>/admin
```

Enter the admin key once (it's remembered in that browser) to see a live
guest list — capacity summary, every booking with editable name/email/
phone/guest count/notes, a delete button per booking, an editable "reserved
elsewhere" seat count, and a form to add a booking manually (e.g. someone
who booked by phone). Every change writes straight to the same Blobs store
the public form uses, so the public page's availability count updates
immediately too.

Treat `/admin` and the admin key as sensitive — anyone with the key can see
and edit the guest list. The key is also accepted as `?admin=YOUR_ADMIN_KEY`
on `GET /api/booking` for scripted/manual checks, returning the same JSON
the admin page consumes.

### Admin API (used by `/admin`, callable directly too)

All admin calls require the key, either as header `x-admin-key: <key>` or
query param `?admin=<key>`.

- `GET /api/booking?admin=<key>` → status + full `bookings` array
- `PATCH /api/booking` with `{ id, name?, email?, phone?, guests?, notes? }`
  → edits one booking (capacity-checked against the other bookings)
- `PATCH /api/booking` with `{ reserved: <number> }` (no `id`) → updates the
  "reserved elsewhere" seat count
- `DELETE /api/booking` with `{ id }` → removes a booking

## Local development

```bash
npm install
netlify dev
```

This runs the static page and the booking function together (with a local,
sandboxed Blobs store) at `http://localhost:8888`.

## Deploying

Push this repo to Netlify (via the Netlify UI "Import from Git", or the
Netlify CLI: `netlify deploy --prod`). No build command is required — the
publish directory is the repo root and functions are picked up from
`netlify/functions` automatically, as configured in `netlify.toml`.

## Adjusting event details

- Poster copy, date/time/venue and pricing: edit the content in `index.html`.
- Capacity, reserved seats, or the per-booking guest limit: edit the
  constants at the top of `netlify/functions/booking.mts`.
