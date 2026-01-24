// lib/workspace/useWorkspace.ts
"use client";

import { useEffect, useMemo, useState } from "react";

export type Company = {
    id: string;
    name: string;
};

export function useWorkspace() {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [currentCompanyId, setCurrentCompanyId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    async function load() {
        setLoading(true);

        // 1) workspace atual (cookie) - explicit credentials to ensure cookie is sent/received
        const cur = await fetch("/api/workspace/current", { cache: "no-store", credentials: "include" }).then((r) => r.json());
        setCurrentCompanyId(cur.company_id ?? null);

        // 2) lista de companies do usuário (backend seguro) - explicit credentials too
        const list = await fetch("/api/workspace/list", { cache: "no-store", credentials: "include" }).then((r) => r.json());
        setCompanies(list.companies ?? []);

        setLoading(false);
    }

    useEffect(() => {
        load().catch(() => setLoading(false));
    }, []);

    const currentCompany = useMemo(
        () => companies.find((c) => c.id === currentCompanyId) ?? null,
        [companies, currentCompanyId]
    );

    return { companies, currentCompanyId, currentCompany, loading, reload: load };
}
