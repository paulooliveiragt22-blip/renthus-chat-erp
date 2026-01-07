// app/layout.tsx
import "@/styles/globals.css";
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

        {/* AdminShell envolve as páginas (oculta em /login) */}
        <AdminShell>{children}</AdminShell>
      </body>
    </html>
  );
}
