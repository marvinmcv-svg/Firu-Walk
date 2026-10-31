"use client";

// Owner → Bookings: active (REQUESTED with live accept-countdown +
// auto-fallback, CONFIRMED with chat/pay/cancel) and history tabs with
// expandable walk reports, star reviews with tip, and dispute reporting.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Ban,
  CalendarDays,
  ChevronDown,
  Clock,
  CreditCard,
  Footprints,
  Loader2,
  MessageCircle,
  Repeat2,
  ShieldAlert,
  Star,
  Wallet,
} from "lucide-react";
import { api, qk } from "@/lib/firu/api";
import { useFiruSession } from "@/lib/firu/session";
import { srvErr, useT } from "@/lib/firu/i18n";
import { formatBOB, parseBOB } from "@/lib/firu/money";
import {
  fmtDateShort,
  fmtRelative,
  fmtSchedule,
  fmtTime,
  fmtUntil,
} from "@/lib/firu/dates";
import type {
  AppConfig,
  BookingDTO,
  WalkDTO,
} from "@/lib/firu/types";
import { easeOutExpo } from "@/lib/firu/motion";
import {
  Avatar,
  EmptyState,
  RatingStars,
  StatusBadge,
} from "@/components/firu/shared/bits";
import { ChatDialog } from "@/components/firu/shared/ChatDialog";
import { PaymentDialog } from "@/components/firu/shared/PaymentDialog";
import { ReportCardView } from "@/components/firu/shared/ReportCardView";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/** Walk detail incl. parsed polyline (GET /api/walks/{id} additive fields). */
type WalkDetail = WalkDTO & {
  track: [number, number][];
  startLat: number | null;
  startLng: number | null;
};

const DISPUTE_REASONS = [
  { value: "LATE", key: "own.dispute.late" },
  { value: "NO_SHOW", key: "own.dispute.noShow" },
  { value: "QUALITY", key: "own.dispute.quality" },
  { value: "SAFETY", key: "own.dispute.safety" },
  { value: "BILLING", key: "own.dispute.billing" },
  { value: "OTHER", key: "own.dispute.other" },
] as const;

/* ------------------------------------------------------------------ */
/* Live mm:ss countdown to the accept deadline                         */
/* ------------------------------------------------------------------ */

function AcceptCountdown({
  expiresAt,
  onExpire,
}: {
  expiresAt: string;
  onExpire: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const firedRef = useRef(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = new Date(expiresAt).getTime() - now;
  useEffect(() => {
    if (ms <= 0 && !firedRef.current) {
      firedRef.current = true;
      onExpire();
    }
  }, [ms, onExpire]);
  const s = Math.max(0, Math.ceil(ms / 1000));
  return (
    <span className="tabular-nums font-black text-amber-700">
      {String(Math.floor(s / 60)).padStart(2, "0")}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Single walk row (lazy track fetch for completed walks)              */
/* ------------------------------------------------------------------ */

function WalkRow({
  walk,
  walkerAvatar,
}: {
  walk: WalkDTO;
  walkerAvatar?: string | null;
}) {
  useT(); // re-render on language change (dates render via lang-aware helpers)
  const { data: detail } = useQuery({
    queryKey: qk.walk(walk.id),
    queryFn: () => api.get<WalkDetail>(`/api/walks/${walk.id}`),
    enabled: walk.status === "COMPLETED",
    staleTime: 60_000,
  });

  if (walk.status === "COMPLETED") {
    return (
      <div className="rounded-3xl border bg-muted/30 p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <p className="text-sm font-bold flex items-center gap-1.5">
            <Footprints className="size-4 text-primary" />
            {fmtDateShort(walk.startedAt ?? walk.scheduledStart)} ·{" "}
            {fmtTime(walk.startedAt ?? walk.scheduledStart)}
          </p>
          <StatusBadge status="COMPLETED" kind="walk" />
        </div>
        <ReportCardView
          report={walk.report ?? null}
          track={detail?.track ?? []}
          startedAt={walk.startedAt}
          endedAt={walk.endedAt}
          distanceMeters={walk.distanceMeters}
          durationMin={walk.durationMin}
          dogName={walk.dog.name}
          dogAvatar={walk.dog.photoUrl}
          walkerAvatar={walkerAvatar}
        />
      </div>
    );
  }

  // upcoming / cancelled / no-show row
  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl bg-muted/40 px-4 py-3">
      <p className="text-sm font-bold flex items-center gap-1.5">
        <CalendarDays className="size-4 text-muted-foreground" />
        {fmtDateShort(walk.scheduledStart)} · {fmtTime(walk.scheduledStart)}
      </p>
      <StatusBadge status={walk.status} kind="walk" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Review dialog (stars + comment + tip)                               */
/* ------------------------------------------------------------------ */

function ReviewDialog({
  open,
  onOpenChange,
  booking,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  booking: BookingDTO;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [rating, setRating] = useState(5);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [tip, setTip] = useState<number>(0); // centavos
  const [tipCustom, setTipCustom] = useState("");
  const [initialized, setInitialized] = useState(false);

  if (open && !initialized) {
    setRating(5);
    setHover(0);
    setComment("");
    setTip(0);
    setTipCustom("");
    setInitialized(true);
  }
  if (!open && initialized) setInitialized(false);

  const submitMut = useMutation({
    mutationFn: () =>
      api.post("/api/reviews", {
        bookingId: booking.id,
        walkId: null,
        rating,
        comment: comment.trim() || undefined,
        tipCents: tip,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.bookings });
      toast({
        title: t("own.review.thanksTitle"),
        description:
          tip > 0
            ? t("own.review.tipToastDesc", { amount: formatBOB(tip) })
            : t("own.review.noTipToastDesc"),
      });
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast({
        title: t("own.review.errTitle"),
        description: srvErr(e.message),
        variant: "destructive",
      }),
  });

  const tipChips: { cents: number; label: string }[] = [
    { cents: 0, label: t("own.review.noTip") },
    { cents: 200, label: "Bs 2" },
    { cents: 500, label: "Bs 5" },
    { cents: 1000, label: "Bs 10" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("own.review.title", {
              dog: booking.dog.name,
              walker: booking.walker?.name ?? t("own.theWalker"),
            })}
          </DialogTitle>
          <DialogDescription>
            {t("own.review.desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* star picker */}
          <div className="text-center py-1">
            <div className="flex justify-center gap-1.5">
              {[1, 2, 3, 4, 5].map((i) => (
                <button
                  key={i}
                  onClick={() => setRating(i)}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(0)}
                  className="p-1 transition-transform duration-150 ease-out-expo hover:scale-110 active:scale-95"
                  aria-label={t(
                    i > 1 ? "own.review.stars.many" : "own.review.stars.one",
                    { count: i }
                  )}
                >
                  <Star
                    className={cn(
                      "size-9",
                      i <= (hover || rating)
                        ? "fill-sun text-sun"
                        : "fill-muted text-muted-foreground/40"
                    )}
                  />
                </button>
              ))}
            </div>
            <p className="text-sm font-bold text-muted-foreground mt-1">
              {rating === 5
                ? t("own.rating.5")
                : rating === 4
                  ? t("own.rating.4")
                  : rating === 3
                    ? t("own.rating.3")
                    : rating === 2
                      ? t("own.rating.2")
                      : t("own.rating.1")}
            </p>
          </div>

          {/* comment */}
          <div className="space-y-1.5">
            <Label htmlFor="rv-comment">{t("own.review.commentLabel")}</Label>
            <Textarea
              id="rv-comment"
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t("own.review.commentPh")}
            />
          </div>

          {/* tip */}
          <div className="space-y-2">
            <Label>{t("own.review.tipLabel")}</Label>
            <div className="grid grid-cols-4 gap-2">
              {tipChips.map((c) => (
                <button
                  key={c.cents}
                  onClick={() => {
                    setTip(c.cents);
                    setTipCustom("");
                  }}
                  className={cn(
                    "rounded-full border-2 py-2 text-sm font-bold transition-[border-color,background-color,color,transform] duration-200 ease-out-expo active:scale-[0.97]",
                    tip === c.cents && !tipCustom
                      ? "border-primary bg-brand-soft text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  )}
                  aria-pressed={tip === c.cents && !tipCustom}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground shrink-0">{t("own.review.tipOther")}</span>
              <Input
                value={tipCustom}
                onChange={(e) => {
                  setTipCustom(e.target.value);
                  setTip(parseBOB(e.target.value));
                }}
                placeholder={t("own.review.tipOtherPh")}
                className="rounded-xl"
                inputMode="decimal"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t("own.review.tipNote")}
            </p>
          </div>

          <Button
            className="w-full rounded-full font-bold"
            disabled={submitMut.isPending}
            onClick={() => submitMut.mutate()}
          >
            {submitMut.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("own.review.submit")}
            {tip > 0 && ` ${t("own.review.submitTip", { amount: formatBOB(tip) })}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Dispute dialog                                                      */
/* ------------------------------------------------------------------ */

function DisputeDialog({
  open,
  onOpenChange,
  booking,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  booking: BookingDTO;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const [reason, setReason] = useState<string>("LATE");
  const [description, setDescription] = useState("");
  const [initialized, setInitialized] = useState(false);

  if (open && !initialized) {
    setReason("LATE");
    setDescription("");
    setInitialized(true);
  }
  if (!open && initialized) setInitialized(false);

  const submitMut = useMutation({
    mutationFn: () =>
      api.post("/api/disputes", {
        bookingId: booking.id,
        reason,
        description: description.trim(),
      }),
    onSuccess: () => {
      toast({
        title: t("own.dispute.sentTitle"),
        description: t("own.dispute.sentDesc"),
      });
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast({
        title: t("own.dispute.errTitle"),
        description: srvErr(e.message),
        variant: "destructive",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-destructive" />
            {t("own.dispute.title")}
          </DialogTitle>
          <DialogDescription>
            {t("own.dispute.desc", {
              dog: booking.dog.name,
              walker: booking.walker?.name ?? t("own.theWalker"),
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("own.dispute.reason")}</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DISPUTE_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {t(r.key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dp-desc">{t("own.dispute.whatLabel")}</Label>
            <Textarea
              id="dp-desc"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("own.dispute.whatPh")}
            />
          </div>
          <Button
            className="w-full rounded-full font-bold"
            disabled={!description.trim() || submitMut.isPending}
            onClick={() => submitMut.mutate()}
          >
            {submitMut.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("own.dispute.submit")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Booking card                                                        */
/* ------------------------------------------------------------------ */

function BookingCard({
  booking,
  config,
  autoOpen,
}: {
  booking: BookingDTO;
  config?: AppConfig;
  autoOpen: boolean;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [expanded, setExpanded] = useState(autoOpen);
  // keeps the highlight ring for the life of the card after a deep link
  const [highlight] = useState(autoOpen);
  const [chatOpen, setChatOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // deep link from openBooking(): scroll into view once (expansion comes
  // from the initial state), then clear the selection
  useEffect(() => {
    if (!autoOpen) return;
    const t = setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      useFiruSession.setState({ selectedBookingId: null });
    }, 150);
    return () => clearTimeout(t);
  }, [autoOpen]);

  const cancelMut = useMutation({
    mutationFn: () =>
      api.patch<BookingDTO>(`/api/bookings/${booking.id}`, { action: "cancel" }),
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: qk.bookings });
      toast({
        title: t("own.booking.cancelToastTitle"),
        description:
          b.cancelReason ?? t("own.booking.cancelToastDesc"),
      });
      setCancelOpen(false);
    },
    onError: (e: Error) =>
      toast({ title: t("own.booking.cancelErrTitle"), description: srvErr(e.message), variant: "destructive" }),
  });

  const hasWalks = booking.walks.length > 0;
  const isHistory = ["COMPLETED", "CANCELLED", "DECLINED"].includes(booking.status);
  const payment = booking.payment;

  return (
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={easeOutExpo}
      className={cn(
        "rounded-3xl border bg-card p-4 sm:p-5 shadow-sm space-y-3",
        highlight && "ring-2 ring-primary/40"
      )}
    >
      {/* head */}
      <div className="flex items-start gap-3 flex-wrap">
        <img
          src={booking.dog.photoUrl ?? "/images/brand/logo-mark-mint.png"}
          alt={t("own.dogPhotoAlt", { name: booking.dog.name })}
          className="size-14 rounded-2xl object-cover border bg-muted shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-extrabold text-lg leading-tight">{booking.dog.name}</p>
            <StatusBadge status={booking.status} kind="booking" />
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-secondary-foreground inline-flex items-center gap-1">
              {booking.type === "RECURRING" ? (
                <>
                  <Repeat2 className="size-3" /> {t("own.type.recurring")}
                </>
              ) : (
                t("own.type.oneOff")
              )}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            {booking.walker ? (
              <>
                <Avatar src={booking.walker.avatarUrl} name={booking.walker.name} size="sm" />
                <p className="text-sm text-muted-foreground">
                  {t("own.withLabel")}<strong className="text-foreground">{booking.walker.name}</strong>
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("own.booking.unassigned")}</p>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1.5">
            {fmtSchedule(booking.schedule, booking.type)} · {booking.durationMin} min ·{" "}
            {booking.zone.name} ·{" "}
            <strong className="text-foreground">{formatBOB(booking.pricePerWalkCents)}</strong>{" "}
            {t("own.perWalk")}
          </p>
          {booking.nextWalkAt && booking.status === "CONFIRMED" && (
            <p className="text-xs font-bold text-primary mt-1 inline-flex items-center gap-1">
              <Clock className="size-3" />{" "}
              {t("own.booking.nextWalk", {
                until: fmtUntil(booking.nextWalkAt),
                date: fmtDateShort(booking.nextWalkAt),
                time: fmtTime(booking.nextWalkAt),
              })}
            </p>
          )}
        </div>
      </div>

      {/* REQUESTED: live countdown + fallback explanation */}
      {booking.status === "REQUESTED" && booking.expiresAt && (
        <div className="rounded-2xl bg-sun-soft/70 border border-amber-300 p-3.5 text-sm">
          <p className="font-bold flex items-center gap-2 flex-wrap">
            <Loader2 className="size-4 animate-spin text-amber-700" />
            {t("own.searchingWalker")} {booking.walker?.name ?? ""} {t("own.hasFor")}{" "}
            <AcceptCountdown
              expiresAt={booking.expiresAt}
              onExpire={() => qc.invalidateQueries({ queryKey: qk.bookings })}
            />{" "}
            {t("own.booking.toAccept")}
          </p>
          <p className="text-muted-foreground text-xs leading-relaxed mt-1">
            {t("own.booking.fallbackNote")}
          </p>
        </div>
      )}

      {/* DECLINED / CANCELLED reason */}
      {["CANCELLED", "DECLINED"].includes(booking.status) && (
        <p className="text-xs text-muted-foreground rounded-2xl bg-muted/50 px-3 py-2">
          {booking.status === "DECLINED"
            ? t("own.booking.declinedNote")
            : `${t("own.booking.cancelled")}${booking.cancelledBy ? ` ${t("own.booking.cancelledBy", {
                actor:
                  booking.cancelledBy === "OWNER"
                    ? t("own.actor.you")
                    : booking.cancelledBy === "WALKER"
                      ? t("own.actor.walker")
                      : t("own.actor.ops"),
              })}` : ""}${booking.cancelReason ? ` · ${booking.cancelReason}` : ""}`}
        </p>
      )}

      {/* COMPLETED: review display */}
      {booking.status === "COMPLETED" && booking.review && (
        <div className="rounded-2xl bg-brand-soft/50 border border-primary/20 p-3.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="font-bold text-sm">{t("own.review.yours")}</p>
            <p className="text-[11px] text-muted-foreground">
              {fmtRelative(booking.review.createdAt)}
            </p>
          </div>
          <div className="mt-1">
            <RatingStars rating={booking.review.rating} />
          </div>
          {booking.review.comment && (
            <p className="text-sm text-muted-foreground leading-relaxed mt-1.5">
              {booking.review.comment}
            </p>
          )}
          {booking.review.tipCents > 0 && (
            <p className="text-xs font-bold text-primary mt-1.5 inline-flex items-center gap-1">
              <Wallet className="size-3.5" />{" "}
              {t("own.review.tipBadge", { amount: formatBOB(booking.review.tipCents) })}
            </p>
          )}
        </div>
      )}

      {/* actions */}
      <div className="flex gap-2 flex-wrap">
        {booking.status === "CONFIRMED" && booking.walker && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full font-bold"
              onClick={() => setChatOpen(true)}
            >
              <MessageCircle className="size-3.5 text-primary" /> {t("own.chat")}
            </Button>
            <Button
              variant={payment?.status === "PENDING" ? "default" : "outline"}
              size="sm"
              className="rounded-full font-bold"
              onClick={() => setPayOpen(true)}
            >
              <CreditCard className="size-3.5" />
              {payment?.status === "PENDING"
                ? t("own.booking.pay", { amount: formatBOB(payment.amountCents) })
                : payment
                  ? t("own.booking.payLabel", {
                      status:
                        payment.method === "PLAN" && payment.status === "HELD"
                          ? t("own.payStatus.plan")
                          : payment.status === "HELD"
                          ? t("own.payStatus.held")
                          : payment.status === "RELEASED"
                            ? t("own.payStatus.released")
                            : payment.status === "CASH_SETTLED"
                              ? t("own.payStatus.cash")
                              : payment.status === "REFUNDED"
                                ? t("own.payStatus.refunded")
                                : payment.status,
                    })
                  : t("own.booking.paying")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full font-bold text-destructive hover:text-destructive"
              onClick={() => setCancelOpen(true)}
            >
              <Ban className="size-3.5" /> {t("c.cancel")}
            </Button>
          </>
        )}
        {booking.status === "COMPLETED" && !booking.review && (
          <Button
            size="sm"
            className="rounded-full font-bold"
            onClick={() => setReviewOpen(true)}
          >
            <Star className="size-3.5" /> {t("own.review.leave")}
          </Button>
        )}
        {["CONFIRMED", "COMPLETED"].includes(booking.status) && (
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full font-bold text-muted-foreground"
            onClick={() => setDisputeOpen(true)}
          >
            <ShieldAlert className="size-3.5" /> {t("own.dispute.title")}
          </Button>
        )}
        {hasWalks && isHistory && (
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full font-bold ml-auto"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? t("own.hide") : t("own.show")} {t("own.walksWord")} ({booking.walks.length})
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform duration-200 ease-out-expo",
                expanded && "rotate-180"
              )}
            />
          </Button>
        )}
        {hasWalks && !isHistory && booking.walks.some((w) => w.status === "COMPLETED") && (
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full font-bold ml-auto"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? t("own.hide") : t("own.show")} {t("own.reportsWord")}
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform duration-200 ease-out-expo",
                expanded && "rotate-180"
              )}
            />
          </Button>
        )}
      </div>

      {/* expandable walks */}
      <AnimatePresence initial={false}>
        {expanded && hasWalks && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={easeOutExpo}
            className="overflow-hidden"
          >
            <div className="max-h-96 overflow-y-auto space-y-3 pr-1 pt-1">
              {[...booking.walks]
                .sort(
                  (a, b) =>
                    new Date(b.scheduledStart).getTime() -
                    new Date(a.scheduledStart).getTime()
                )
                .map((w) => (
                  <WalkRow key={w.id} walk={w} walkerAvatar={booking.walker?.avatarUrl} />
                ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* dialogs */}
      {booking.walker && (
        <ChatDialog
          open={chatOpen}
          onOpenChange={setChatOpen}
          threadId={booking.id}
          otherName={booking.walker.name}
          otherAvatar={booking.walker.avatarUrl}
          otherPhone={booking.walker.phone}
          contextLabel={t("own.chatCtxWalks", {
            dog: booking.dog.name,
            zone: booking.zone.name,
          })}
        />
      )}
      <PaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        bookingId={booking.id}
        payment={payment}
        title={t("own.booking.payTitle", { dog: booking.dog.name })}
        description={t("own.payHeldDesc")}
      />
      <ReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        booking={booking}
      />
      <DisputeDialog
        open={disputeOpen}
        onOpenChange={setDisputeOpen}
        booking={booking}
      />

      {/* cancel confirm */}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("own.booking.cancelTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              {t("own.booking.cancelDesc", {
                hours: config?.policy.cancellationFreeHours ?? 12,
                pct: config?.policy.lateCancelWalkerSharePct ?? 50,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">{t("own.booking.keep")}</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                cancelMut.mutate();
              }}
            >
              {cancelMut.isPending ? t("own.booking.cancelling") : t("own.booking.yesCancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Main view                                                           */
/* ------------------------------------------------------------------ */

export function OwnerBookings() {
  const { t } = useT();
  const selectedBookingId = useFiruSession((s) => s.selectedBookingId);
  const startBookingFlow = useFiruSession((s) => s.startBookingFlow);

  const { data: bookings, isLoading } = useQuery({
    queryKey: qk.bookings,
    queryFn: () => api.get<BookingDTO[]>("/api/bookings"),
    // live fallback/auto-accept while any request is pending
    refetchInterval: (query) =>
      (query.state.data ?? []).some((b) => b.status === "REQUESTED") ? 5000 : false,
  });
  const { data: config } = useQuery({
    queryKey: qk.config,
    queryFn: () => api.get<AppConfig>("/api/config"),
  });

  const [tab, setTab] = useState<string>("activas");

  const active = (bookings ?? [])
    .filter((b) => ["REQUESTED", "CONFIRMED"].includes(b.status))
    .sort((a, b) => {
      const rank = (s: string) => (s === "REQUESTED" ? 0 : 1);
      return (
        rank(a.status) - rank(b.status) ||
        new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
      );
    });
  const history = (bookings ?? [])
    .filter((b) => ["COMPLETED", "CANCELLED", "DECLINED"].includes(b.status))
    .sort(
      (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
    );

  const shown = tab === "activas" ? active : history;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-black tracking-tight">{t("own.bookings.title")}</h1>
        <Button
          className="rounded-full font-bold"
          size="sm"
          onClick={() => startBookingFlow()}
        >
          {t("own.bookings.new")}
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="rounded-full p-1 h-auto">
          <TabsTrigger
            value="activas"
            className="rounded-full font-bold px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            {t("own.bookings.tabActive", { count: active.length })}
          </TabsTrigger>
          <TabsTrigger
            value="historial"
            className="rounded-full font-bold px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            {t("own.bookings.tabHistory", { count: history.length })}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-36 w-full rounded-3xl" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={
            tab === "activas"
              ? t("own.bookings.emptyActiveTitle")
              : t("own.bookings.emptyHistoryTitle")
          }
          description={
            tab === "activas"
              ? t("own.bookings.emptyActiveDesc")
              : t("own.bookings.emptyHistoryDesc")
          }
          action={
            tab === "activas" ? (
              <Button
                className="rounded-full font-bold"
                onClick={() => startBookingFlow()}
              >
                {t("own.bookWalk")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {shown.map((b) => (
            <BookingCard
              key={b.id + b.status}
              booking={b}
              config={config}
              autoOpen={selectedBookingId === b.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
