"use client";

// FiruWalk client session — zustand store persisted to localStorage.
// This is only a UI cache of who is signed in: the real session is the
// httpOnly cookie, checked by the server on every API call.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Role, SessionUserDTO } from "./types";

export type OwnerView =
  | "home"
  | "explore"
  | "bookings"
  | "profile"
  | "booking-flow"
  | "walk-live"
  | "walker-detail";

export type WalkerView =
  | "home"
  | "availability"
  | "earnings"
  | "profile"
  | "walk-active";

export type AdminView =
  | "dashboard"
  | "applications"
  | "bookings"
  | "disputes"
  | "users"
  | "payments"
  | "config";

interface FiruState {
  user: SessionUserDTO | null;
  // navigation (per role)
  ownerView: OwnerView;
  walkerView: WalkerView;
  adminView: AdminView;
  // selection context
  activeWalkId: string | null;
  selectedWalkerUserId: string | null;
  selectedBookingId: string | null;
  bookingFlowSeed: {
    walkerUserId?: string;
    dogId?: string;
  } | null;
  // actions
  login: (user: SessionUserDTO) => void;
  /** Revoke the server session, then clear local state. */
  logout: () => void;
  /** Clear local state only (server already rejected the session). */
  clearLocal: () => void;
  setUser: (user: SessionUserDTO) => void;
  setOwnerView: (v: OwnerView) => void;
  setWalkerView: (v: WalkerView) => void;
  setAdminView: (v: AdminView) => void;
  openWalk: (walkId: string) => void;
  openWalker: (userId: string) => void;
  openBooking: (bookingId: string) => void;
  startBookingFlow: (seed?: { walkerUserId?: string; dogId?: string }) => void;
}

export const useFiruSession = create<FiruState>()(
  persist(
    (set) => ({
      user: null,
      ownerView: "home",
      walkerView: "home",
      adminView: "dashboard",
      activeWalkId: null,
      selectedWalkerUserId: null,
      selectedBookingId: null,
      bookingFlowSeed: null,
      login: (user) =>
        set({
          user,
          ownerView: "home",
          walkerView: "home",
          adminView: "dashboard",
        }),
      logout: () => {
        void fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
        set({
          user: null,
          activeWalkId: null,
          selectedWalkerUserId: null,
          selectedBookingId: null,
          bookingFlowSeed: null,
        });
      },
      clearLocal: () =>
        set({
          user: null,
          activeWalkId: null,
          selectedWalkerUserId: null,
          selectedBookingId: null,
          bookingFlowSeed: null,
        }),
      setUser: (user) => set({ user }),
      setOwnerView: (v) => set({ ownerView: v }),
      setWalkerView: (v) => set({ walkerView: v }),
      setAdminView: (v) => set({ adminView: v }),
      openWalk: (walkId) =>
        set({ activeWalkId: walkId, ownerView: "walk-live" }),
      openWalker: (userId) =>
        set({ selectedWalkerUserId: userId, ownerView: "walker-detail" }),
      openBooking: (bookingId) =>
        set({ selectedBookingId: bookingId, ownerView: "bookings" }),
      startBookingFlow: (seed) =>
        set({ bookingFlowSeed: seed ?? null, ownerView: "booking-flow" }),
    }),
    {
      name: "firuwalk-session",
      partialize: (s) => ({ user: s.user }),
    }
  )
);

export function currentRole(s: FiruState): Role | null {
  return s.user?.role ?? null;
}
