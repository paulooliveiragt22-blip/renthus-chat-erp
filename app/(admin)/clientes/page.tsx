// app/(admin)/clientes/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import { Phone, Search, User, Users } from "lucide-react";

type Customer = {
    id: string;
    name: string | null;
    phone: string | null;
    address: string | null;
    created_at: string;
};

export default function ClientesPage() {
    const supabase = useMemo(() => createClient(), []);
    const { currentCompanyId: companyId } = useWorkspace();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [loading,   setLoading]   = useState(true);
    const [search,    setSearch]    = useState("");

    const load = useCallback(async () => {
        if (!companyId) return;
        setLoading(true);
        const { data } = await supabase
            .from("customers")
            .select("id, name, phone, address, created_at")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false })
            .limit(200);
        setCustomers((data as Customer[]) ?? []);
        setLoading(false);
    }, [companyId, supabase]);

    useEffect(() => { load(); }, [load]);

    const filtered = useMemo(() => {
        const q = search.toLowerCase();
        if (!q) return customers;
        return customers.filter((c) =>
            (c.name ?? "").toLowerCase().includes(q) ||
            (c.phone ?? "").includes(q)
        );
    }, [customers, search]);

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Clientes</h1>
                    <p className="mt-0.5 text-xs text-zinc-400">{customers.length} clientes cadastrados</p>
                </div>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Buscar por nome ou telefone…"
                        className="rounded-xl border border-zinc-200 bg-white py-2 pl-9 pr-4 text-sm text-zinc-800 placeholder-zinc-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 w-64"
                    />
                </div>
            </div>

            <div className="rounded-xl bg-white shadow-sm dark:bg-zinc-900 overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-20 text-zinc-400 text-sm">Carregando…</div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-20">
                        <Users className="h-10 w-10 text-zinc-300" />
                        <p className="text-sm text-zinc-400">{search ? "Nenhum resultado." : "Nenhum cliente ainda."}</p>
                    </div>
                ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {filtered.map((c) => (
                            <div key={c.id} className="flex items-center gap-4 px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/30">
                                    <User className="h-5 w-5 text-violet-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">{c.name ?? "—"}</p>
                                    {c.address && <p className="text-xs text-zinc-400 truncate">{c.address}</p>}
                                </div>
                                <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 shrink-0">
                                    <Phone className="h-3.5 w-3.5" />
                                    {c.phone ?? "—"}
                                </div>
                                <p className="text-xs text-zinc-400 shrink-0">
                                    {new Date(c.created_at).toLocaleDateString("pt-BR")}
                                </p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
