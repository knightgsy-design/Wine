import type { Context } from "@netlify/functions";
import { settle } from "../lib/settle.mts";

/**
 * Does the slow part of confirming a payment — calling SumUp back, writing
 * the booking, sending the email — away from the webhook, which has to
 * answer SumUp within 10 seconds.
 *
 * Background functions must keep the "-background" suffix and are reached
 * at /.netlify/functions/confirm-payment-background.
 */
export default async (req: Request, _context: Context) => {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* nothing to do */
  }

  const { id, ref } = body;
  if (!id && !ref) {
    console.warn("Background confirm called with nothing to look up");
    return;
  }

  try {
    await settle({ id, ref });
  } catch (e) {
    // The confirmation page polls /api/booking-status, which settles too,
    // so a failure here is recoverable rather than lost.
    console.error("Background confirm failed", { id, ref }, e);
  }
};
