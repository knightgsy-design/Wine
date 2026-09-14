import { CURRENCY, type Booking } from "./booking.mts";
import { sendConfirmations as sendEmailConfirmations } from "./email.mts";

const SUMUP = "https://api.sumup.com/v0.1";

function apiKey() {
  const k = Netlify.env.get("SUMUP_API_KEY");
  if (!k) throw new Error("SUMUP_API_KEY is not set on this site.");
  return k;
}

function siteUrl() {
  return (Netlify.env.get("SITE_URL") || Netlify.env.get("URL") || "").replace(/\/$/, "");
}

/** Creates a SumUp Hosted Checkout and returns the page to send the payer to. */
export async function createCheckout(b: Booking) {
  const merchant = Netlify.env.get("SUMUP_MERCHANT_CODE");
  if (!merchant) throw new Error("SUMUP_MERCHANT_CODE is not set on this site.");

  const res = await fetch(`${SUMUP}/checkouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      checkout_reference: b.ref,
      amount: b.total,
      currency: CURRENCY,
      merchant_code: merchant,
      description: `Wine Tasting Evening · ${b.guests} place${b.guests > 1 ? "s" : ""} · ${b.name}`,
      // SumUp calls this when the payment status changes — our source of truth.
      return_url: `${siteUrl()}/api/sumup-webhook`,
      // Where the payer lands in their browser afterwards.
      redirect_url: `${siteUrl()}/confirmed?ref=${encodeURIComponent(b.ref)}`,
      hosted_checkout: { enabled: true },
    }),
  });

  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("SumUp create checkout failed", res.status, data);
    throw new Error(data?.message || "SumUp wouldn't open a payment session.");
  }

  const url = data?.hosted_checkout_url || data?.hosted_checkout?.url;
  if (!url) throw new Error("SumUp didn't return a payment page URL.");
  return { url, id: data.id as string };
}

/** Asks SumUp directly what happened. Used by the webhook and as a fallback. */
export async function fetchCheckout(opts: { id?: string; ref?: string }) {
  const url = opts.id
    ? `${SUMUP}/checkouts/${encodeURIComponent(opts.id)}`
    : `${SUMUP}/checkouts?checkout_reference=${encodeURIComponent(opts.ref!)}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey()}` } });
  if (!res.ok) return null;

  const data: any = await res.json().catch(() => null);
  if (!data) return null;
  return Array.isArray(data) ? data[0] ?? null : data;
}

export function isPaid(checkout: any) {
  const s = String(checkout?.status || "").toUpperCase();
  return s === "PAID" || s === "SUCCESSFUL";
}

export function isFailed(checkout: any) {
  return String(checkout?.status || "").toUpperCase() === "FAILED";
}

export type SendResult = { ok: boolean; reason?: string };

/** Guest confirmation (HTML + text) plus a plain-text copy to CLUB_EMAIL,
 *  handled in email.mts — this just re-exports it under the name settle.mts
 *  and the manual-add action expect. */
export async function sendConfirmations(b: Booking): Promise<SendResult> {
  return sendEmailConfirmations(b);
}
