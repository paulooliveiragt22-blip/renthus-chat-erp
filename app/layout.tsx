// app/layout.tsx
import "@/styles/globals.css";
import React, { Suspense } from "react";
import AdminShell from "@/components/AdminShell";

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
        <header
          style={{
            // header todo roxo
            backgroundColor: "#3B246B",
            color: "#fff",
            padding: "16px 24px",
            // sombra na parte inferior
            boxShadow: "0 6px 12px rgba(0,0,0,0.16)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {/* esquerda: retângulo para logo Renthus */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* Placeholder retangular -- troque por <img src='/assets/renthus-logo.png'/> quando tiver a logo */}
            <div
              style={{
                width: 220,
                height: 56,
                backgroundColor: "#fff",
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#3B246B",
                fontWeight: 700,
                // sutil borda para destacar
                boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
                overflow: "hidden",
              }}
            >
              {/* Texto temporário — substitua por <img /> */}
              Renthus Logo
            </div>
          </div>

          {/* direita: perfil da empresa */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            {/* Nome da empresa */}
            <div style={{ fontWeight: 600, fontSize: 16 }}>Renthus Service</div>

            {/* Avatar circular (pode ser a logo em tamanho reduzido) */}
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                backgroundColor: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#3B246B",
                fontWeight: 700,
                overflow: "hidden",
                boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
              }}
            >
              {/* aqui também você pode trocar por:
                  <img src="/assets/renthus-avatar.png" alt="Renthus" style={{width: '100%', height: '100%', objectFit: 'cover'}}/>
              */}
              R
            </div>
          </div>
        </header>

        {/* Suspense aqui evita o erro "useSearchParams() should be wrapped in a suspense boundary" */}
        <Suspense fallback={<div />}>
          <AdminShell>{children}</AdminShell>
        </Suspense>
      </body>
    </html>
  );
}
