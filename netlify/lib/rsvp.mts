import { store } from "./booking.mts";

/** The unlisted RSVP forms, by Netlify form name. To add one: add the page, then an entry here. */
export const RSVP_FORMS: Record<string, { title: string; when: string; hasEmail: boolean }> = {
  "new-members-rsvp": { title: "GYC New Members, Sponsors and Helpers Party", when: "Wed 18 Nov 2026, 18:00", hasEmail: true },
  "agm-dinner-rsvp": { title: "AGM Dinner", when: "Wed 11 Nov 2026, after the AGM", hasEmail: false },
};
export const DEFAULT_FORM = "new-members-rsvp"; // copies stored before there were two forms

export type Rsvp = {
  /** Netlify's submission id — the same id in our copy and in the Forms tab */
  id: string;
  /** Netlify form name, e.g. "agm-dinner-rsvp" */
  form: string;
  name: string;
  email: string;
  dietary: string;
  createdAt: string;
  /** "stored" = copied by submission-created; "netlify" = only found via the Netlify API */
  from: "stored" | "netlify";
};

const key = (id: string) => `rsvp/${id}`;

const s = (v: any, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Shapes a Netlify form submission (webhook payload or API record) into an Rsvp. */
export function fromSubmission(sub: any, from: Rsvp["from"]): Rsvp | null {
  const id = s(sub?.id, 80);
  if (!id) return null;
  const d = sub?.data ?? {};
  return {
    id,
    form: s(sub?.form_name, 80) || DEFAULT_FORM,
    name: s(d.attendees, 300),
    email: s(d.email, 200),
    dietary: s(d.dietary, 2000),
    createdAt: s(sub?.created_at, 40) || new Date().toISOString(),
    from,
  };
}

export async function saveRsvp(r: Rsvp) {
  await store().setJSON(key(r.id), { ...r, from: "stored" });
}

export async function deleteStoredRsvp(id: string) {
  await store().delete(key(id));
}

export async function listStoredRsvps(): Promise<Rsvp[]> {
  const st = store();
  const { blobs } = await st.list({ prefix: "rsvp/" });
  const all = await Promise.all(blobs.map((b) => st.get(b.key, { type: "json" }) as Promise<Rsvp>));
  return all.filter(Boolean).map((r) => ({ ...r, form: r.form || DEFAULT_FORM }));
}

/** Our stored copies win; anything only Netlify has is added. Newest first. */
export function mergeRsvps(stored: Rsvp[], fromNetlify: Rsvp[]): Rsvp[] {
  const byId = new Map<string, Rsvp>();
  for (const r of fromNetlify) byId.set(r.id, r);
  for (const r of stored) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const API = "https://api.netlify.com/api/v1";

async function nf(token: string, path: string, init?: RequestInit) {
  return fetch(API + path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
}

/** Every submission of the RSVP form, straight from Netlify (needs a personal access token). */
export async function fetchNetlifyRsvps(token: string, siteId: string): Promise<Rsvp[]> {
  const formsRes = await nf(token, `/sites/${encodeURIComponent(siteId)}/forms`);
  if (!formsRes.ok) throw new Error(`Netlify refused the token (${formsRes.status})`);
  const forms = ((await formsRes.json()) as any[]).filter((f) => Object.hasOwn(RSVP_FORMS, f.name));

  const out: Rsvp[] = [];
  for (const form of forms) {
    for (let page = 1; page <= 20; page++) {
      const res = await nf(token, `/forms/${form.id}/submissions?per_page=100&page=${page}`);
      if (!res.ok) throw new Error(`Couldn't read submissions (${res.status})`);
      const batch = (await res.json()) as any[];
      for (const sub of batch) {
        const r = fromSubmission({ ...sub, form_name: sub.form_name || form.name }, "netlify");
        if (r) out.push(r);
      }
      if (batch.length < 100) break;
    }
  }
  return out;
}

export async function deleteNetlifySubmission(token: string, id: string) {
  const res = await nf(token, `/submissions/${encodeURIComponent(id)}`, { method: "DELETE" });
  // 404 = already gone, which is what we wanted
  if (!res.ok && res.status !== 404) throw new Error(`Netlify wouldn't delete it (${res.status})`);
}
