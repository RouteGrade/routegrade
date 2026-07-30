import type { Metadata, Viewport } from "next";
import { Archivo, Inter } from "next/font/google";
import { NativeAuthListener } from "@/components/auth/native-auth-listener";
import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker-registrar";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Display face for grades, distances and pace. Archivo holds up at 80px+ in
// heavy weights and its tabular figures don't jitter as a run metric ticks.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

// viewport-fit=cover lets the map extend behind notches/home indicator;
// safe-area insets in the shell keep the tab bar and controls clear of them.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export const metadata: Metadata = {
  title: "RouteGrade — Run routes, graded",
  description:
    "RouteGrade scores running routes for safety, comfort, and scenery so you can find your best run.",
  applicationName: "RouteGrade",
  manifest: "/manifest.webmanifest",
  // iOS reads none of the manifest's display settings on older versions and
  // still prefers apple-touch-icon for the home screen, so the standalone
  // frame has to be asked for explicitly here.
  appleWebApp: {
    capable: true,
    title: "RouteGrade",
    // black-translucent, not default: the map is already drawn behind the
    // notch via viewportFit: "cover", and an opaque bar would band the top.
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-180.png",
  },
  // The map and run screen own every gesture; leaving detection on turns
  // distances and coordinates in run summaries into tappable phone links.
  formatDetection: { telephone: false, address: false, date: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${archivo.variable} h-full antialiased`}
    >
      <body className="h-full bg-canvas font-sans text-ink">
        {children}
        <ServiceWorkerRegistrar />
        <NativeAuthListener />
      </body>
    </html>
  );
}
