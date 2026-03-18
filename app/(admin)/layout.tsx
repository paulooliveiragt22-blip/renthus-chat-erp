// app/(admin)/layout.tsx
import AdminSidebar from "@/components/AdminSidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex min-h-screen bg-zinc-950 text-zinc-50">
            <AdminSidebar />
            <main className="flex-1 bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900/95">
                <div className="mx-auto w-full max-w-6xl px-3 py-4 md:px-6 md:py-6">
                    {children}
                </div>
            </main>
        </div>
    );
}
