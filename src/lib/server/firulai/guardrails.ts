// FirulAI guardrails (Milestone 9), enforced in code on top of the prompt:
//   - health questions: an operator note tells the model not to diagnose,
//     and a vet recommendation is appended if the reply lacks one;
//   - card numbers typed into the chat are redacted before they reach the
//     model or the conversation log (FirulAI never takes payments);
//   - replies are trimmed of markdown the chat bubble can't render.

export type Lang = "es" | "en";

const SYMPTOMS =
  /\b(v[oó]mit\w*|diarrea|sangr\w*|no come|no quiere comer|cojea\w*|convuls\w*|envenen\w*|intoxic\w*|fiebre|herid\w*|mordi\w*|picad\w*|tos\w*|temblor\w*|desmay\w*|hinchad\w*|enferm\w*|s[ií]ntoma\w*|dolor\w*|medicamento\w*|medicina\w*|pastilla\w*|dosis|vomit\w*|diarrh\w*|blood\w*|bleed\w*|limp\w*|seizure\w*|poison\w*|fever|wound\w*|bite\w*|bitten|cough\w*|sick|ill|symptom\w*|pain|medication\w*|medicine|dose|swollen)\b/i;

/** The visitor seems to describe a health problem of their dog. */
export function looksMedical(text: string): boolean {
  return SYMPTOMS.test(text);
}

export function medicalNote(lang: Lang): string {
  return (
    "The visitor is describing a possible health problem. Do not diagnose, name likely conditions, or suggest " +
    "medication, doses or home treatment. Say kindly that a veterinarian must examine the dog, urge going to a vet " +
    "right away if it could be urgent (bleeding, poisoning, seizures, trouble breathing), and offer the WhatsApp team " +
    `for help finding one. Reply in ${lang === "en" ? "English" : "Spanish"}.`
  );
}

const VET_NOTICE: Record<Lang, string> = {
  es: "Para cualquier síntoma o problema de salud, llevalo con un veterinario: yo no puedo dar diagnósticos. Si es urgente, andá a una veterinaria de emergencia ya.",
  en: "For any symptom or health issue, please take your dog to a vet: I can't give diagnoses. If it's urgent, go to an emergency vet right away.",
};

/** Append a vet recommendation when a health reply doesn't already give one. */
export function ensureVetAdvice(reply: string, lang: Lang): string {
  if (/veterinari|\bvet\b|\bvets\b/i.test(reply)) return reply;
  return `${reply}\n\n${VET_NOTICE[lang]}`.trim();
}

const CARD = /\b(?:\d[ -]?){13,19}\b/g;

/** Hide anything that looks like a card number (13–19 digits). */
export function redactPaymentData(text: string): string {
  return text.replace(CARD, (m) => (m.replace(/\D/g, "").length >= 13 ? "[número oculto]" : m));
}

/** Plain-text bubble: drop markdown emphasis/headings the UI would show raw. */
export function plainText(reply: string): string {
  return reply
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
