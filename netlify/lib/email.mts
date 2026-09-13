/* -------------------------------------------------------------------
   Email. Uses Brevo if BREVO_API_KEY is set; otherwise logs and carries
   on, so a missing email key can never lose a booking. Same pattern as
   the club's other event sites (gyc-jog-dinner, gyc-air-display-bbq).
   ------------------------------------------------------------------- */

export type SendResult = { ok: boolean; reason?: string };

export interface EmailBooking {
  id: string;
  name: string;
  email: string;
  phone?: string;
  guests: number;
  notes?: string;
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

function summarise(b: EmailBooking) {
  return [
    `Name: ${b.name}`,
    `Places: ${b.guests}`,
    b.phone ? `Phone: ${b.phone}` : null,
    b.notes ? `Notes: ${b.notes}` : null,
    `Reference: ${b.id.slice(0, 8).toUpperCase()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function guestText(b: EmailBooking, ref: string) {
  return [
    `Thanks ${b.name}, your place${b.guests > 1 ? "s are" : " is"} booked.`,
    "",
    "Saturday 26 September, 6.30pm at the Guernsey Yacht Club.",
    "",
    summarise(b),
    "",
    "Ten wines to taste — red, white & rosé — plus a charcuterie & cheese board.",
    "Wines supplied by Richard Allisette (The Grape Vine), presented by Robin Fuller.",
    "",
    "£30 per head, payable on the night.",
    "",
    "You'll also be able to buy any of the evening's wines at wholesale prices —",
    "but only until close of business Monday 28th September.",
    "",
    "See you there!",
    "Guernsey Yacht Club",
  ].join("\n");
}

/** Table-based layout with inline styles throughout — the only markup
 *  email clients (Outlook desktop especially) render consistently. */
function guestHtml(b: EmailBooking, ref: string) {
  const details = [
    `<strong>Name:</strong> ${esc(b.name)}`,
    `<strong>Places:</strong> ${b.guests}`,
    b.phone ? `<strong>Phone:</strong> ${esc(b.phone)}` : null,
    b.notes ? `<strong>Notes:</strong> ${esc(b.notes)}` : null,
    `<strong>Reference:</strong> ${ref}`,
  ]
    .filter(Boolean)
    .join("<br>");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#faf6ef;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ef;">
      <tr>
        <td align="center" style="padding:28px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6ddcc;font-family:Georgia,'Times New Roman',serif;color:#2b2320;">
            <tr>
              <td style="background:#4a1526;padding:30px 32px;text-align:center;">
                <div style="color:#e4cd9a;font-family:Arial,sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-weight:bold;margin:0 0 10px;">Booking confirmed</div>
                <div style="color:#ffffff;font-size:25px;font-weight:bold;line-height:1.3;">Wine Tasting Evening</div>
                <div style="color:#e4cd9a;font-family:Arial,sans-serif;font-size:13px;margin:8px 0 0;">Saturday 26 September &middot; 6.30pm &middot; The Guernsey Yacht Club</div>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 32px 8px;">
                <p style="margin:0 0 18px;font-size:15.5px;line-height:1.6;">Thanks ${esc(b.name)}, your place${b.guests > 1 ? "s are" : " is"} booked.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ef;border-radius:10px;margin-bottom:22px;">
                  <tr>
                    <td style="padding:16px 20px;font-family:Arial,sans-serif;font-size:14px;line-height:1.9;color:#2b2320;">
                      ${details}
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 14px;font-size:14.5px;line-height:1.65;color:#5a5049;">
                  Ten wines to taste &mdash; red, white &amp; ros&eacute; &mdash; plus a charcuterie &amp; cheese board.
                  Wines supplied by <strong>Richard Allisette</strong> (The Grape Vine), presented by <strong>Robin Fuller</strong>.
                </p>
                <p style="margin:0 0 20px;font-size:14.5px;line-height:1.6;"><strong>£30 per head</strong>, payable on the night.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                  <tr>
                    <td style="background:#fbf2e3;border-left:4px solid #c8a25c;border-radius:8px;padding:14px 18px;font-family:Arial,sans-serif;font-size:13.5px;line-height:1.6;color:#6b4a13;">
                      You'll also be able to buy any of the evening's wines at wholesale prices &mdash; but only until
                      close of business <strong>Monday 28th September</strong>.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px 28px;text-align:center;border-top:1px solid #e6ddcc;">
                <div style="font-size:13.5px;color:#5a5049;">See you there!</div>
                <div style="font-size:14px;font-weight:bold;color:#4a1526;margin-top:4px;">Guernsey Yacht Club</div>
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
  const club = Netlify.env.get("CLUB_EMAIL");
  const ref = b.id.slice(0, 8).toUpperCase();

  const guest = await send(
    [b.email],
    `Confirmed — Wine Tasting Evening (${ref})`,
    guestText(b, ref),
    guestHtml(b, ref),
  );

  // The club copy stays a plain-text summary — an internal notice, not
  // something that needs to look like the guest-facing email.
  if (club) {
    await send([club], `Wine tasting booking — ${b.name} (${b.guests} places)`, summarise(b));
  }

  return guest;
}
