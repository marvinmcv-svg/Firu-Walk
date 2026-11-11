// Sign-up attribution kept in the visitor's browser until they create an
// account: the "Regalá un paseo" code from a share link (/?ref=CODE) and the
// acquisition channel (?utm_source= / ?src=). Best effort — storage can be
// blocked, in which case only the current page's URL is used.

const KEY = "fw_attribution";

export interface Attribution {
  ref?: string;
  channel?: string;
}

function readStored(): Attribution {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Attribution) : {};
  } catch {
    return {};
  }
}

/** Read ?ref= / ?utm_source= / ?src= from the URL and remember them (first touch wins for the channel). */
export function captureAttribution(): Attribution {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const stored = readStored();
  const ref = params.get("ref")?.trim().slice(0, 30) || stored.ref;
  const channel = stored.channel || params.get("utm_source")?.trim().slice(0, 30) || params.get("src")?.trim().slice(0, 30) || undefined;
  const next: Attribution = { ...(ref ? { ref } : {}), ...(channel ? { channel } : {}) };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: keep it for this page only */
  }
  return next;
}

/** Forget it once the account exists. */
export function clearAttribution(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
