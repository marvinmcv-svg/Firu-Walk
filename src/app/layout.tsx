import type { Metadata, Viewport } from "next";
import { Nunito, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";

// Nunito: rounded, friendly — fits a warm consumer marketplace (Wag!/Rover vibe)
const nunito = Nunito({
  variable: "--font-app-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://firuwalk.bo"),
  title: "FiruWalk — Paseos de perros confiables en Santa Cruz",
  description:
    "Reserva paseos recurrentes con paseadores verificados en Santa Cruz de la Sierra. Seguimiento GPS en vivo, reportes con fotos y pago con QR. Tu perro merece un FiruWalk.",
  keywords: [
    "paseo de perros",
    "Santa Cruz de la Sierra",
    "Bolivia",
    "paseadores verificados",
    "FiruWalk",
  ],
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "FiruWalk",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/images/brand/favicon.png", type: "image/png" },
      { url: "/images/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/images/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/images/brand/apple-touch-icon.png",
  },
  openGraph: {
    title: "FiruWalk — Paseos felices, dueños tranquilos",
    description:
      "Empresa familiar de paseo de perros en Santa Cruz de la Sierra. Paseadores verificados, GPS en vivo, reportes con fotos y pago con QR.",
    images: [
      {
        url: "/images/brand/og.jpg",
        width: 1200,
        height: 630,
        alt: "FiruWalk — la manada paseando feliz",
      },
    ],
    type: "website",
    locale: "es_BO",
  },
  twitter: {
    card: "summary_large_image",
    title: "FiruWalk — Paseos felices, dueños tranquilos",
    description:
      "Empresa familiar de paseo de perros en Santa Cruz de la Sierra. 🐾",
    images: ["/images/brand/og.jpg"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // content flows under the notch; we pad with env(safe-area-*)
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF9F2" },
    { media: "(prefers-color-scheme: dark)", color: "#11150F" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-BO" suppressHydrationWarning>
      <body
        className={`${nunito.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
