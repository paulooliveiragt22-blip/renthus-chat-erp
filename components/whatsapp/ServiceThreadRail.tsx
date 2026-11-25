"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

type Appointment = { id: string; offering_name: string; starts_at: string };
type CardRow = { id: string; title: string; label: string };

export function ServiceThreadRail({ threadId }: { threadId: string }) {
    const [loading, setLoading] = useState(true);
    const [agenda, setAgenda] = useState(false);
    const [casesOn, setCasesOn] = useState(false);
    const [nextAppointment, setNextAppointment] = useState<Appointment | null>(null);
    const [cases, setCases] = useState<CardRow[]>([]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetch(`/api/whatsapp/threads/${threadId}/service`, { credentials: "include", cache: "no-store" })
            .then(async (res) => {
                const json = (await res.json().catch(() => ({}))) as {
                    snapshot?: { attendance_mode?: string; profile?: { agenda_enabled?: boolean; cases_enabled?: boolean } | null };
                    appointments?: { rows?: Appointment[] };
                    cases?: { rows?: CardRow[] };
                };
                if (cancelled || !res.ok) return;
                const profile = json.snapshot?.profile;
                setAgenda(profile?.agenda_enabled === true);
                setCasesOn(profile?.cases_enabled === true);
                const appointments = json.appointments?.rows ?? [];
                setNextAppointment(appointments[0] ?? null);
                setCases(json.cases?.rows ?? []);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [threadId]);

    return (
        <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-hidden rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 max-md:hidden" aria-label="Atendimento do cliente">
            {loading ? <Skeleton className="h-24 w-full" /> : null}
            {agenda ? (
                <section>
                    <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Próximo horário</h2>
                    {nextAppointment ? (
                        <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">
                            {nextAppointment.offering_name} · {new Date(nextAppointment.starts_at).toLocaleString("pt-BR")}
                        </p>
                    ) : (
                        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Nenhum horário futuro.</p>
                    )}
                </section>
            ) : null}
            {casesOn ? (
                <section>
                    <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Cards abertos</h2>
                    <ul className="mt-1 flex flex-col gap-1">
                        {cases.length === 0 ? <li className="text-sm text-zinc-500 dark:text-zinc-400">Nenhum card aberto.</li> : null}
                        {cases.map((row) => (
                            <li key={row.id} className="truncate text-sm text-zinc-600 dark:text-zinc-300">
                                {row.title} · {row.label}
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}
        </aside>
    );
}
