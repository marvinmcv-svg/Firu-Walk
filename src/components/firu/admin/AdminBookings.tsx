"use client";

// T4-d — Admin bookings table ("Reservas").
// All bookings with status/keyword filters, sticky-header scroll area,
// per-row detail Sheet (schedule, walks, payment) and CSV export.

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { springSmooth, springSnappy } from "@/lib/firu/motion";
import {
  CalendarDays,
  Dog,
  Download,
  Search,
  ShieldAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import { api, qk } from "@/lib/firu/api";
import { useFiruSession } from "@/lib/firu/session";
import type { BookingDTO } from "@/lib/firu/types";
import { formatBOB } from "@/lib/firu/money";
import { daysShort, fmtDateShort, fmtRelative, fmtSchedule, fmtTime } from "@/lib/firu/dates";
import { useT, getLang } from "@/lib/firu/i18n";
import { EmptyState, SectionHeader, StatusBadge } from "@/components/firu/shared/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS = [
  { value: "ALL", key: "adm.bkg.status.all" },
  { value: "REQUESTED", key: "adm.bkg.status.requested" },
  { value: "CONFIRMED", key: "adm.bkg.status.confirmed" },
  { value: "COMPLETED", key: "adm.bkg.status.completed" },
  { value: "CANCELLED", key: "adm.bkg.status.cancelled" },
  { value: "DECLINED", key: "adm.bkg.status.declined" },
] as const;

const PAYMENT_LABEL: Record<string, string> = {
  QR: "adm.pay.qr",
  TRANSFER: "adm.pay.transfer",
  CASH: "adm.pay.cash",
};

const km = (meters: number) =>
  `${(meters / 1000).toFixed(1).replace(".", getLang() === "en" ? "." : ",")} km`;

/** Mini chip for payment method */
function MethodChip({ method }: { method: string }) {
  const { t } = useT();
  const key = PAYMENT_LABEL[method];
  return (
    <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-secondary-foreground">
      {key ? t(key) : method}
    </span>
  );
}

function TypeChip({ type }: { type: BookingDTO["type"] }) {
  const { t } = useT();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold",
        type === "RECURRING"
          ? "bg-brand-soft text-primary border-primary/30"
          : "bg-muted text-muted-foreground border-border"
      )}
    >
      {type === "RECURRING" ? t("adm.bkg.recurring") : t("adm.bkg.oneOff")}
    </span>
  );
}

/* ------------------------------ detail sheet ----------------------------- */

function BookingDetail({
  b,
  onClose,
}: {
  b: BookingDTO;
  onClose: () => void;
}) {
  const setAdminView = useFiruSession((s) => s.setAdminView);
  const { toast } = useToast();
  const { t, lang } = useT();

  return (
    <>
      <SheetHeader className="pb-0">
        <SheetTitle className="flex flex-wrap items-center gap-2">
          <span>{b.dog.name}</span>
          <StatusBadge status={b.status} kind="booking" />
        </SheetTitle>
        <SheetDescription>
          {t("adm.bkg.sheetDesc", {
            owner: b.owner.name,
            zone: b.zone.name,
            ago: fmtRelative(b.requestedAt),
          })}
        </SheetDescription>
      </SheetHeader>

      <div className="px-4 pb-6 space-y-4 flex-1 min-h-0 overflow-y-auto">
        {/* Parties */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-secondary px-3 py-2.5">
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">{t("shell.role.owner")}</p>
            <p className="text-sm font-extrabold truncate">{b.owner.name}</p>
            <p className="text-xs text-muted-foreground">{b.owner.phone}</p>
          </div>
          <div className="rounded-2xl bg-secondary px-3 py-2.5">
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">{t("shell.role.walker")}</p>
            <p className="text-sm font-extrabold truncate">{b.walker?.name ?? t("adm.bkg.unassigned")}</p>
            {b.walker && <p className="text-xs text-muted-foreground">{b.walker.phone}</p>}
          </div>
        </div>

        {/* Core facts */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-2xl border px-2 py-2">
            <p className="text-[11px] text-muted-foreground font-bold">{t("adm.bkg.duration")}</p>
            <p className="text-sm font-black">{b.durationMin} min</p>
          </div>
          <div className="rounded-2xl border px-2 py-2">
            <p className="text-[11px] text-muted-foreground font-bold">{t("adm.bkg.perWalk")}</p>
            <p className="text-sm font-black">{formatBOB(b.pricePerWalkCents)}</p>
          </div>
          <div className="rounded-2xl border px-2 py-2">
            <p className="text-[11px] text-muted-foreground font-bold">{t("adm.bkg.type")}</p>
            <div className="mt-0.5 flex justify-center"><TypeChip type={b.type} /></div>
          </div>
        </div>

        {/* Schedule */}
        <section>
          <h4 className="text-xs font-black uppercase tracking-wide text-muted-foreground mb-2">
            {t("adm.bkg.schedule")}
          </h4>
          <p className="text-sm font-bold">{fmtSchedule(b.schedule, b.type)}</p>
          {b.type === "RECURRING" && (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {b.schedule.map((s, i) => (
                <li
                  key={i}
                  className="rounded-full bg-brand-soft text-primary px-2 py-0.5 text-[11px] font-bold"
                >
                  {daysShort(lang)[s.day ?? 0]}{" "}
                  {`${Math.floor(s.minute / 60)}:${(s.minute % 60).toString().padStart(2, "0")}`}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Notes */}
        {b.notes && (
          <section>
            <h4 className="text-xs font-black uppercase tracking-wide text-muted-foreground mb-2">
              {t("adm.bkg.ownerNotes")}
            </h4>
            <p className="text-sm border-l-2 border-primary/40 pl-3 leading-relaxed">«{b.notes}»</p>
          </section>
        )}

        {/* Walks */}
        <section>
          <h4 className="text-xs font-black uppercase tracking-wide text-muted-foreground mb-2">
            {t("adm.bkg.walks", { count: b.walks.length })}
          </h4>
          {b.walks.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("adm.bkg.walksHint")}</p>
          ) : (
            <ul className="space-y-2">
              {b.walks.map((w) => (
                <li
                  key={w.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2"
                >
                  <StatusBadge status={w.status} kind="walk" />
                  <span className="text-sm font-bold">
                    {fmtDateShort(w.scheduledStart)} · {fmtTime(w.scheduledStart)}
                  </span>
                  {w.status === "COMPLETED" && (
                    <span className="text-xs text-muted-foreground font-semibold">
                      {t("adm.bkg.traveled", { km: km(w.distanceMeters) })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Payment */}
        <section>
          <h4 className="text-xs font-black uppercase tracking-wide text-muted-foreground mb-2">
            {t("adm.bkg.payment")}
          </h4>
          {b.payment ? (
            <div className="rounded-2xl border px-3 py-2.5 flex flex-wrap items-center gap-2">
              <MethodChip method={b.payment.method} />
              <StatusBadge status={b.payment.status} kind="payment" />
              <span className="text-sm font-black">{formatBOB(b.payment.amountCents)}</span>
              {b.payment.qrRef && (
                <span className="text-xs text-muted-foreground">{t("adm.bkg.ref")}{b.payment.qrRef}</span>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("adm.bkg.noPayment")}</p>
          )}
        </section>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            className="rounded-full"
            onClick={() => {
              onClose();
              setAdminView("disputes");
            }}
          >
            <ShieldAlert className="size-4" /> {t("adm.bkg.viewCases")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={() => {
              window.open("/api/admin/export?type=bookings", "_blank");
              toast({ title: t("adm.bkg.exporting"), description: t("adm.bkg.exportDesc") });
            }}
          >
            <Download className="size-4" /> {t("adm.exportCsv")}
          </Button>
        </div>
      </div>
    </>
  );
}

/* ================================= view ================================= */

export function AdminBookings() {
  const { t } = useT();
  const [status, setStatus] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: bookings, isLoading } = useQuery({
    queryKey: qk.adminBookings,
    queryFn: () => api.get<BookingDTO[]>("/api/admin/bookings"),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (bookings ?? []).filter((b) => {
      if (status !== "ALL" && b.status !== status) return false;
      if (!q) return true;
      return (
        b.owner.name.toLowerCase().includes(q) ||
        (b.walker?.name ?? "").toLowerCase().includes(q) ||
        b.dog.name.toLowerCase().includes(q)
      );
    });
  }, [bookings, status, search]);

  const selected = (bookings ?? []).find((b) => b.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <SectionHeader
        title={t("shell.nav.bookings")}
        subtitle={t("adm.bkg.subtitle", { shown: filtered.length, total: bookings?.length ?? 0 })}
        action={
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => window.open("/api/admin/export?type=bookings", "_blank")}
          >
            <Download className="size-4" /> {t("adm.exportCsv")}
          </Button>
        }
      />

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSnappy}
        className="flex flex-wrap gap-2"
      >
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48 rounded-full">
            <SelectValue placeholder={t("adm.bkg.status")} />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {t(o.key)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("adm.bkg.searchPh")}
            className="rounded-full pl-9"
          />
        </div>
      </motion.div>

      {/* Table */}
      {isLoading ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={t("adm.bkg.empty")}
          description={t("adm.bkg.emptyDesc")}
        />
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springSmooth, delay: 0.05 }}
          className="max-h-[70vh] overflow-auto rounded-2xl border bg-card"
        >
          <table className="w-full caption-bottom text-sm">
            <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--color-border)]">
              <TableRow>
                <TableHead className="pl-4">{t("adm.bkg.th.date")}</TableHead>
                <TableHead>{t("shell.role.owner")}</TableHead>
                <TableHead>{t("shell.role.walker")}</TableHead>
                <TableHead>{t("adm.bkg.th.dog")}</TableHead>
                <TableHead>{t("adm.bkg.type")}</TableHead>
                <TableHead>{t("adm.bkg.schedule")}</TableHead>
                <TableHead className="text-right">{t("adm.bkg.th.price")}</TableHead>
                <TableHead>{t("adm.bkg.status")}</TableHead>
                <TableHead className="pr-4">{t("adm.bkg.payment")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((b) => (
                <TableRow
                  key={b.id}
                  onClick={() => setSelectedId(b.id)}
                  className="cursor-pointer"
                >
                  <TableCell className="pl-4 text-muted-foreground">
                    {fmtDateShort(b.requestedAt)}
                  </TableCell>
                  <TableCell className="font-bold">{b.owner.name}</TableCell>
                  <TableCell className={cn(!b.walker && "text-muted-foreground")}>
                    {b.walker?.name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5">
                      <Dog className="size-3.5 text-muted-foreground" />
                      {b.dog.name}
                    </span>
                  </TableCell>
                  <TableCell>
                    <TypeChip type={b.type} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {fmtSchedule(b.schedule, b.type)}
                  </TableCell>
                  <TableCell className="text-right font-black tabular-nums">
                    {formatBOB(b.pricePerWalkCents)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={b.status} kind="booking" />
                  </TableCell>
                  <TableCell className="pr-4">
                    {b.payment ? (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <MethodChip method={b.payment.method} />
                        <StatusBadge status={b.payment.status} kind="payment" />
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </motion.div>
      )}

      {/* Detail sheet */}
      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
          {selected && <BookingDetail b={selected} onClose={() => setSelectedId(null)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
