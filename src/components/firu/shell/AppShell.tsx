"use client";

// App frame: top bar (notifications, user), left sidebar on lg+, bottom nav on mobile.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useT } from "@/lib/firu/i18n";
import { LangToggle } from "@/components/firu/shared/LangToggle";
import {
  BadgeCheck,
  Bell,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  CreditCard,
  Dog,
  Footprints,
  LayoutDashboard,
  LogOut,
  Map,
  Moon,
  PawPrint,
  Search,
  Settings2,
  ShieldAlert,
  Sun,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { api, qk } from "@/lib/firu/api";
import { springSnappy } from "@/lib/firu/motion";
import { useFiruSession } from "@/lib/firu/session";
import type { NotificationDTO, SessionUserDTO } from "@/lib/firu/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import { OwnerHome } from "@/components/firu/owner/OwnerHome";
import { WalkerExplore } from "@/components/firu/owner/WalkerExplore";
import { BookingFlow } from "@/components/firu/owner/BookingFlow";
import { OwnerBookings } from "@/components/firu/owner/OwnerBookings";
import { LiveWalkView } from "@/components/firu/owner/LiveWalkView";
import { DogProfiles } from "@/components/firu/owner/DogProfiles";
import { WalkerDetail } from "@/components/firu/owner/WalkerDetail";
import { WalkerHome } from "@/components/firu/walker/WalkerHome";
import { WalkerAvailability } from "@/components/firu/walker/WalkerAvailability";
import { ActiveWalkScreen } from "@/components/firu/walker/ActiveWalkScreen";
import { WalkerEarnings } from "@/components/firu/walker/WalkerEarnings";
import { WalkerProfileView } from "@/components/firu/walker/WalkerProfileView";
import { AdminDashboard } from "@/components/firu/admin/AdminDashboard";
import { AdminApplications } from "@/components/firu/admin/AdminApplications";
import { AdminBookings } from "@/components/firu/admin/AdminBookings";
import { AdminDisputes } from "@/components/firu/admin/AdminDisputes";
import { AdminUsers } from "@/components/firu/admin/AdminUsers";
import { AdminConfig } from "@/components/firu/admin/AdminConfig";

const NAV = {
  OWNER: [
    { view: "home", labelKey: "shell.nav.home", icon: PawPrint },
    { view: "explore", labelKey: "shell.nav.explore", icon: Search },
    { view: "bookings", labelKey: "shell.nav.bookings", icon: CalendarDays },
    { view: "profile", labelKey: "shell.nav.profile", icon: Dog },
  ],
  WALKER: [
    { view: "home", labelKey: "shell.nav.home", icon: Footprints },
    { view: "availability", labelKey: "shell.nav.agenda", icon: CalendarClock },
    { view: "earnings", labelKey: "shell.nav.earnings", icon: Wallet },
    { view: "profile", labelKey: "shell.nav.profile", icon: UserRound },
  ],
  ADMIN: [
    { view: "dashboard", labelKey: "shell.nav.panel", icon: LayoutDashboard },
    { view: "applications", labelKey: "shell.nav.applications", icon: ClipboardList },
    { view: "bookings", labelKey: "shell.nav.bookings", icon: CalendarDays },
    { view: "disputes", labelKey: "shell.nav.cases", icon: ShieldAlert },
    { view: "users", labelKey: "shell.nav.users", icon: Users },
    { view: "config", labelKey: "shell.nav.config", icon: Settings2 },
  ],
} as const;

/** Hydration-safe "mounted" flag without setState-in-effect. */
const emptySubscribe = () => () => {};
const useMounted = () => useSyncExternalStore(emptySubscribe, () => true, () => false);

export function AppShell() {
  const { t } = useT();
  const user = useFiruSession((s) => s.user);
  const ownerView = useFiruSession((s) => s.ownerView);
  const walkerView = useFiruSession((s) => s.walkerView);
  const adminView = useFiruSession((s) => s.adminView);
  const logout = useFiruSession((s) => s.logout);

  // Confirm the cached session against the server cookie (and refresh the
  // profile). A 401 here clears the local session via the api client.
  useQuery({
    queryKey: qk.me,
    queryFn: async () => {
      const me = await api.get<SessionUserDTO>("/api/users/me");
      useFiruSession.getState().setUser(me);
      return me;
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  if (!user) return null;
  const role = user.role;
  const nav = NAV[role];
  const activeView =
    role === "OWNER" ? ownerView : role === "WALKER" ? walkerView : adminView;

  const currentView = () => {
    if (role === "OWNER") {
      switch (ownerView) {
        case "home": return <OwnerHome />;
        case "explore": return <WalkerExplore />;
        case "booking-flow": return <BookingFlow />;
        case "bookings": return <OwnerBookings />;
        case "walk-live": return <LiveWalkView />;
        case "walker-detail": return <WalkerDetail />;
        case "profile": return <DogProfiles />;
        default: return <OwnerHome />;
      }
    }
    if (role === "WALKER") {
      switch (walkerView) {
        case "home": return <WalkerHome />;
        case "availability": return <WalkerAvailability />;
        case "walk-active": return <ActiveWalkScreen />;
        case "earnings": return <WalkerEarnings />;
        case "profile": return <WalkerProfileView />;
        default: return <WalkerHome />;
      }
    }
    switch (adminView) {
      case "dashboard": return <AdminDashboard />;
      case "applications": return <AdminApplications />;
      case "bookings": return <AdminBookings />;
      case "disputes": return <AdminDisputes />;
      case "users": return <AdminUsers />;
      case "config": return <AdminConfig />;
      default: return <AdminDashboard />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top bar — translucent Apple material, hairline bottom edge */}
      <header className="firu-glass sticky top-0 z-40 border-b border-border/50 pt-safe">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center gap-3">
          <button
            className="flex items-center gap-2 font-extrabold text-lg transition-transform duration-150 ease-out-expo active:scale-95"
            onClick={() => useFiruSession.setState(
              role === "OWNER" ? { ownerView: "home" } : role === "WALKER" ? { walkerView: "home" } : { adminView: "dashboard" }
            )}
          >
            <img
              src="/images/brand/logo-wordmark.png"
              alt="FiruWalk"
              className="h-7 w-auto dark:hidden"
            />
            <img
              src="/images/brand/logo-wordmark-dark.png"
              alt="FiruWalk"
              className="h-7 w-auto hidden dark:block"
            />
          </button>
          {user.role === "WALKER" && user.walker?.status === "ACTIVE" && (
            <span className="hidden md:inline-flex items-center gap-1 text-xs font-bold text-primary bg-brand-soft rounded-full px-2.5 py-1">
              <BadgeCheck className="size-3.5" /> {t("shell.verified")}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <LangToggle />
            <ThemeToggle />
            <NotificationBell role={role} />
            <UserMenu name={user.name} avatarUrl={user.avatarUrl} role={role} onLogout={logout} />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl w-full flex flex-1">
        {/* Sidebar (desktop) */}
        <aside className="hidden lg:flex flex-col w-56 shrink-0 border-r py-6 pr-4 pl-2 gap-1 sticky top-14 h-[calc(100vh-3.5rem)]">
          {nav.map((n) => (
            <SidebarButton
              key={n.view}
              label={t(n.labelKey)}
              icon={n.icon}
              active={activeView === n.view ||
                (role === "OWNER" && ownerView === "booking-flow" && n.view === "explore") ||
                (role === "OWNER" && ownerView === "walk-live" && n.view === "bookings") ||
                (role === "WALKER" && walkerView === "walk-active" && n.view === "home")}
              onClick={() => useFiruSession.setState(
                role === "OWNER" ? { ownerView: n.view as never } : role === "WALKER" ? { walkerView: n.view as never } : { adminView: n.view as never }
              )}
            />
          ))}
          <div className="mt-auto text-xs text-muted-foreground px-3 leading-relaxed">
            {t("shell.demoNote")}
            <br />
            {t("shell.supportNote")}
          </div>
        </aside>

        {/* Main content */}
        <main className={cn("flex-1 min-w-0 px-4 pt-6 lg:pb-10", role === "ADMIN" ? "pb-40" : "pb-28")}>
          {currentView()}
        </main>
      </div>

      {/* Bottom nav (mobile) — iOS tab bar: glass material + spring pill indicator */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-50 firu-glass border-t border-border/50 pb-safe">
        {/* ADMIN has 6 destinations → two rows of 3 instead of a clipped 4-col grid */}
        <div
          className={cn(
            "grid max-w-lg mx-auto",
            role === "ADMIN" ? "grid-cols-3 h-28" : "grid-cols-4 h-16"
          )}
        >
          {nav.map((n) => {
            const isActive = activeView === n.view ||
              (role === "OWNER" && ownerView === "booking-flow" && n.view === "explore") ||
              (role === "OWNER" && ownerView === "walk-live" && n.view === "bookings") ||
              (role === "WALKER" && walkerView === "walk-active" && n.view === "home");
            return (
              <button
                key={n.view}
                onClick={() => useFiruSession.setState(
                  role === "OWNER" ? { ownerView: n.view as never } : role === "WALKER" ? { walkerView: n.view as never } : { adminView: n.view as never }
                )}
                className={cn(
                  "relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold transition-colors duration-200 ease-out-expo",
                  isActive ? "text-primary" : "text-muted-foreground active:text-foreground"
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="firu-nav-pill"
                    className="absolute inset-x-2 inset-y-1.5 rounded-2xl bg-brand-soft/80"
                    transition={springSnappy}
                    aria-hidden
                  />
                )}
                <motion.span
                  className="relative z-10 grid place-items-center"
                  initial={false}
                  animate={{ scale: isActive ? 1.1 : 1 }}
                  transition={springSnappy}
                >
                  <n.icon className="size-5" />
                </motion.span>
                <span className="relative z-10">{t(n.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function SidebarButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ElementType;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-full px-3 py-2.5 text-sm font-bold transition-[color,background-color,transform] duration-150 ease-out-expo active:scale-[0.97]",
        active
          ? "bg-brand-soft text-primary shadow-[inset_0_1px_0_oklch(1_0_0/0.25)]"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
      )}
    >
      <Icon className="size-4.5" />
      {label}
    </button>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const { t } = useT();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="rounded-full"
      aria-label={t("shell.themeToggle")}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      {mounted && theme === "dark" ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
    </Button>
  );
}

function NotificationBell({ role }: { role: string }) {
  const { t } = useT();
  const { data: notifications } = useQuery({
    queryKey: qk.notifications,
    queryFn: () => api.get<NotificationDTO[]>("/api/notifications"),
    refetchInterval: 20_000,
  });
  const qc = useQueryClient();
  const markAll = useMutation({
    mutationFn: () => api.patch("/api/notifications", { action: "read-all" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.notifications }),
  });
  const unread = (notifications ?? []).filter((n) => !n.read).length;

  const iconFor = (t: string) =>
    t === "WALK" ? Map : t === "PAYMENT" || t === "PAYOUT" ? CreditCard :
    t === "DISPUTE" ? ShieldAlert : t === "APPLICATION" ? ClipboardList :
    t === "REVIEW" ? BadgeCheck : PawPrint;

  return (
    <Popover
      onOpenChange={(open) => {
        if (open && unread > 0) markAll.mutate();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full relative" aria-label={t("shell.notifications")}>
          <Bell className="size-4.5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid place-items-center min-w-4 h-4 px-0.5 rounded-full bg-destructive text-[9px] font-black text-white">
              {unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-2xl p-0">
        <p className="font-extrabold text-sm px-4 py-3 border-b">
          {t("shell.notifications")}{role === "ADMIN" ? ` ${t("shell.notificationsOpsSuffix")}` : ""}
        </p>
        <div className="max-h-96 overflow-y-auto">
          {(notifications ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground p-4 text-center">
              {t("shell.allQuiet")}
            </p>
          )}
          {(notifications ?? []).map((n) => {
            const Icon = iconFor(n.type);
            return (
              <div key={n.id} className="flex gap-3 px-4 py-3 border-b last:border-0 hover:bg-secondary/50">
                <span className="grid place-items-center size-8 rounded-full bg-brand-soft text-primary shrink-0">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold leading-snug">{n.title}</p>
                  <p className="text-xs text-muted-foreground leading-snug mt-0.5">{n.body}</p>
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function UserMenu({
  name,
  avatarUrl,
  role,
  onLogout,
}: {
  name: string;
  avatarUrl?: string | null;
  role: string;
  onLogout: () => void;
}) {
  const { toast } = useToast();
  const { t } = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-full border py-0.5 pl-0.5 pr-2.5 hover:bg-secondary transition-colors">
          <img
            src={avatarUrl ?? "/images/brand/logo-mark-mint.png"}
            alt=""
            className="size-8 rounded-full object-cover"
          />
          <span className="hidden sm:block text-sm font-bold max-w-28 truncate">{name.split(" ")[0]}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rounded-2xl">
        <div className="px-3 py-2">
          <p className="font-bold text-sm">{name}</p>
          <p className="text-xs text-muted-foreground">
            {role === "OWNER" ? t("shell.role.owner") : role === "WALKER" ? t("shell.role.walker") : t("shell.role.admin")}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive font-semibold"
          onClick={() => {
            onLogout();
            toast({ title: t("shell.logoutToastTitle"), description: t("shell.logoutToastDesc") });
          }}
        >
          <LogOut className="size-4" /> {t("shell.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
