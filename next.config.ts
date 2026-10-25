import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Allow the sandbox preview proxy origin to access dev assets
  allowedDevOrigins: ["*.space-z.ai", "*.chat.z.ai"],
  // No floating dev badge — it intercepts touch events on mobile and breaks
  // the "installed app" illusion of the premium demo.
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
