import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  // Standalone output powers the Docker image; Vercel ignores it.
  output: "standalone",
  // No floating dev badge — it intercepts touch events on mobile and breaks
  // the "installed app" illusion of the premium demo.
  devIndicators: false,
  reactStrictMode: false,
};

// Source maps are only uploaded when SENTRY_AUTH_TOKEN/ORG/PROJECT are set
// (e.g. in Vercel). Without them the build still succeeds.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
});
