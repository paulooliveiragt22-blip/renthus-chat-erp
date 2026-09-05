"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export function WorkspaceSwitcher() {
    const router = useRouter();
    const { companies, currentCompanyId, loading, reload } = useWorkspace();
    const [saving, setSaving] = useState(false);

    async function onChangeCompany(companyId: string) {
        if (!companyId || companyId === currentCompanyId) return;
        setSaving(true);

        try {
            const res = await fetch("/api/workspace/select", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ company_id: companyId }),
            });

            if (!res.ok) {
                const err = (await res.json().catch(() => ({}))) as { error?: string };
                toast.error(err?.error ?? "Falha ao trocar workspace");
                return;
            }

            try {
                await reload();
            } catch (e) {
                console.warn("reload workspace after select failed", e);
            }

            try {
                router.refresh();
            } catch {
                /* ignore */
            }

            const name = companies.find((c) => c.id === companyId)?.name;
            toast.success(name ? `Empresa: ${name}` : "Workspace atualizado");
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return (
            <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-14" />
                <Skeleton className="h-9 w-40" />
            </div>
        );
    }

    if (!companies.length) {
        return (
            <p className="text-xs text-foreground-muted">Nenhuma empresa disponível</p>
        );
    }

    return (
        <div className="flex items-center gap-2">
            <label htmlFor="workspace-switcher" className="shrink-0 text-xs text-foreground-muted">
                Empresa
            </label>
            <Select
                value={currentCompanyId ?? undefined}
                onValueChange={(v) => void onChangeCompany(v)}
                disabled={saving}
            >
                <SelectTrigger
                    id="workspace-switcher"
                    className="h-9 min-w-[10rem] max-w-[16rem]"
                    aria-label="Trocar empresa"
                >
                    <SelectValue placeholder="Selecione…" />
                </SelectTrigger>
                <SelectContent>
                    {companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                            <span className="truncate">{c.name}</span>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {saving ? (
                <span className="text-xs text-foreground-muted">Salvando…</span>
            ) : null}
        </div>
    );
}
