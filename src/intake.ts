// Email intake: distinguish OTA-origin vs direct (SPEC §4) and pull out the
// guest's actual message from OTA notification boilerplate.

import type { InboundEmail, Channel } from "./types.ts";

const OTA_SENDERS = ["booking.com", "airbnb", "expedia", "agoda", "rakuten travel"];

export function detectChannel(email: InboundEmail): Channel {
  const from = email.from.toLowerCase();
  const subject = email.subject.toLowerCase();
  const hit = OTA_SENDERS.some((s) => from.includes(s) || subject.includes(s));
  return hit ? "ota" : "direct";
}

// Try to recover the guest's name from OTA notification text ("from your guest X").
export function extractGuestName(email: InboundEmail, channel: Channel): string | null {
  if (channel === "direct") {
    // Use the local part of the address as a rough display name.
    const local = email.from.split("@")[0];
    return local ? local.replace(/[._]/g, " ") : null;
  }
  const m = email.body.match(/(?:from your guest|from guest|guest)\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/);
  return m ? m[1] : null;
}

// Extract the guest's real message. OTA emails wrap it in boilerplate; we pull
// out the part between "----" fences or after a "wrote:" marker, falling back to
// the whole body.
export function extractGuestMessage(email: InboundEmail, channel: Channel): string {
  if (channel === "direct") return email.body.trim();

  const fenced = email.body.match(/----\s*([\s\S]*?)\s*----/);
  if (fenced) return fenced[1].trim();

  const quoted = email.body.match(/(?:wrote|message)\s*:\s*\n?\s*"?([\s\S]*?)"?\s*$/i);
  if (quoted) return quoted[1].trim();

  return email.body.trim();
}
