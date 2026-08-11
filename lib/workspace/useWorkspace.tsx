// lib/workspace/useWorkspace.tsx
"use client";

import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";

export type Company = {
    id: string;
    name: string;
};

type WorkspaceState = {
    companies: Company[];
    currentCompanyId: string | null;
    currentCompany: Company | null;
    loading: boolean;
    reload: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);

async function fetchWorkspace(): Promise<{ companies: Company[]; currentCompanyId: string | null }> {
    // As duas chamadas são independentes — buscar em paralelo corta a latência à metade
    // em vez de esperar uma terminar pra só então disparar a outra.
    const [curRes, listRes] = await Promise.all([
        fetch("/api/workspace/current", { cache: "no-store", credentials: "include" }),
        fetch("/api/workspace/list", { cache: "no-store", credentials: "include" }),
    ]);
    const [cur, list] = await Promise.all([
        curRes.json().catch(() => ({})),
        listRes.json().catch(() => ({})),
    ]);
    return {
        companies: list.companies ?? [],
        currentCompanyId: cur.company_id ?? null,
    };
}

/**
 * Fica montado no layout raiz do app (não remonta em navegação client-side), então o
 * fetch de workspace/companies roda uma única vez por sessão e é compartilhado por
 * header, sidebar, notifier e todas as páginas — em vez de cada uma repetir o mesmo
 * fetch a cada montagem/navegação (uma das causas da lentidão ao trocar de tela).
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [currentCompanyId, setCurrentCompanyId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    async function load() {
        setLoading(true);
        try {
            const { companies: c, currentCompanyId: id } = await fetchWorkspace();
            setCompanies(c);
            setCurrentCompanyId(id);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load().catch(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const currentCompany = useMemo(
        () => companies.find((c) => c.id === currentCompanyId) ?? null,
        [companies, currentCompanyId]
    );

    const value = useMemo<WorkspaceState>(
        () => ({ companies, currentCompanyId, currentCompany, loading, reload: load }),
        [companies, currentCompanyId, currentCompany, loading]
    );

    return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/**
 * Fallback: só busca de verdade se usado fora do WorkspaceProvider (não deveria
 * acontecer no app admin — existe pra não quebrar silenciosamente se algum dia
 * alguém consumir o hook fora da árvore do provider).
 */
function useStandaloneWorkspace(active: boolean): WorkspaceState {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [currentCompanyId, setCurrentCompanyId] = useState<string | null>(null);
    const [loading, setLoading] = useState(active);

    async function load() {
        if (!active) return;
        setLoading(true);
        try {
            const { companies: c, currentCompanyId: id } = await fetchWorkspace();
            setCompanies(c);
            setCurrentCompanyId(id);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (!active) return;
        load().catch(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active]);

    const currentCompany = useMemo(
        () => companies.find((c) => c.id === currentCompanyId) ?? null,
        [companies, currentCompanyId]
    );

    return { companies, currentCompanyId, currentCompany, loading, reload: load };
}

export function useWorkspace(): WorkspaceState {
    const ctx = useContext(WorkspaceContext);
    const standalone = useStandaloneWorkspace(ctx === null);
    return ctx ?? standalone;
}
