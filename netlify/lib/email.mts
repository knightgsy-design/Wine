/* -------------------------------------------------------------------
   Email. Uses Brevo if BREVO_API_KEY is set; otherwise logs and carries
   on, so a missing email key can never lose a booking. Same pattern as
   the club's other event sites (gyc-jog-dinner, gyc-air-display-bbq).
   ------------------------------------------------------------------- */
import { pickSummary, type Booking } from "./booking.mts";
import { getEvent, type EventDef } from "./events.mts";

export type SendResult = { ok: boolean; reason?: string };

export interface EmailBooking {
  ref: string;
  event?: string;
  name: string;
  email: string;
  phone?: string;
  guests: number;
  picks?: Record<string, string[]>;
  meals?: string[];
  notes?: string;
  total: number;
}

async function send(to: string[], subject: string, text: string, html?: string): Promise<SendResult> {
  const key = Netlify.env.get("BREVO_API_KEY");
  const from = Netlify.env.get("FROM_EMAIL");
  if (!key || !from || !to.length) {
    console.log("Email not sent (missing BREVO_API_KEY or FROM_EMAIL):", subject, to);
    return { ok: false, reason: "not-configured" };
  }
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: from, name: "Guernsey Yacht Club" },
        to: to.map((email) => ({ email })),
        subject,
        textContent: text,
        ...(html ? { htmlContent: html } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("Email send failed", res.status, detail);
      return { ok: false, reason: `Brevo rejected it (${res.status}${detail ? ": " + detail.slice(0, 200) : ""})` };
    }
    return { ok: true };
  } catch (e: any) {
    console.error("Error contacting Brevo", e);
    return { ok: false, reason: "Could not reach Brevo." };
  }
}

function esc(s: string) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function money(n: number) {
  return "£" + n.toFixed(2);
}

/** Label/value rows shared by the text and HTML versions. */
function rows(b: EmailBooking, ev: EventDef): [string, string][] {
  const m = pickSummary(b as Booking, ev);
  return [
    ["Event", ev.title],
    ["When", ev.when],
    ["Where", ev.where],
    ["Name", b.name],
    ["Places", String(b.guests)],
    ...(m ? ([["Menu", m]] as [string, string][]) : []),
    ...(b.phone ? ([["Phone", b.phone]] as [string, string][]) : []),
    ...(b.notes ? ([["Notes", b.notes]] as [string, string][]) : []),
    ["Paid", money(b.total)],
    ["Reference", b.ref],
  ];
}

function guestText(b: EmailBooking, ev: EventDef) {
  return [
    `Thanks ${b.name}, your payment's gone through and your place${b.guests > 1 ? "s are" : " is"} booked for the ${ev.title}.`,
    "",
    ...rows(b, ev).map(([k, v]) => `${k}: ${v}`),
    "",
    ...ev.blurb,
    ...(ev.callout ? ["", ev.callout] : []),
    "",
    "See you there!",
    "Guernsey Yacht Club",
  ].join("\n");
}

/** Table-based layout with inline styles throughout — the only markup
 *  email clients (Outlook desktop especially) render consistently. */
function guestHtml(b: EmailBooking, ev: EventDef) {
  const details = rows(b, ev)
    .map(([k, v]) => `<strong>${k}:</strong> ${esc(v)}`)
    .join("<br>");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#ebf0f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ebf0f5;">
      <tr>
        <td align="center" style="padding:28px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #d6dde6;font-family:Georgia,'Times New Roman',serif;color:#14202e;">
            <tr>
              <td style="background:#0a2240;padding:30px 32px;text-align:center;">
                <div style="color:#ff6a6e;font-family:Arial,sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-weight:bold;margin:0 0 10px;">Payment received</div>
                <div style="color:#ffffff;font-size:25px;font-weight:bold;line-height:1.3;">${esc(ev.title)}</div>
                <div style="color:#ff6a6e;font-family:Arial,sans-serif;font-size:13px;margin:8px 0 0;">${esc(ev.when)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 32px 8px;">
                <p style="margin:0 0 18px;font-size:15.5px;line-height:1.6;">Thanks ${esc(b.name)}, your payment's gone through and your place${b.guests > 1 ? "s are" : " is"} booked.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ebf0f5;border-radius:10px;margin-bottom:22px;">
                  <tr>
                    <td style="padding:16px 20px;font-family:Arial,sans-serif;font-size:14px;line-height:1.9;color:#14202e;">
                      ${details}
                    </td>
                  </tr>
                </table>
                ${ev.blurb.map((p) => `<p style="margin:0 0 14px;font-size:14.5px;line-height:1.65;color:#4d5b6d;">${esc(p)}</p>`).join("")}
                ${
                  ev.callout
                    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 24px;"><tr><td style="background:#fdecec;border-left:4px solid #d0161b;border-radius:8px;padding:14px 18px;font-family:Arial,sans-serif;font-size:13.5px;line-height:1.6;color:#6b1014;">${esc(ev.callout)}</td></tr></table>`
                    : ""
                }
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px 28px;text-align:center;border-top:1px solid #d6dde6;">
                <div style="font-size:13.5px;color:#4d5b6d;">See you there!</div>
                <div style="font-size:14px;font-weight:bold;color:#0a2240;margin-top:4px;">Guernsey Yacht Club</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendConfirmations(b: EmailBooking): Promise<SendResult> {
  const ev = getEvent(b.event);
  if (!ev) return { ok: false, reason: "unknown-event" };
  const club = Netlify.env.get("CLUB_EMAIL");

  const guest = await send(
    [b.email],
    `Confirmed — ${ev.title} (${b.ref})`,
    guestText(b, ev),
    guestHtml(b, ev),
  );

  // The club copy stays a plain-text summary — an internal notice, not
  // something that needs to look like the guest-facing email.
  if (club) {
    const summary = rows(b, ev).map(([k, v]) => `${k}: ${v}`).join("\n");
    await send([club], `${ev.title} booking — ${b.name} (${b.guests} places)`, summary);
  }

  return guest;
}
