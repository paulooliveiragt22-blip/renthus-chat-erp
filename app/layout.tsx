// app/layout.tsx
import "./globals.css";
import React, { Suspense } from "react";
import AdminShell from "@/components/AdminShell";
import HeaderClient from "@/components/HeaderClient";
import ThemeProvider from "@/components/ThemeProvider";

export const metadata = {
  title: "Renthus - Admin",
  description: "Painel Renthus Service",
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
          {/* Header (client) — o componente HeaderClient decide se mostra ou não */}
          <HeaderClient />

          {/* Suspense aqui evita o erro "useSearchParams() should be wrapped in a suspense boundary" */}
          <Suspense fallback={<div />}>
            <AdminShell>{children}</AdminShell>
          </Suspense>
        </ThemeProvider>
      </body>
    </html>
  );
}
