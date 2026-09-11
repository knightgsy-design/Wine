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

async function send(to: string[], subject: string, text: string): Promise<SendResult> {
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

export async function sendConfirmations(b: EmailBooking): Promise<SendResult> {
  const club = Netlify.env.get("CLUB_EMAIL");
  const ref = b.id.slice(0, 8).toUpperCase();

  const guest = await send(
    [b.email],
    `Confirmed — Wine Tasting Evening (${ref})`,
    [
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
    ].join("\n"),
  );

  if (club) {
    await send([club], `Wine tasting booking — ${b.name} (${b.guests} places)`, summarise(b));
  }

  return guest;
}
