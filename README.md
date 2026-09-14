# Wine Tasting Evening — Booking Page

A poster-style landing page with a **pay-in-advance** booking form for the
wine tasting evening on **Saturday 26th September, 6.30pm at the GYC**.

- 10 wines to taste — red, white & rosé
- Charcuterie & cheese board
- Wines supplied by Richard Allisette (The Grape Vine), presented by Robin Fuller
- Wholesale purchase window open until close of business Monday 28th September
- £30 per head, maximum 40 places, paid online via **SumUp** to confirm a place

## How it works

- `index.html` — the poster / booking page. Submitting the form doesn't book
  a place directly — it opens a SumUp Hosted Checkout for payment.
- `confirmed.html` — where SumUp redirects back to after payment. Polls
  `/api/booking-status` until the payment is confirmed (or has failed).
- Bookings live in **Netlify Blobs**, one record per booking (keyed by
  reference), with a status of `awaiting_payment` → `paid` (or `failed` /
  `void`). The 40-seat cap counts `paid` **and** `awaiting_payment` bookings,
  so two people can't both be sold the last seat while one is mid-checkout —
  see "Stuck awaiting-payment bookings" below for what happens if someone
  abandons checkout.
- `netlify/lib/booking.mts` is the source of truth for price (`£30`),
  capacity (`40`) and the per-booking guest limit (`8`) — the browser never
  sets the amount charged.

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

## Adjusting event details

- Poster copy, date/time/venue: edit the content in `index.html`.
- Price, capacity, or the per-booking guest limit: edit the constants at the
  top of `netlify/lib/booking.mts` (the single source of truth used by every
  function).
