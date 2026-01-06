// app/layout.tsx
import "@/styles/globals.css";
import Sidebar from "@/components/Sidebar";

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
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "row" }}>
          {/* Sidebar à esquerda */}
          <Sidebar />

          {/* Conteúdo à direita (header + main) */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
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

            <main style={{ flex: 1, minHeight: 0 }}>
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
