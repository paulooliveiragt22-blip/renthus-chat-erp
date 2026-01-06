/* app/layout.tsx */
import "@/styles/globals.css";
import ProdifySidebar from "@/components/ProdifySidebar";
import Header from "@/components/Header";

export const metadata = {
  title: "Disk Bebidas - Admin",
  description: "Painel do Disk Bebidas",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="true" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>

      <body className="antialiased" style={{ fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'Liberation Sans', sans-serif" }}>
        <Header />
        <div className="flex">
          <ProdifySidebar />
          <main className="flex-1 py-6">
            <div className="container-max">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
