// app/layout.tsx
import "./globals.css";
import React, { Suspense } from "react";
import { headers } from "next/headers";
import AdminShell from "@/components/AdminShell";
import ThemeProvider from "@/components/ThemeProvider";
import { Providers } from "@/components/Providers";
import { X_NONCE_HEADER } from "@/lib/security/cspPolicy";

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
      { url: "/favicon.ico?v=mark7", sizes: "any" },
      { url: "/icons/icon-192.png?v=mark7", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png?v=mark7", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png?v=mark7",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#16364D",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Next lê x-nonce + CSP do request (proxy) e aplica nos scripts do runtime.
  // headers() força render dinâmico — nonce não pode ser estático.
  const nonce = (await headers()).get(X_NONCE_HEADER);

  return (
    <html lang="pt-BR" suppressHydrationWarning data-csp-nonce={nonce ?? undefined}>
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
