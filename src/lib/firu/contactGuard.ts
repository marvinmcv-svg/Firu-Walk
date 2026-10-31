// Anti-disintermediation: spot chat messages that share a phone number or a
// WhatsApp/Telegram link, so we can gently remind both people to keep the
// conversation in FiruWalk (that's what keeps them covered by the guarantee).
// Shared by the chat UI (warning while typing) and POST /api/messages (flag).
// It never blocks a message — false positives must stay harmless.

const LINK_RE =
  /(?:\bwa\.me\/|\bapi\.whatsapp\.com\b|\bchat\.whatsapp\.com\b|\bwhatsapp\.com\/|\bt\.me\/|\bwa\.link\/)/i;

// A run of digits possibly broken by spaces, dots, dashes or parentheses,
// optionally starting with "+". 7+ digits looks like a phone number; times
// ("17:30"), prices ("Bs 150") and dates ("25/10") stay well below that.
const DIGIT_RUN_RE = /\+?\(?\d[\d\s().-]{5,}\d/g;

/** Number words people use to dodge digit filters ("siete siete uno…"). */
const SPELLED_RE =
  /\b(?:cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|zero|one|two|three|four|five|six|seven|eight|nine)\b/gi;

export function containsContactInfo(text: string): boolean {
  if (!text) return false;
  if (LINK_RE.test(text)) return true;
  for (const m of text.matchAll(DIGIT_RUN_RE)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(m[0].trim())) continue; // ISO date
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 7 && digits.length <= 15) return true;
  }
  const spelled = text.match(SPELLED_RE);
  return !!spelled && spelled.length >= 7;
}
