import type { Config, Context } from "@netlify/functions";
import {
  deleteNetlifySubmission,
  deleteStoredRsvp,
  fetchNetlifyRsvps,
  listStoredRsvps,
  mergeRsvps,
} from "../lib/rsvp.mts";

function isAdmin(req: Request): boolean {
  const key = Netlify.env.get("ADMIN_KEY");
  return Boolean(key) && req.headers.get("x-admin-key") === key;
}

/**
 * Admin-only RSVP backend (the Forms tab in Netlify stays the source of record).
 *   GET    → all RSVPs: our stored copies, plus earlier ones from Netlify when
 *            NETLIFY_API_TOKEN is set.
 *   DELETE → { id } removes an RSVP from our copy and from Netlify's Forms tab.
 */
export default async (req: Request, context: Context) => {
  if (!isAdmin(req)) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const token = Netlify.env.get("NETLIFY_API_TOKEN");
  const siteId = context.site?.id || Netlify.env.get("SITE_ID") || "";

  if (req.method === "GET") {
    const stored = await listStoredRsvps();
    let netlify: Awaited<ReturnType<typeof fetchNetlifyRsvps>> = [];
    let syncError: string | null = null;
    if (token && siteId) {
      try {
        netlify = await fetchNetlifyRsvps(token, siteId);
      } catch (e: any) {
        syncError = e.message || "Couldn't read Netlify's Forms tab.";
      }
    }
    return Response.json({
      rsvps: mergeRsvps(stored, netlify),
      // whether earlier submissions (before this admin page existed) can be shown
      netlifySync: Boolean(token && siteId) && !syncError,
      netlifyTokenSet: Boolean(token),
      syncError,
    });
  }

  if (req.method === "DELETE") {
    let id = "";
    try {
      id = String((await req.json())?.id ?? "").trim();
    } catch {}
    if (!id) return Response.json({ error: "Which RSVP?" }, { status: 400 });

    await deleteStoredRsvp(id);
    if (token) {
      try {
        await deleteNetlifySubmission(token, id);
      } catch (e: any) {
        return Response.json({ error: e.message, partial: true }, { status: 502 });
      }
    }
    return Response.json({ success: true, alsoRemovedFromNetlify: Boolean(token) });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = { path: "/api/rsvps" };
