"use client";

// Owner → Booking flow: 4-step wizard (dog → rhythm → walker → confirm).
// RECURRING is the default (anti-one-off bias). Match requests max 4
// candidates (anti-shotgun) and the request goes to ONE walker at a time.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Banknote,
  CalendarDays,
  Check,
  Clock,
  Info,
  Landmark,
  Loader2,
  MessageCircle,
  PartyPopper,
  QrCode,
  ShieldCheck,
  Ticket,
} from "lucide-react";
import { api, qk } from "@/lib/firu/api";
import { useFiruSession } from "@/lib/firu/session";
import { srvErr, useT } from "@/lib/firu/i18n";
import { formatBOB, priceBreakdown } from "@/lib/firu/money";
import { daysShort, fmtSchedule, minuteOfDay } from "@/lib/firu/dates";
import type {
  AppConfig,
  BookingDTO,
  DogDTO,
  PaymentMethod,
  ScheduleItem,
  SubscriptionDTO,
  WalkerCardDTO,
  WalkerDetailDTO,
  ZoneDTO,
} from "@/lib/firu/types";
import { springSmooth, springSnappy } from "@/lib/firu/motion";
import {
  Avatar,
  DogSizeBadge,
  EmptyState,
  RatingStars,
} from "@/components/firu/shared/bits";
import { ChatDialog } from "@/components/firu/shared/ChatDialog";
import { PaymentDialog, PriceBreakdownLines } from "@/components/firu/shared/PaymentDialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const STEPS = ["own.step.dog", "own.step.rhythm", "own.step.walker", "own.step.confirm"];
const HOURS = Array.from({ length: 15 }, (_, i) => i + 6); // 6..20
const MINUTES = [0, 15, 30, 45];
const DURATIONS = [30, 45, 60] as const;
/** Monday-first weekday order. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

const PAYMENT_OPTIONS: {
  value: PaymentMethod;
  labelKey: string;
  descKey: string;
  icon: React.ElementType;
}[] = [
  { value: "QR", labelKey: "own.pay.qr.label", descKey: "own.pay.qr.desc", icon: QrCode },
  { value: "TRANSFER", labelKey: "own.pay.transfer.label", descKey: "own.pay.transfer.desc", icon: Landmark },
  { value: "CASH", labelKey: "own.pay.cash.label", descKey: "own.pay.cash.desc", icon: Banknote },
];

const TEMPERAMENT_KEYS: Record<string, string> = {
  CALM: "own.temperament.calm",
  ENERGETIC: "own.temperament.energetic",
  ANXIOUS: "own.temperament.anxious",
};

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

type PriceBands = { price30Cents: number; price45Cents: number; price60Cents: number };

function priceForDuration(d: number, bands?: PriceBands | null): number | null {
  if (!bands) return null;
  if (d === 30) return bands.price30Cents;
  if (d === 45) return bands.price45Cents;
  return bands.price60Cents;
}

export function BookingFlow() {
  const { t, lang } = useT();
  const user = useFiruSession((s) => s.user);
  const seed = useFiruSession((s) => s.bookingFlowSeed);
  const openBooking = useFiruSession((s) => s.openBooking);
  const setOwnerView = useFiruSession((s) => s.setOwnerView);
  const { toast } = useToast();
  const qc = useQueryClient();

  // ----- wizard state (recurring-first defaults) -----
  const [step, setStep] = useState(0);
  const [dogId, setDogId] = useState<string | undefined>(seed?.dogId);
  const [type, setType] = useState<"RECURRING" | "ONE_OFF">("RECURRING");
  const [days, setDays] = useState<number[]>([1]);
  const [date, setDate] = useState<string>(todayISO());
  const [hour, setHour] = useState(7);
  const [minute, setMinute] = useState(30);
  const [durationMin, setDurationMin] = useState<number>(30);
  const [walkerUserId, setWalkerUserId] = useState<string | undefined>(
    seed?.walkerUserId
  );
  const [zoneId, setZoneId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("QR");
  const [created, setCreated] = useState<BookingDTO | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  // ----- data -----
  const { data: dogs, isLoading: dogsLoading } = useQuery({
    queryKey: qk.dogs(),
    queryFn: () => api.get<DogDTO[]>("/api/dogs"),
  });
  const { data: config } = useQuery({
    queryKey: qk.config,
    queryFn: () => api.get<AppConfig>("/api/config"),
  });
  const { data: zones } = useQuery({
    queryKey: qk.zones,
    queryFn: () => api.get<ZoneDTO[]>("/api/zones"),
  });
  const { data: subscriptions } = useQuery({
    queryKey: qk.subscriptions,
    queryFn: () => api.get<SubscriptionDTO[]>("/api/subscriptions"),
  });
  // An active monthly plan that covers walks of this duration.
  const usablePlan = (subscriptions ?? []).find(
    (s) => s.status === "ACTIVE" && s.walksLeft > 0 && s.durationMin === durationMin
  );
  const effectiveMethod: PaymentMethod =
    paymentMethod === "PLAN" && !usablePlan ? "QR" : paymentMethod;

  const seededWalkerId = seed?.walkerUserId ?? null;
  const { data: seededWalker } = useQuery({
    queryKey: qk.walker(seededWalkerId ?? ""),
    queryFn: () => api.get<WalkerDetailDTO>(`/api/walkers/${seededWalkerId}`),
    enabled: !!seededWalkerId,
  });

  const effectiveZoneId = zoneId || user?.zoneId || zones?.[0]?.id || "";
  const minuteOfDayValue = hour * 60 + minute;

  const scheduleItems: ScheduleItem[] = useMemo(
    () =>
      type === "RECURRING"
        ? [...days].sort((a, b) => a - b).map((day) => ({ day, minute: minuteOfDayValue }))
        : [{ date, minute: minuteOfDayValue }],
    [type, days, date, minuteOfDayValue]
  );

  // ----- match candidates (max 4, one-at-a-time) -----
  const matchMut = useMutation({
    mutationFn: () =>
      api.post<{ candidates: WalkerCardDTO[] }>("/api/walkers/match", {
        zoneId: effectiveZoneId,
        durationMin,
        schedule: scheduleItems,
        type,
        excludeWalkerIds:
          seededWalkerId && walkerUserId === seededWalkerId
            ? [seededWalkerId]
            : undefined,
      }),
    onError: (e: Error) =>
      toast({
        title: t("own.match.errTitle"),
        description: srvErr(e.message),
        variant: "destructive",
      }),
  });

  const candidates = matchMut.data?.candidates ?? [];

  // Derived selection: keep the user's pick while it stays valid in the
  // candidate list (or is the seeded walker); otherwise fall back to the
  // best-ranked candidate. No effect needed — pure derivation.
  const seedSelected = !!(seededWalker && walkerUserId === seededWalker.userId);
  const chosenUserId =
    walkerUserId && (seedSelected || candidates.some((c) => c.userId === walkerUserId))
      ? walkerUserId
      : (candidates[0]?.userId ?? walkerUserId ?? null);

  const chosenWalker: WalkerCardDTO | WalkerDetailDTO | null = useMemo(() => {
    if (!chosenUserId) return null;
    if (seededWalker && seededWalker.userId === chosenUserId) return seededWalker;
    return candidates.find((c) => c.userId === chosenUserId) ?? null;
  }, [chosenUserId, seededWalker, candidates]);

  // run match when entering the walker step
  useEffect(() => {
    if (step === 2) matchMut.mutate();
  }, [step]);

  // ----- validation -----
  const canAdvance =
    step === 0
      ? !!dogId
      : step === 1
        ? type === "RECURRING"
          ? days.length > 0
          : !!date
        : step === 2
          ? !!chosenUserId
          : true;

  // ----- submit -----
  const submitMut = useMutation({
    mutationFn: () =>
      api.post<BookingDTO>("/api/bookings", {
        dogId,
        zoneId: effectiveZoneId,
        type,
        schedule: scheduleItems,
        durationMin,
        preferredWalkerUserId: chosenUserId ?? undefined,
        paymentMethod: effectiveMethod,
        subscriptionId: effectiveMethod === "PLAN" ? usablePlan?.id : undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: (b) => {
      setCreated(b);
      qc.invalidateQueries({ queryKey: qk.bookings });
      toast({
        title: t("own.sent.toastTitle"),
        description: t("own.sent.toastDesc", {
          walker: b.walker?.name ?? t("own.walkerFallback"),
        }),
      });
      qc.invalidateQueries({ queryKey: qk.subscriptions });
      if (b.payment?.status === "PENDING" && effectiveMethod !== "CASH") {
        setPayOpen(true);
      }
    },
    onError: (e: Error) =>
      toast({
        title: t("own.submit.errTitle"),
        description: srvErr(e.message),
        variant: "destructive",
      }),
  });

  if (!user) return null;

  const selectedDog = (dogs ?? []).find((d) => d.id === dogId);
  const bands: PriceBands | null | undefined =
    chosenWalker ?? config?.pricing ?? null;
  const priceCents = priceForDuration(durationMin, bands);
  const price =
    priceCents !== null ? priceBreakdown(priceCents, config?.fees.ownerFeePct ?? 0) : null;
  const zoneName = zones?.find((z) => z.id === effectiveZoneId)?.name;

  /* ---------------- success screen ---------------- */
  if (created) {
    return (
      <div className="max-w-xl mx-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={springSmooth}
          className="rounded-3xl border bg-card p-8 text-center shadow-sm"
        >
          <span className="mx-auto grid place-items-center size-16 rounded-3xl bg-brand-soft text-primary mb-4">
            <PartyPopper className="size-8" />
          </span>
          <h1 className="text-2xl font-black tracking-tight">
            {t("own.success.title")}
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed mt-2 max-w-sm mx-auto">
            <strong>{created.walker?.name}</strong> {t("own.hasFor")}{" "}
            <strong>{config?.demo.acceptTimeoutSeconds ?? 90} s</strong>{" "}
            {t("own.success.rest")}
          </p>

          <div className="rounded-2xl bg-muted/50 p-4 text-left space-y-1.5 mt-5 text-sm">
            <p className="flex justify-between gap-2">
              <span className="text-muted-foreground">{t("own.summary.dog")}</span>
              <span className="font-bold">{created.dog.name}</span>
            </p>
            <p className="flex justify-between gap-2">
              <span className="text-muted-foreground">{t("own.step.rhythm")}</span>
              <span className="font-bold">
                {fmtSchedule(created.schedule, created.type)}
              </span>
            </p>
            <p className="flex justify-between gap-2">
              <span className="text-muted-foreground">{t("own.duration")}</span>
              <span className="font-bold">{created.durationMin} min</span>
            </p>
            <p className="flex justify-between gap-2">
              <span className="text-muted-foreground">{t("own.pricePerWalk")}</span>
              <span className="font-bold">{formatBOB(created.pricePerWalkCents)}</span>
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 mt-6">
            <Button
              className="rounded-full font-bold flex-1"
              onClick={() => openBooking(created.id)}
            >
              {t("own.viewMyBookings")}
            </Button>
            <Button
              variant="outline"
              className="rounded-full font-bold flex-1"
              onClick={() => setChatOpen(true)}
            >
              <MessageCircle className="size-4 text-primary" /> {t("own.openChat")}
            </Button>
          </div>
        </motion.div>

        {created.walker && (
          <ChatDialog
            open={chatOpen}
            onOpenChange={setChatOpen}
            threadId={created.id}
            otherName={created.walker.name}
            otherAvatar={created.walker.avatarUrl}
            contextLabel={t("own.chatCtxRequest", { dog: created.dog.name })}
          />
        )}
        <PaymentDialog
          open={payOpen}
          onOpenChange={setPayOpen}
          bookingId={created.id}
          payment={created.payment}
          title={t("own.confirmPay")}
          description={t("own.payHeldDesc")}
        />
      </div>
    );
  }

  /* ---------------- wizard ---------------- */
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-black tracking-tight mb-1">{t("own.bookWalk")}</h1>
      <p className="text-sm text-muted-foreground mb-5">
        {t("own.wizard.sub")}
      </p>

      {/* Progress indicator */}
      <div className="flex items-center gap-1.5 sm:gap-2 mb-6 overflow-x-auto pb-1">
        {STEPS.map((key, i) => (
          <div key={key} className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <span
              className={cn(
                "grid place-items-center size-7 rounded-full border-2 text-xs font-black transition-colors",
                i < step
                  ? "bg-primary text-primary-foreground border-primary"
                  : i === step
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground"
              )}
            >
              {i < step ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                "text-xs font-bold hidden sm:block",
                i === step ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {t(key)}
            </span>
            {i < STEPS.length - 1 && (
              <span className="w-5 sm:w-8 h-0.5 rounded bg-border" />
            )}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={springSnappy}
        >
          {/* ============ STEP 0 — DOG ============ */}
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="font-black text-lg">{t("own.step0.title")}</h2>
              {dogsLoading ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {[0, 1].map((i) => (
                    <div key={i} className="rounded-3xl border p-4 flex gap-3">
                      <Skeleton className="size-16 rounded-2xl" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-5 w-24" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (dogs ?? []).length === 0 ? (
                <EmptyState
                  icon={Check}
                  title={t("own.step0.emptyTitle")}
                  description={t("own.step0.emptyDesc")}
                  action={
                    <Button
                      className="rounded-full font-bold"
                      onClick={() => setOwnerView("profile")}
                    >
                      {t("own.goToProfile")}
                    </Button>
                  }
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {(dogs ?? []).map((d) => {
                    const active = dogId === d.id;
                    return (
                      <button
                        key={d.id}
                        onClick={() => setDogId(d.id)}
                        className={cn(
                          "rounded-3xl border-2 p-4 text-left transition-[border-color,background-color,box-shadow,transform] duration-200 ease-out-expo active:scale-[0.98] flex gap-3 items-center",
                          active
                            ? "border-primary bg-brand-soft/50 shadow-sm"
                            : "border-border bg-card hover:border-primary/40"
                        )}
                        aria-pressed={active}
                      >
                        <img
                          src={d.photoUrl ?? "/images/brand/logo-mark-mint.png"}
                          alt={t("own.dogPhotoAlt", { name: d.name })}
                          className="size-16 rounded-2xl object-cover border bg-muted shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-extrabold text-lg leading-tight">{d.name}</p>
                            {active && <Check className="size-4 text-primary" />}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {d.breed} ·{" "}
                            {t(
                              d.ageYears === 1 ? "own.ageYears.one" : "own.ageYears.many",
                              { count: d.ageYears }
                            )}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                            <DogSizeBadge size={d.size} />
                            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-secondary-foreground">
                              {t(TEMPERAMENT_KEYS[d.temperament])}
                            </span>
                            {d.tags.slice(0, 2).map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-secondary-foreground"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setOwnerView("profile")}
                    className="rounded-3xl border-2 border-dashed p-4 flex items-center justify-center gap-2 text-sm font-bold text-muted-foreground hover:border-primary/40 hover:text-primary transition-[color,border-color,transform] duration-200 ease-out-expo active:scale-[0.98]"
                  >
                    {t("own.step0.addAnother")}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ============ STEP 1 — RHYTHM ============ */}
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="font-black text-lg">{t("own.step1.title")}</h2>

              {/* type */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setType("RECURRING")}
                  className={cn(
                    "rounded-3xl border-2 p-4 text-left transition-[border-color,background-color,box-shadow,transform] duration-200 ease-out-expo active:scale-[0.98]",
                    type === "RECURRING"
                      ? "border-primary bg-brand-soft/50 shadow-sm"
                      : "border-border bg-card hover:border-primary/40"
                  )}
                  aria-pressed={type === "RECURRING"}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-extrabold">{t("own.type.recurring")}</p>
                    <span className="rounded-full bg-primary text-primary-foreground text-[10px] font-black px-2 py-0.5 uppercase tracking-wide">
                      {t("own.recommended")}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                    {t("own.type.recurringDesc")}
                  </p>
                </button>
                <button
                  onClick={() => setType("ONE_OFF")}
                  className={cn(
                    "rounded-3xl border-2 p-4 text-left transition-[border-color,background-color,box-shadow,transform] duration-200 ease-out-expo active:scale-[0.98]",
                    type === "ONE_OFF"
                      ? "border-primary bg-brand-soft/50 shadow-sm"
                      : "border-border bg-card hover:border-primary/40"
                  )}
                  aria-pressed={type === "ONE_OFF"}
                >
                  <p className="font-extrabold">{t("own.type.oneOff")}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                    {t("own.type.oneOffDesc")}
                  </p>
                </button>
              </div>

              {/* schedule */}
              {type === "RECURRING" ? (
                <div className="space-y-2">
                  <Label>{t("own.step1.daysLabel")}</Label>
                  <div className="flex gap-2">
                    {WEEK.map((day, i) => {
                      const active = days.includes(day);
                      return (
                        <button
                          key={day}
                          onClick={() =>
                            setDays((prev) =>
                              prev.includes(day)
                                ? prev.filter((d) => d !== day)
                                : [...prev, day]
                            )
                          }
                          title={daysShort(lang)[day]}
                          className={cn(
                            "size-11 rounded-2xl border-2 font-black text-sm transition-[background-color,border-color,color,transform] duration-200 ease-out-expo active:scale-[0.95]",
                            active
                              ? "bg-primary text-primary-foreground border-primary scale-105"
                              : "bg-card text-muted-foreground border-border hover:border-primary/40"
                          )}
                          aria-pressed={active}
                        >
                          {daysShort(lang)[day][0]}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("own.step1.repeatsNote")}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="bf-date">{t("own.step1.dateLabel")}</Label>
                  <input
                    id="bf-date"
                    type="date"
                    value={date}
                    min={todayISO()}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-xl border bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}

              {/* time */}
              <div className="space-y-2">
                <Label>{t("own.step1.timeLabel")}</Label>
                <div className="flex gap-2">
                  <Select value={String(hour)} onValueChange={(v) => setHour(Number(v))}>
                    <SelectTrigger className="rounded-xl w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HOURS.map((h) => (
                        <SelectItem key={h} value={String(h)}>
                          {minuteOfDay(h * 60).split(":")[0]} h
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={String(minute)} onValueChange={(v) => setMinute(Number(v))}>
                    <SelectTrigger className="rounded-xl w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MINUTES.map((m) => (
                        <SelectItem key={m} value={String(m)}>
                          :{String(m).padStart(2, "0")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex-1 rounded-xl bg-brand-soft/60 border grid place-items-center text-sm font-bold text-primary">
                    {minuteOfDayValue % 60 === 0
                      ? `${minuteOfDay(minuteOfDayValue)} h`
                      : `${minuteOfDay(minuteOfDayValue)} ${hour >= 12 ? "pm" : "am"}`}
                  </div>
                </div>
              </div>

              {/* duration */}
              <div className="space-y-2">
                <Label>{t("own.step1.durationLabel")}</Label>
                <div className="grid grid-cols-3 gap-2">
                  {DURATIONS.map((d) => {
                    const p = priceForDuration(d, bands);
                    const active = durationMin === d;
                    return (
                      <button
                        key={d}
                        onClick={() => setDurationMin(d)}
                        className={cn(
                          "rounded-2xl border-2 p-3 text-center transition-[border-color,background-color,transform] duration-200 ease-out-expo active:scale-[0.98]",
                          active
                            ? "border-primary bg-brand-soft/50"
                            : "border-border bg-card hover:border-primary/40"
                        )}
                        aria-pressed={active}
                      >
                        <p className="font-extrabold">{d} min</p>
                        <p className="text-xs font-bold text-primary mt-0.5">
                          {p !== null ? formatBOB(p) : "—"}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ============ STEP 2 — WALKER ============ */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="font-black text-lg">{t("own.step2.title")}</h2>

              <div className="flex items-start gap-2 rounded-2xl bg-brand-soft/60 border border-primary/20 p-3 text-sm">
                <Info className="size-4 text-primary shrink-0 mt-0.5" />
                <p className="text-muted-foreground leading-relaxed">
                  {t("own.step2.infoA")}
                  <strong>{t("own.step2.infoBold")}</strong>
                  {t("own.step2.infoB")}
                </p>
              </div>

              {/* seeded / chosen-from-detail walker card */}
              {seededWalker && chosenUserId === seededWalker.userId && (
                <WalkerOptionCard
                  walker={seededWalker}
                  selected
                  durationMin={durationMin}
                  onSelect={() => setWalkerUserId(seededWalker.userId)}
                />
              )}

              {matchMut.isPending && (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="rounded-3xl border p-4 flex gap-3">
                      <Skeleton className="size-12 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-5 w-36" />
                        <Skeleton className="h-4 w-48" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!matchMut.isPending && candidates.length === 0 && !seededWalker && (
                <EmptyState
                  icon={CalendarDays}
                  title={t("own.step2.emptyTitle")}
                  description={t("own.step2.emptyDesc")}
                  action={
                    <Button
                      variant="outline"
                      className="rounded-full font-bold"
                      onClick={() => setStep(1)}
                    >
                      <ArrowLeft className="size-4" /> {t("own.step2.changeRhythm")}
                    </Button>
                  }
                />
              )}

              <div className="space-y-3">
                {candidates.map((c) => (
                  <WalkerOptionCard
                    key={c.userId}
                    walker={c}
                    selected={chosenUserId === c.userId}
                    durationMin={durationMin}
                    onSelect={() => setWalkerUserId(c.userId)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ============ STEP 3 — CONFIRM ============ */}
          {step === 3 && (
            <div className="space-y-5">
              <h2 className="font-black text-lg">{t("own.step3.title")}</h2>

              {/* summary */}
              <div className="rounded-3xl border bg-card p-4 shadow-sm space-y-3">
                {selectedDog && (
                  <div className="flex items-center gap-3">
                    <img
                      src={selectedDog.photoUrl ?? "/images/brand/logo-mark-mint.png"}
                      alt={t("own.dogPhotoAlt", { name: selectedDog.name })}
                      className="size-14 rounded-2xl object-cover border bg-muted"
                    />
                    <div>
                      <p className="font-extrabold text-lg leading-tight">
                        {selectedDog.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {selectedDog.breed}
                      </p>
                    </div>
                    <span className="ml-auto text-right">
                      <p className="text-xl font-black text-primary">
                        {priceCents !== null ? formatBOB(priceCents) : "—"}
                      </p>
                      <p className="text-[11px] font-semibold text-muted-foreground">
                        {t("own.perWalk")}
                      </p>
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-2xl bg-muted/50 p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      {t("own.step.rhythm")}
                    </p>
                    <p className="font-bold mt-0.5">
                      {fmtSchedule(scheduleItems, type)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-muted/50 p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      {t("own.duration")}
                    </p>
                    <p className="font-bold mt-0.5">
                      {t("own.durationPerWalk", { count: durationMin })}
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>{t("own.step3.zoneLabel")}</Label>
                  <Select
                    value={effectiveZoneId}
                    onValueChange={(v) => setZoneId(v)}
                  >
                    <SelectTrigger className="rounded-xl">
                      <SelectValue placeholder={t("own.chooseZone")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(zones ?? []).map((z) => (
                        <SelectItem key={z.id} value={z.id}>
                          {z.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {chosenWalker && (
                  <div className="flex items-center gap-3 rounded-2xl bg-brand-soft/50 border border-primary/20 p-3">
                    <Avatar
                      src={chosenWalker.avatarUrl}
                      name={chosenWalker.name}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold flex items-center gap-1.5">
                        {chosenWalker.name}
                        <BadgeCheck className="size-3.5 text-primary" />
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <RatingStars
                          rating={chosenWalker.rating}
                          count={chosenWalker.ratingCount}
                        />
                      </p>
                    </div>
                    <span className="text-[11px] font-bold text-muted-foreground inline-flex items-center gap-1">
                      <Clock className="size-3" /> ~{chosenWalker.responseMinutes} min
                    </span>
                  </div>
                )}
              </div>

              {/* notes */}
              <div className="space-y-1.5">
                <Label htmlFor="bf-notes">{t("own.step3.notesLabel")}</Label>
                <Textarea
                  id="bf-notes"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t("own.step3.notesPh")}
                />
              </div>

              {/* payment method */}
              <div className="space-y-2">
                <Label>{t("own.step3.payLabel")}</Label>
                <div className="grid gap-2">
                  {usablePlan && (
                    <button
                      onClick={() => setPaymentMethod("PLAN")}
                      className={cn(
                        "flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition-[border-color,background-color,transform] duration-200 ease-out-expo active:scale-[0.98]",
                        effectiveMethod === "PLAN"
                          ? "border-primary bg-brand-soft/50"
                          : "border-border bg-card hover:border-primary/40"
                      )}
                      aria-pressed={effectiveMethod === "PLAN"}
                    >
                      <Ticket
                        className={cn(
                          "size-5 shrink-0",
                          effectiveMethod === "PLAN" ? "text-primary" : "text-muted-foreground"
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-sm">{t("own.pay.plan.label")}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("own.pay.plan.desc", { left: usablePlan.walksLeft, name: usablePlan.plan.name })}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "size-4 rounded-full border-2 shrink-0",
                          effectiveMethod === "PLAN" ? "border-primary bg-primary" : "border-muted-foreground/40"
                        )}
                      />
                    </button>
                  )}
                  {PAYMENT_OPTIONS.map((opt) => {
                    const active = effectiveMethod === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setPaymentMethod(opt.value)}
                        className={cn(
                          "flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition-[border-color,background-color,transform] duration-200 ease-out-expo active:scale-[0.98]",
                          active
                            ? "border-primary bg-brand-soft/50"
                            : "border-border bg-card hover:border-primary/40"
                        )}
                        aria-pressed={active}
                      >
                        <opt.icon
                          className={cn(
                            "size-5 shrink-0",
                            active ? "text-primary" : "text-muted-foreground"
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-sm">{t(opt.labelKey)}</p>
                          <p className="text-xs text-muted-foreground">{t(opt.descKey)}</p>
                        </div>
                        <span
                          className={cn(
                            "size-4 rounded-full border-2 shrink-0",
                            active ? "border-primary bg-primary" : "border-muted-foreground/40"
                          )}
                        />
                      </button>
                    );
                  })}
                </div>
                {effectiveMethod === "PLAN" ? (
                  <p className="text-sm rounded-2xl bg-brand-soft/50 border border-primary/20 p-3">
                    {t("own.pay.plan.covered")}
                  </p>
                ) : (
                  price && (
                    <PriceBreakdownLines
                      className="rounded-2xl border bg-card p-3"
                      totalCents={price.totalCents}
                      feeCents={price.ownerFeeCents}
                      baseLabel={t("own.pricePerWalk")}
                    />
                  )
                )}
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 text-primary shrink-0" />
                  {t("own.step3.payNote")}
                </p>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* nav — plain in-flow row: a sticky bottom bar rendered over (and
          blocking) the duration cards at common viewport sizes. */}
      <div className="flex gap-2 mt-6">
        {step > 0 && (
          <Button
            variant="outline"
            className="rounded-full font-bold px-6"
            onClick={() => setStep((s) => s - 1)}
          >
            <ArrowLeft className="size-4" /> {t("c.back")}
          </Button>
        )}
        {step < 3 ? (
          <Button
            className="rounded-full font-bold flex-1 h-11"
            disabled={!canAdvance}
            onClick={() => setStep((s) => s + 1)}
          >
            {t("own.next")} <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button
            className="rounded-full font-bold flex-1 h-11"
            disabled={!canAdvance || submitMut.isPending}
            onClick={() => submitMut.mutate()}
          >
            {submitMut.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("own.sendRequest")}
            {effectiveMethod !== "PLAN" && price && ` · ${formatBOB(price.totalCents)}`}
          </Button>
        )}
      </div>
      {zoneName && step >= 2 && (
        <p className="text-xs text-muted-foreground text-center mt-2">
          {t("own.zonePrefix")}
          <strong>{zoneName}</strong>
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Candidate radio card                                                */
/* ------------------------------------------------------------------ */

function WalkerOptionCard({
  walker,
  selected,
  durationMin,
  onSelect,
}: {
  walker: WalkerCardDTO | WalkerDetailDTO;
  selected: boolean;
  durationMin: number;
  onSelect: () => void;
}) {
  const { t } = useT();
  const price = priceForDuration(durationMin, walker);
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full rounded-3xl border-2 p-4 text-left transition-[border-color,background-color,box-shadow,transform] duration-200 ease-out-expo active:scale-[0.98] flex items-center gap-3",
        selected
          ? "border-primary bg-brand-soft/50 shadow-sm"
          : "border-border bg-card hover:border-primary/40"
      )}
      aria-pressed={selected}
    >
      <Avatar src={walker.avatarUrl} name={walker.name} />
      <div className="min-w-0 flex-1">
        <p className="font-extrabold leading-tight flex items-center gap-1.5">
          {walker.name}
          {walker.trialDone && (
            <BadgeCheck className="size-4 text-primary" aria-label={t("shell.verified")} />
          )}
        </p>
        <div className="mt-0.5">
          <RatingStars rating={walker.rating} count={walker.ratingCount} />
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t(
            walker.repeatOwners === 1
              ? "own.repeatOwners.one"
              : "own.repeatOwners.many",
            { count: walker.repeatOwners }
          )}{" "}
          · {t("own.respondsIn", { mins: walker.responseMinutes })}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="font-black text-primary">
          {price !== null ? formatBOB(price) : "—"}
        </p>
        <p className="text-[11px] text-muted-foreground font-semibold">
          {durationMin} min
        </p>
      </div>
      <span
        className={cn(
          "size-5 rounded-full border-2 shrink-0 grid place-items-center",
          selected ? "border-primary bg-primary" : "border-muted-foreground/40"
        )}
      >
        {selected && <Check className="size-3 text-primary-foreground" />}
      </span>
    </button>
  );
}
