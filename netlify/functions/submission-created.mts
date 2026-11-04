import type { Context } from "@netlify/functions";
import { RSVP_FORM, fromSubmission, saveRsvp } from "../lib/rsvp.mts";

/**
 * Netlify runs this automatically after every form submission. It keeps a
 * copy of each new-members RSVP in the site's own storage so /admin can show
 * it without needing any API token. It sends no email and changes nothing
 * in the Forms tab. Other forms are ignored.
 */
export default async (req: Request, _context: Context) => {
  try {
    const { payload } = await req.json();
    if (payload?.form_name !== RSVP_FORM) return new Response("ignored", { status: 200 });
    const rsvp = fromSubmission(payload, "stored");
    if (rsvp) await saveRsvp(rsvp);
  } catch (e) {
    // Never fail the submission over our copy — it stays in the Forms tab regardless.
    console.error("Could not copy RSVP", e);
  }
  return new Response("ok", { status: 200 });
};
