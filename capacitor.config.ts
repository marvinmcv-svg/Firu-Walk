// Capacitor shell for the WALKER app (Android first, iOS later). The owner
// side stays a PWA.
//
// The native app loads the deployed web app (server.url) so walkers always
// run the current version; Capacitor injects its bridge so the web code can
// use native plugins — here @capacitor-community/background-geolocation,
// which keeps GPS running with the screen locked (foreground service with a
// persistent notification). See docs/WALKER_APP.md.
//
// CAP_SERVER_URL is read when running `bunx cap sync`/`cap run`:
//   production   https://<your production domain>
//   emulator     http://10.0.2.2:3000 (default — the host's `bun run dev`)

import type { CapacitorConfig } from "@capacitor/cli";

const serverUrl = process.env.CAP_SERVER_URL ?? "http://10.0.2.2:3000";

const config: CapacitorConfig = {
  appId: "bo.firuwalk.walker",
  appName: "FiruWalk Paseador",
  // Offline fallback page bundled in the app (shown if server.url can't load).
  webDir: "capacitor/www",
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith("http://"),
    errorPath: "index.html",
  },
  android: {
    // Required by background-geolocation: otherwise updates stop after ~5 min
    // in the background (capacitor-community/background-geolocation#89).
    useLegacyBridge: true,
  },
  plugins: {
    // Native HTTP (used for GPS uploads in the background) shares the WebView's
    // cookie store, so the session cookie rides along.
    CapacitorCookies: { enabled: true },
  },
};

export default config;
