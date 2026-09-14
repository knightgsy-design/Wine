import type { Config, Context } from "@netlify/functions";

/**
 * SumUp gives a webhook 10 seconds to answer and counts a timeout as a failed
 * delivery — which, on Hosted Checkout, surfaces to the payer as "callback
 * timed out" and blocks the payment from completing. This handler does the
 * bare minimum and hands the real work to a background function.
 *
 * Nothing here trusts the payload: the background worker re-reads the
 * checkout from the SumUp API before changing any booking.
 */
export default async (req: Request, _context: Context) => {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* SumUp occasionally pings with no body */
  }

  const id = body?.id || body?.checkout_id || body?.payload?.id || body?.resource_id;
  const ref = body?.checkout_reference || body?.payload?.checkout_reference;

  if (id || ref) {
    const base = (Netlify.env.get("SITE_URL") || Netlify.env.get("URL") || "").replace(/\/$/, "");
    try {
      // Returns as soon as the job is queued — a fast hop, not the work itself.
      await fetch(`${base}/.netlify/functions/confirm-payment-background`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ref }),
      });
    } catch (e) {
      // Still acknowledge. The confirmation page polls /api/booking-status,
      // which settles the booking against SumUp anyway.
      console.error("Could not queue background confirm", { id, ref }, e);
    }
  } else {
    console.warn("Webhook with nothing to look up", body);
  }

  return new Response("ok", { status: 200 });
};

export const config: Config = { path: "/api/sumup-webhook" };
