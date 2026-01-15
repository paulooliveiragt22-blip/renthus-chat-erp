// app/(admin)/layout.tsx
export default function AdminLayout({ children }: { children: React.ReactNode }) {
    // O AdminSidebar e o AdminOrdersProvider estão no AdminShell (root),
    // então aqui deixamos apenas o contêiner dos conteúdos da área admin.
    return <div style={{ padding: 14 }}>{children}</div>;
}
