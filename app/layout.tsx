// app/layout.tsx
import "./globals.css";
import React, { Suspense } from "react";
import AdminShell from "@/components/AdminShell";
import ThemeProvider from "@/components/ThemeProvider";
import { Providers } from "@/components/Providers";

export const metadata = {
  title: "RenthusAgent",
  description: "Painel de gestão RenthusAgent — pedidos, estoque e atendimento.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "RenthusAgent",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon-192.png?v=mark2", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png?v=mark2", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png?v=mark2",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#16364D",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <Providers>
            {/* Suspense aqui evita o erro "useSearchParams() should be wrapped in a suspense boundary" */}
            <Suspense fallback={<div />}>
              <AdminShell>{children}</AdminShell>
            </Suspense>
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
