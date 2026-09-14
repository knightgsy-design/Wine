import type { Config, Context } from "@netlify/functions";
import { listBookings } from "../lib/booking.mts";
import { settle } from "../lib/settle.mts";

/**
 * Safety net. Walks every booking still awaiting payment and asks SumUp
 * directly whether it actually went through — confirming and emailing any
 * that did.
 *
 * Needed because a webhook we've already answered 2xx is never retried by
 * SumUp. If our handler accepted a callback and then failed to act on it,
 * the payment is stranded with no automatic recovery. This is that recovery.
 *
 *   /reconcile?key=...
 */
export default async (req: Request, _context: Context) => {
  const expected = Netlify.env.get("ADMIN_KEY");
  if (!expected || new URL(req.url).searchParams.get("key") !== expected) {
    return new Response("Not found", { status: 404 });
  }

  const pending = (await listBookings()).filter((b) => b.status === "awaiting_payment" && b.checkoutId);

  const results: string[] = [];
  for (const b of pending) {
    const updated = await settle({ id: b.checkoutId, ref: b.ref });
    results.push(`${b.ref}  (${b.name})  ->  ${updated?.status || "unchanged"}`);
  }

  return new Response(
    results.length
      ? `Checked ${results.length} pending booking(s):\n\n${results.join("\n")}\n`
      : "No pending bookings to check.\n",
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
};

export const config: Config = { path: "/reconcile" };
