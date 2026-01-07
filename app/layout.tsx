// app/layout.tsx
import "@/styles/globals.css";
import React, { Suspense } from "react";
import AdminShell from "@/components/AdminShell";
import HeaderClient from "@/components/HeaderClient";

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
    <html lang="pt-BR">
      <body>
        {/* Header (client) — o componente HeaderClient decide se mostra ou não */}
        <HeaderClient />

        {/* Suspense aqui evita o erro "useSearchParams() should be wrapped in a suspense boundary" */}
        <Suspense fallback={<div />}>
          <AdminShell>{children}</AdminShell>
        </Suspense>
      </body>
    </html>
  );
}
