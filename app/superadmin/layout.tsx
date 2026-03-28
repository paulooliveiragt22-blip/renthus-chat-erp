"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import SuperAdminSidebar from "@/components/superadmin/SuperAdminSidebar";

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
    const [sidebarOpen, setSidebarOpen] = useState(false);

    return (
        <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">
            {/* Overlay mobile */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 z-40 bg-black/50 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            <SuperAdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

            {/* Conteúdo principal */}
            <div className="flex min-h-screen flex-1 flex-col">
                {/* Header mobile */}
                <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900 lg:hidden">
                    <button
                        onClick={() => setSidebarOpen(true)}
                        aria-label="Abrir menu"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                        <Menu className="h-4 w-4" />
                    </button>
                    <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                        Super Admin
                    </span>
                </header>

                <main className="flex-1 p-4 lg:p-6">
                    {children}
                </main>
            </div>
        </div>
    );
}
