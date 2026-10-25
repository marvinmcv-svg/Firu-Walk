"use client";

// FirulAI — the FiruWalk dog receptionist: a glossy floating chat widget
// (logo-dog launcher + expanding frost panel) powered by POST /api/firulai.
// Mounted once at the app root; works on the landing screen AND inside the
// app shell.
//
// Layering: launcher + panel sit at z-50 — Radix dialogs/sheets/popovers also
// use z-50 but render through portals appended to <body> when opened, so they
// always paint ABOVE the widget (it never covers a dialog). The app's mobile
// tab bar is z-50 inside the tree; the launcher clears it with role-aware
// bottom offsets instead of stacking on top of it.

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { MessageCircle, PawPrint, Send, X } from "lucide-react";
import { useT } from "@/lib/firu/i18n";
import { useFiruSession } from "@/lib/firu/session";
import { springMomentum, springSmooth } from "@/lib/firu/motion";
import { whatsappHref } from "./bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const SUPPORT_WA = "+59177165787";

type Turn = { role: "user" | "assistant"; content: string };

/** Quick-reply chips (locale keys); "human" also triggers the WhatsApp handoff. */
const CHIPS: { key: string; human?: boolean }[] = [
  { key: "ai.chip.prices" },
  { key: "ai.chip.how" },
  { key: "ai.chip.zones" },
  { key: "ai.chip.human", human: true },
];

export function FirulAI() {
  const { t, lang } = useT();
  const reduceMotion = useReducedMotion();
  // Role-aware bottom offsets: clear the mobile tab bar (h-16 owner/walker,
  // h-28 admin) — the bar is lg:hidden, so desktop goes back to bottom-6.
  const userRole = useFiruSession((s) => s.user?.role ?? null);

  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [showWa, setShowWa] = useState(false);
  const [bubble, setBubble] = useState(false);

  const openedOnce = useRef(false);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Attention bubble: pops after ~3s if the panel was never opened this
  // session; dismissed on open (and politely auto-hides after a while).
  useEffect(() => {
    if (openedOnce.current) return;
    const show = setTimeout(() => {
      if (!openedOnce.current) setBubble(true);
    }, 3000);
    const hide = setTimeout(() => setBubble(false), 18000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, []);

  // Escape closes; focus returns to the launcher on close, input on open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    inputRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open && openedOnce.current) launcherRef.current?.focus();
  }, [open]);

  // Keep the newest message in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns.length, busy, showWa, open]);

  const allTurns: Turn[] = [
    { role: "assistant", content: t("ai.greeting") },
    ...turns,
  ];

  async function send(text: string, humanHandoff = false) {
    const content = text.trim();
    if (!content || busy) return;
    const userTurn: Turn = { role: "user", content };
    const history: Turn[] = [...allTurns, userTurn];
    setTurns((prev) => [...prev, userTurn]);
    setDraft("");
    setBusy(true);
    try {
      const res = await fetch("/api/firulai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, lang }),
      });
      const data = (await res.json().catch(() => null)) as { reply?: string } | null;
      const reply = typeof data?.reply === "string" ? data.reply.trim() : "";
      if (!res.ok || !reply) throw new Error("bad response");
      setTurns((prev) => [...prev, { role: "assistant", content: reply }]);
      // Handoff surfaces when the reply points at WhatsApp in ANY form:
      // deep link, brand mention, or the support number itself.
      const waMentioned =
        /wa\.me\//i.test(reply) ||
        /whatsapp/i.test(reply) ||
        /\+?59177165787/.test(reply);
      if (humanHandoff || waMentioned) setShowWa(true);
    } catch {
      setTurns((prev) => [...prev, { role: "assistant", content: t("ai.error") }]);
      if (humanHandoff) setShowWa(true);
    } finally {
      setBusy(false);
    }
  }

  function toggle(v: boolean) {
    setOpen(v);
    if (v) {
      openedOnce.current = true;
      setBubble(false);
    }
  }

  const launcherBottom =
    userRole === "ADMIN" ? "bottom-32 lg:bottom-6"
    : userRole ? "bottom-20 lg:bottom-6"
    : "bottom-5";
  const panelBottom =
    userRole === "ADMIN" ? "bottom-32 lg:bottom-6"
    : userRole ? "bottom-20 lg:bottom-6"
    : "bottom-3 lg:bottom-6";

  const showChips = turns.length <= 1 && !busy;

  return (
    <>
      {/* ---------------- Launcher (logo dog plate + online dot) ---------------- */}
      <div className={cn("fixed right-4 z-50 sm:right-6", launcherBottom)}>
        <AnimatePresence>
          {bubble && !open && (
            <motion.button
              type="button"
              onClick={() => toggle(true)}
              initial={{ opacity: 0, scale: 0.75, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.85, y: 6 }}
              transition={springMomentum}
              className="absolute bottom-full right-0 mb-3 w-52 rounded-2xl rounded-br-md border bg-card px-3.5 py-2.5 text-left text-xs font-bold leading-snug shadow-raise"
            >
              {t("ai.bubble")}
            </motion.button>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {!open && (
            <motion.button
              ref={launcherRef}
              type="button"
              onClick={() => toggle(true)}
              aria-label={t("ai.open")}
              aria-expanded={open}
              aria-haspopup="dialog"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.15 } }}
              whileTap={{ scale: 0.9, transition: { type: "spring", duration: 0.15, bounce: 0 } }}
              transition={springSmooth}
              className="relative grid size-14 place-items-center overflow-hidden rounded-full border border-border/60 bg-card firu-gloss shadow-float transition-colors duration-200 hover:border-primary/40 sm:size-16"
            >
              {/* The breathing loop lives on the inner logo, NOT the button:
                  the button's bounding box stays stable (a11y + clickability). */}
              <motion.span
                aria-hidden
                className="grid size-[72%] place-items-center"
                animate={reduceMotion ? undefined : { scale: [1, 1.04, 1] }}
                transition={
                  reduceMotion
                    ? undefined
                    : { duration: 3, repeat: Infinity, ease: "easeInOut" }
                }
              >
                <img
                  src="/images/brand/logo-mark.png"
                  alt=""
                  className="size-full object-contain dark:hidden"
                />
                <img
                  src="/images/brand/logo-mark-dark.png"
                  alt=""
                  className="hidden size-full object-contain dark:block"
                />
              </motion.span>
              {/* online dot */}
              <span className="absolute bottom-0.5 right-0.5 grid size-3.5 place-items-center">
                <span className="absolute size-full animate-ping rounded-full bg-primary/60 [animation-duration:2.4s] motion-reduce:animate-none" />
                <span className="relative size-2.5 rounded-full bg-primary ring-2 ring-card" />
              </span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* ---------------- Chat panel ---------------- */}
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label={t("ai.title")}
            initial={{ opacity: 0, y: 12, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.94 }}
            transition={springSmooth}
            className={cn(
              "fixed inset-x-3 z-50 flex max-h-[calc(100dvh-160px)] flex-col overflow-hidden rounded-3xl border firu-frost shadow-raise",
              "sm:inset-x-auto sm:right-6 sm:w-[380px] sm:max-h-[min(600px,calc(100dvh-96px))]",
              panelBottom
            )}
          >
            {/* header */}
            <div className="flex items-center gap-3 border-b bg-card/50 px-4 py-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border bg-card p-1.5 shadow-sm">
                <img
                  src="/images/brand/logo-mark.png"
                  alt=""
                  className="size-full object-contain dark:hidden"
                />
                <img
                  src="/images/brand/logo-mark-dark.png"
                  alt=""
                  className="hidden size-full object-contain dark:block"
                />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-black leading-tight">{t("ai.title")}</p>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                  {t("ai.status")}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto rounded-full"
                onClick={() => toggle(false)}
                aria-label={t("ai.close")}
              >
                <X className="size-4" />
              </Button>
            </div>

            {/* messages */}
            <div
              ref={scrollRef}
              className="min-h-0 max-h-80 space-y-2.5 overflow-y-auto px-3.5 py-3 sm:max-h-96"
            >
              {allTurns.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={springSmooth}
                  className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3.5 py-2 shadow-sm",
                      m.role === "user"
                        ? "rounded-br-md bg-primary text-primary-foreground"
                        : "rounded-bl-md border bg-card"
                    )}
                  >
                    <p className="text-sm leading-snug break-words">{m.content}</p>
                  </div>
                </motion.div>
              ))}

              {/* typing indicator — three bouncing paw prints */}
              {busy && (
                <div className="flex justify-start">
                  <div className="flex items-end gap-1.5 rounded-2xl rounded-bl-md border bg-card px-4 py-3 shadow-sm">
                    {[0, 1, 2].map((i) => (
                      <motion.span
                        key={i}
                        animate={
                          reduceMotion ? { opacity: 0.75 } : { y: [0, -4, 0], opacity: [0.45, 1, 0.45] }
                        }
                        transition={
                          reduceMotion
                            ? { duration: 0.2 }
                            : { duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }
                        }
                      >
                        <PawPrint className="size-3 text-primary" />
                      </motion.span>
                    ))}
                  </div>
                </div>
              )}

              {/* WhatsApp handoff — rendered right after the assistant's reply */}
              {showWa && (
                <div className="flex justify-start">
                  <motion.a
                    href={whatsappHref(SUPPORT_WA, t("ai.waText"))}
                    target="_blank"
                    rel="noreferrer"
                    initial={{ opacity: 0, y: 8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={springMomentum}
                    className="flex max-w-[85%] items-center gap-2 rounded-full bg-green-700 px-4 py-2.5 text-sm font-bold text-white shadow-raise transition-colors hover:bg-green-800 active:scale-[0.98]"
                  >
                    <MessageCircle className="size-4 shrink-0" />
                    {t("ai.waCta")}
                  </motion.a>
                </div>
              )}
            </div>

            {/* quick-reply chips (short conversations only) */}
            {showChips && (
              <div className="flex flex-wrap gap-2 px-3.5 pb-2.5">
                {CHIPS.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => send(t(chip.key), chip.human)}
                    className="rounded-full border bg-card/70 px-3 py-1.5 text-xs font-bold text-foreground/80 transition-colors hover:border-primary/40 hover:text-primary active:scale-[0.97]"
                  >
                    {t(chip.key)}
                  </button>
                ))}
              </div>
            )}

            {/* input row */}
            <form
              className="flex items-center gap-2 border-t bg-card/40 px-3 py-3"
              onSubmit={(e) => {
                e.preventDefault();
                send(draft);
              }}
            >
              <Input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("ai.placeholder")}
                maxLength={2000}
                className="rounded-full bg-background/60"
              />
              <Button
                type="submit"
                size="icon"
                className="size-10 shrink-0 rounded-full"
                disabled={busy || !draft.trim()}
                aria-label={t("ai.send")}
              >
                <Send className="size-4" />
              </Button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
