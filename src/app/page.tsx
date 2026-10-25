"use client";

// FiruWalk — single-page marketplace app (owner / walker / admin).
// All navigation happens client-side via the session store; only route is "/".

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFiruSession } from "@/lib/firu/session";
import { useLangStore } from "@/lib/firu/i18n";
import { AppShell } from "@/components/firu/shell/AppShell";
import { LandingScreen } from "@/components/firu/shell/LandingScreen";
import { IntroSplash } from "@/components/firu/shell/IntroSplash";
import { FirulAI } from "@/components/firu/shared/FirulAI";

function FiruApp() {
  const user = useFiruSession((s) => s.user);
  const [showLogin, setShowLogin] = useState(false);

  // Keep <html lang> in sync with the active UI language.
  useEffect(() => {
    document.documentElement.lang = useLangStore.getState().lang === "en" ? "en" : "es-BO";
    const unsub = useLangStore.subscribe(
      (s) => { document.documentElement.lang = s.lang === "en" ? "en" : "es-BO"; }
    );
    return unsub;
  }, []);

  if (!user) {
    return (
      <>
        <LandingScreen
          onLogin={() => setShowLogin(true)}
          initiallyShowLogin={showLogin}
        />
        {/* FirulAI after the screen so the mobile tab-bar z-50 tie resolves in our favor */}
        <FirulAI />
      </>
    );
  }
  return (
    <>
      <AppShell />
      <FirulAI />
    </>
  );
}

export default function Home() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/* Hyperframes-rendered intro splash — once per session, z-100 overlay */}
      <IntroSplash />
      <FiruApp />
    </QueryClientProvider>
  );
}
