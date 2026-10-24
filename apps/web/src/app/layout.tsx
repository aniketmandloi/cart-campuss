import type { Metadata } from "next";
import localFont from "next/font/local";

import "../index.css";
import Header from "@/components/header";
import Providers from "@/components/providers";

const inter = localFont({
  src: "../fonts/InterVariable.woff2",
  variable: "--font-inter",
  display: "swap",
  weight: "100 900",
  fallback: ["sans-serif"],
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: {
    default: "Cart Campuss",
    template: "%s · Cart Campuss",
  },
  description: "Find a car and read its sourced details.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} dark`}>
      <body className="antialiased">
        <Providers>
          <div className="flex min-h-svh flex-col">
            <a className="skip-link" href="#catalogue">
              Skip to catalogue
            </a>
            <Header />
            <div className="flex-1">{children}</div>
            <footer className="mx-auto flex w-full max-w-[1120px] flex-col gap-1 border-t border-border px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <a href="/fonts/Inter-OFL.txt" className="link-draw inline-flex min-h-11 items-center hover:text-foreground">
                Inter typeface, SIL Open Font License 1.1
              </a>
              <p>Copyright 2020 The Inter Project Authors.</p>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
