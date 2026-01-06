import "@/styles/globals.css";
import AdminSidebar from "@/components/AdminSidebar";

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
      <body style={{ background: "#f2f2f4", margin: 0, minHeight: "100vh" }}>
        <header
          style={{
            padding: 12,
            borderBottom: "1px solid #eee",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Ã­cone / marca */}
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "#3B246B" }} />
            <div style={{ fontWeight: 700 }}>Disk Bebidas</div>
          </div>

          {/* Nav removida (Dashboard / Sair migrados para a sidebar) */}
          <div />
        </header>
        {children}
      </body>
    </html>
  );
}
