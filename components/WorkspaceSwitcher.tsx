// components/WorkspaceSwitcher.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useWorkspace } from "@/lib/workspace/useWorkspace";

export function WorkspaceSwitcher() {
    const router = useRouter();
    const { companies, currentCompanyId, loading, reload } = useWorkspace();
    const [saving, setSaving] = useState(false);

    async function onChangeCompany(companyId: string) {
        setSaving(true);

        const res = await fetch("/api/workspace/select", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include", // <<-- importante
            body: JSON.stringify({ company_id: companyId }),
        });

        setSaving(false);

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err?.error ?? "Falha ao trocar workspace");
            return;
        }

        // reload the client hook first so currentCompanyId updates
        // then refresh server components so they read the new cookie.
        try {
            await reload();
        } catch (e) {
            console.warn("reload workspace after select failed", e);
        }

        try {
            router.refresh();
        } catch (e) {
            // router.refresh may fail in some envs; ignore
        }
    }

    if (loading) {
        return (
            <div style={{ fontSize: 12, opacity: 0.8 }}>
                Carregando empresa...
            </div>
        );
    }

    if (!companies.length) {
        return (
            <div style={{ fontSize: 12, opacity: 0.8 }}>
                Nenhuma empresa disponível
            </div>
        );
    }

    return (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ fontSize: 12, opacity: 0.8 }}>Empresa</label>

            <select
                value={currentCompanyId ?? ""}
                onChange={(e) => onChangeCompany(e.target.value)}
                disabled={saving}
                style={{ padding: "6px 8px" }}
            >
                <option value="" disabled>
                    Selecione...
                </option>

                {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                        {c.name}
                    </option>
                ))}
            </select>

            {saving ? <span style={{ fontSize: 12, opacity: 0.8 }}>Salvando...</span> : null}
        </div>
    );
}
