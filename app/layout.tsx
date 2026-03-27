// app/layout.tsx
import "./globals.css";
import React, { Suspense } from "react";
import AdminShell from "@/components/AdminShell";
import HeaderClient from "@/components/HeaderClient";
import ThemeProvider from "@/components/ThemeProvider";
import { Providers } from "@/components/Providers";

export const metadata = {
  title: "Renthus ERP",
  description: "Painel de gestão Renthus — pedidos, estoque e atendimento.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Renthus",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#6d28d9",
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
            {/* Header (client) — o componente HeaderClient decide se mostra ou não */}
            <HeaderClient />

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
