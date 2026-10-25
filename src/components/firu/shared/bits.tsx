"use client";

// Small shared building blocks used across owner / walker / admin views.

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/firu/i18n";
import { fmtRating } from "@/lib/firu/money";

/* ------------------------- StatusBadge ------------------------- */

// Label text lives in the dictionaries (sh.status.*); only the styling map
// stays here. ES labels are byte-identical to the original hardcoded ones.
const STATUS_STYLES: Record<string, { labelKey: string; cls: string }> = {
  // bookings
  REQUESTED: { labelKey: "sh.status.requested", cls: "bg-sun-soft text-amber-700 border-amber-300" },
  CONFIRMED: { labelKey: "sh.status.confirmed", cls: "bg-brand-soft text-primary border-primary/30" },
  COMPLETED: { labelKey: "sh.status.completed", cls: "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800" },
  CANCELLED: { labelKey: "sh.status.cancelled", cls: "bg-muted text-muted-foreground border-border" },
  DECLINED: { labelKey: "sh.status.declined", cls: "bg-muted text-muted-foreground border-border" },
  // walks
  SCHEDULED: { labelKey: "sh.status.scheduled", cls: "bg-brand-soft text-primary border-primary/30" },
  IN_PROGRESS: { labelKey: "sh.status.inProgress", cls: "bg-primary text-primary-foreground border-primary animate-pulse" },
  NO_SHOW: { labelKey: "sh.status.noShow", cls: "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800" },
  // payments
  PENDING: { labelKey: "sh.status.pending", cls: "bg-sun-soft text-amber-700 border-amber-300" },
  HELD: { labelKey: "sh.status.held", cls: "bg-brand-soft text-primary border-primary/30" },
  RELEASED: { labelKey: "sh.status.released", cls: "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800" },
  REFUNDED: { labelKey: "sh.status.refunded", cls: "bg-muted text-muted-foreground border-border" },
  CASH_SETTLED: { labelKey: "sh.status.cashSettled", cls: "bg-muted text-muted-foreground border-border" },
  // payouts
  REQUESTED_PAYOUT: { labelKey: "sh.status.requestedPayout", cls: "bg-sun-soft text-amber-700 border-amber-300" },
  PAID: { labelKey: "sh.status.paid", cls: "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800" },
  // disputes
  OPEN: { labelKey: "sh.status.open", cls: "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800" },
  RESOLVED_OWNER: { labelKey: "sh.status.resolvedOwner", cls: "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800" },
  RESOLVED_WALKER: { labelKey: "sh.status.resolvedWalker", cls: "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800" },
  DISMISSED: { labelKey: "sh.status.dismissed", cls: "bg-muted text-muted-foreground border-border" },
  // walkers
  PENDING_W: { labelKey: "sh.status.pendingW", cls: "bg-sun-soft text-amber-700 border-amber-300" },
  ACTIVE: { labelKey: "sh.status.active", cls: "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800" },
  SUSPENDED: { labelKey: "sh.status.suspended", cls: "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800" },
  REJECTED: { labelKey: "sh.status.rejected", cls: "bg-muted text-muted-foreground border-border" },
};

export function StatusBadge({
  status,
  kind,
  className,
}: {
  status: string;
  kind?: "booking" | "walk" | "payment" | "payout" | "dispute" | "walker";
  className?: string;
}) {
  const { t } = useT();
  const key =
    status === "REQUESTED" && kind === "payout" ? "REQUESTED_PAYOUT" :
    status === "PENDING" && kind === "walker" ? "PENDING_W" :
    status;
  const s = STATUS_STYLES[key];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap",
        s?.cls ?? "bg-muted text-muted-foreground border-border",
        className
      )}
    >
      {s ? t(s.labelKey) : status}
    </span>
  );
}

/* ------------------------- RatingStars ------------------------- */

export function RatingStars({
  rating,
  count,
  size = "sm",
}: {
  rating: number;
  count?: number;
  size?: "sm" | "md";
}) {
  // useT() subscribes so the rating decimal (4,8 / 4.8) re-renders on lang switch
  useT();
  const starSize = size === "md" ? "size-5" : "size-3.5";
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            className={cn(
              starSize,
              i <= Math.round(rating)
                ? "fill-sun text-sun"
                : "fill-muted text-muted-foreground/40"
            )}
          />
        ))}
      </span>
      <span className="font-extrabold text-sm">{fmtRating(rating)}</span>
      {typeof count === "number" && (
        <span className="text-xs text-muted-foreground">({count})</span>
      )}
    </span>
  );
}

/* ------------------------- SectionHeader ------------------------- */

export function SectionHeader({
  title,
  action,
  subtitle,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-end justify-between gap-3 mb-4", className)}>
      <div>
        <h2 className="text-xl font-black tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ------------------------- EmptyState ------------------------- */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="text-center py-12 px-4 firu-paw-pattern rounded-3xl border border-dashed">
      <span className="mx-auto grid place-items-center size-14 rounded-2xl bg-brand-soft text-primary mb-3">
        <Icon className="size-7" />
      </span>
      <p className="font-extrabold text-lg">{title}</p>
      {description && (
        <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/* ------------------------- Avatar ------------------------- */

export function Avatar({
  src,
  name,
  size = "md",
  className,
}: {
  src?: string | null;
  name?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const { t } = useT();
  const px = size === "lg" ? "size-16" : size === "sm" ? "size-8" : "size-12";
  return (
    <img
      src={src && src.length > 0 ? src : "/images/brand/logo-mark-mint.png"}
      alt={name ? t("sh.avatarAlt", { name }) : ""}
      className={cn("rounded-full object-cover border bg-muted shrink-0", px, className)}
    />
  );
}

/* ------------------------- Dog size chip ------------------------- */

export function DogSizeBadge({ size }: { size: "S" | "M" | "L" }) {
  const { t } = useT();
  const map = { S: t("sh.dogSize.small"), M: t("sh.dogSize.medium"), L: t("sh.dogSize.large") } as const;
  return (
    <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-secondary-foreground">
      {map[size]}
    </span>
  );
}

/* ------------------------- WhatsApp link button ------------------------- */

export function whatsappHref(phone: string, text?: string) {
  const clean = (phone ?? "").replace(/[^\d]/g, "");
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${clean}${q}`;
}
