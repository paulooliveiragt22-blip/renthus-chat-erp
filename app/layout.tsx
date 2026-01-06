import "@/styles/globals.css";
import GlobalMenu from "@/components/GlobalMenu";

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
        <GlobalMenu />
        {children}
      </body>
    </html>
  );
}
