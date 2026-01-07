// app/layout.tsx
import "@/styles/globals.css";
import React, { Suspense } from "react";
import AdminShell from "@/components/AdminShell";

export const metadata = {
  title: "Disk Bebidas - Admin",
  description: "Painel do Disk Bebidas",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>
        <header
          style={{
            padding: 16,
            borderBottom: "1px solid #eee",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontWeight: 700 }}>Disk Bebidas</div>
          <nav style={{ display: "flex", gap: 12 }}>
            <a href="/dashboard">Dashboard</a>
            <a href="/login">Sair</a>
          </nav>
        </header>

        {/* Suspense aqui evita o erro "useSearchParams() should be wrapped in a suspense boundary" */}
        <Suspense fallback={<div />}>
          <AdminShell>{children}</AdminShell>
        </Suspense>
      </body>
    </html>
  );
}
