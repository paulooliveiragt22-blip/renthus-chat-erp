"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { FAQ_ACTIVE_MAX, FAQ_ANSWER_MAX, FAQ_QUESTION_MAX, type ServiceFaqView } from "@/src/service/domain/faq";

type FaqRow = ServiceFaqView;

function messageFor(code: string): string {
    if (code === "faq_limit") return `O limite é ${FAQ_ACTIVE_MAX} dúvidas ativas.`;
    if (code === "faq_invalid") return "Escreva a pergunta e a resposta.";
    return "Não foi possível salvar.";
}

export function ServiceFaqPanel() {
    const [rows, setRows] = useState<FaqRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [question, setQuestion] = useState("");
    const [answer, setAnswer] = useState("");
    const [active, setActive] = useState(true);

    const load = useCallback(async () => {
        const res = await fetch("/api/admin/service/faqs", { credentials: "include" });
        const json = (await res.json().catch(() => null)) as { rows?: unknown } | null;
        const next = Array.isArray(json?.rows) ? json.rows.flatMap(readRow) : [];
        setRows(next);
        setLoading(false);
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void load();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [load]);

    function resetForm() {
        setEditingId(null);
        setQuestion("");
        setAnswer("");
        setActive(true);
    }

    async function save() {
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch("/api/admin/service/faqs", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: editingId,
                    question,
                    answer,
                    active,
                }),
            });
            const json = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
            if (!res.ok) {
                setMessage(messageFor(json.code ?? json.error ?? ""));
                return;
            }
            resetForm();
            setMessage("Dúvida salva.");
            await load();
        } finally {
            setSaving(false);
        }
    }

    async function remove(id: string) {
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch("/api/admin/service/faqs", {
                method: "DELETE",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id }),
            });
            const json = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
            if (!res.ok) {
                setMessage(messageFor(json.code ?? json.error ?? ""));
                return;
            }
            if (editingId === id) resetForm();
            setPendingDeleteId(null);
            setMessage("Dúvida apagada.");
            await load();
        } finally {
            setSaving(false);
        }
    }

    const activeCount = rows.filter((row) => row.active).length;

    return (
        <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800" aria-labelledby="service-faq-title">
            <div>
                <h2 id="service-faq-title" className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    Dúvidas
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    {`Escreva a pergunta e a resposta. O atendente usa as ativas. ${activeCount} de ${FAQ_ACTIVE_MAX}.`}
                </p>
            </div>

            {loading ? <p className="text-sm text-zinc-500 dark:text-zinc-400">Carregando dúvidas.</p> : null}

            {!loading && rows.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Nenhuma dúvida cadastrada.</p>
            ) : null}

            {rows.length > 0 ? (
                <ul className="flex flex-col gap-3">
                    {rows.map((row) => (
                        <li key={row.id} className="flex min-w-0 flex-col gap-2 border-b border-zinc-100 pb-3 last:border-b-0 dark:border-zinc-800">
                            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">{row.question}</p>
                            <p className="line-clamp-3 text-sm text-zinc-600 dark:text-zinc-300">{row.answer}</p>
                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        setEditingId(row.id);
                                        setQuestion(row.question);
                                        setAnswer(row.answer);
                                        setActive(row.active);
                                        setPendingDeleteId(null);
                                    }}
                                >
                                    Editar
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={saving}
                                    aria-label={pendingDeleteId === row.id ? `Confirmar exclusão de ${row.question}` : `Apagar ${row.question}`}
                                    onClick={() => {
                                        if (pendingDeleteId === row.id) {
                                            void remove(row.id);
                                            return;
                                        }
                                        setPendingDeleteId(row.id);
                                    }}
                                >
                                    {pendingDeleteId === row.id ? "Confirmar exclusão" : "Apagar"}
                                </Button>
                                {!row.active ? <span className="text-xs text-zinc-500 dark:text-zinc-400">Inativa</span> : null}
                            </div>
                        </li>
                    ))}
                </ul>
            ) : null}

            <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                }}
            >
                <label className="flex flex-col gap-1 text-sm text-zinc-800 dark:text-zinc-100" htmlFor="service-faq-question">
                    Pergunta
                    <input
                        id="service-faq-question"
                        value={question}
                        maxLength={FAQ_QUESTION_MAX}
                        onChange={(event) => setQuestion(event.target.value)}
                        className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground dark:bg-zinc-950"
                    />
                </label>
                <label className="flex flex-col gap-1 text-sm text-zinc-800 dark:text-zinc-100" htmlFor="service-faq-answer">
                    Resposta
                    <textarea
                        id="service-faq-answer"
                        value={answer}
                        maxLength={FAQ_ANSWER_MAX}
                        onChange={(event) => setAnswer(event.target.value)}
                        className="min-h-24 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground dark:bg-zinc-950"
                    />
                </label>
                <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-zinc-800 dark:text-zinc-100" id="service-faq-active-label">
                        Ativa
                    </span>
                    <Switch checked={active} onCheckedChange={setActive} aria-labelledby="service-faq-active-label" />
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={saving || question.trim().length === 0 || answer.trim().length === 0}>
                        {editingId ? "Salvar edição" : "Salvar dúvida"}
                    </Button>
                    {editingId ? (
                        <Button type="button" variant="outline" disabled={saving} onClick={resetForm}>
                            Cancelar
                        </Button>
                    ) : null}
                </div>
            </form>
            {message ? <p className="text-sm text-zinc-600 dark:text-zinc-300">{message}</p> : null}
        </section>
    );
}

function readRow(value: unknown): FaqRow[] {
    if (!value || typeof value !== "object") return [];
    const row = value as { id?: unknown; question?: unknown; answer?: unknown; active?: unknown };
    if (typeof row.id !== "string" || typeof row.question !== "string" || typeof row.answer !== "string") return [];
    return [{ id: row.id, question: row.question, answer: row.answer, active: row.active === true }];
}
