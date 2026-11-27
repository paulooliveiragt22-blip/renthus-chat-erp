"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { FAQ_ACTIVE_MAX, FAQ_ANSWER_MAX, FAQ_QUESTION_MAX, type ServiceFaqView } from "@/src/service/domain/faq";

type FaqRow = ServiceFaqView;

function messageFor(code: string): string {
    if (code === "faq_limit") return `O limite é ${FAQ_ACTIVE_MAX} dúvidas ativas. Desative uma para incluir outra.`;
    if (code === "faq_invalid") return "Escreva a pergunta e a resposta.";
    return "Não foi possível salvar.";
}

export function ServiceFaqPanel() {
    const [rows, setRows] = useState<FaqRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
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

    function openCreate() {
        resetForm();
        setMessage(null);
        setOpen(true);
    }

    function openEdit(row: FaqRow) {
        setEditingId(row.id);
        setQuestion(row.question);
        setAnswer(row.answer);
        setActive(row.active);
        setPendingDeleteId(null);
        setMessage(null);
        setOpen(true);
    }

    async function persist(body: { id: string | null; question: string; answer: string; active: boolean }) {
        const res = await fetch("/api/admin/service/faqs", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
        if (!res.ok) return messageFor(json.code ?? json.error ?? "");
        return null;
    }

    async function save() {
        setSaving(true);
        setMessage(null);
        try {
            const error = await persist({ id: editingId, question, answer, active });
            if (error) {
                setMessage(error);
                return;
            }
            const added = editingId === null;
            setOpen(false);
            resetForm();
            setMessage(added ? "Dúvida adicionada à lista. Você pode incluir outra." : "Dúvida atualizada.");
            await load();
        } finally {
            setSaving(false);
        }
    }

    async function toggleActive(row: FaqRow, next: boolean) {
        setSaving(true);
        setMessage(null);
        try {
            const error = await persist({
                id: row.id,
                question: row.question,
                answer: row.answer,
                active: next,
            });
            if (error) {
                setMessage(error);
                return;
            }
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
            setPendingDeleteId(null);
            setMessage("Dúvida retirada da lista.");
            await load();
        } finally {
            setSaving(false);
        }
    }

    const activeCount = rows.filter((row) => row.active).length;
    const atLimit = activeCount >= FAQ_ACTIVE_MAX;

    return (
        <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800" aria-labelledby="service-faq-title">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 id="service-faq-title" className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        Dúvidas
                    </h2>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        {`Cada item é uma pergunta com a resposta do atendente. Dá para cadastrar várias. ${activeCount} ativas de ${FAQ_ACTIVE_MAX}.`}
                    </p>
                </div>
                <Button type="button" onClick={openCreate} disabled={atLimit}>
                    Adicionar dúvida
                </Button>
            </div>

            {loading ? <p className="text-sm text-zinc-500 dark:text-zinc-400">Carregando a lista.</p> : null}

            {!loading && rows.length === 0 ? (
                <p className="rounded-lg bg-zinc-50 px-3 py-4 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                    A lista está vazia. Use Adicionar dúvida. Cada salvamento cria um item novo e não substitui os anteriores.
                </p>
            ) : null}

            {rows.length > 0 ? (
                <ol className="flex flex-col gap-3">
                    {rows.map((row, index) => (
                        <li key={row.id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">{`Dúvida ${index + 1}`}</p>
                            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">{row.question}</p>
                            <p className="line-clamp-3 text-sm text-zinc-600 dark:text-zinc-300">{row.answer}</p>
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="mr-auto flex items-center gap-2">
                                    <Switch
                                        checked={row.active}
                                        disabled={saving || (!row.active && atLimit)}
                                        onCheckedChange={(next) => void toggleActive(row, next)}
                                        aria-label={row.active ? `Desativar ${row.question}` : `Ativar ${row.question}`}
                                    />
                                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                        {row.active ? "O atendente usa" : "Fora do atendimento"}
                                    </span>
                                </div>
                                <Button type="button" variant="outline" size="sm" onClick={() => openEdit(row)}>
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
                            </div>
                        </li>
                    ))}
                </ol>
            ) : null}

            {atLimit ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    {`As ${FAQ_ACTIVE_MAX} vagas ativas estão ocupadas. Desative uma dúvida para adicionar outra.`}
                </p>
            ) : null}
            {message ? <p className="text-sm text-zinc-600 dark:text-zinc-300">{message}</p> : null}

            <Dialog
                open={open}
                onOpenChange={(next) => {
                    setOpen(next);
                    if (!next) resetForm();
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingId ? "Editar esta dúvida" : "Nova dúvida"}</DialogTitle>
                        <DialogDescription>
                            {editingId
                                ? "A alteração vale só para este item. As outras dúvidas da lista continuam."
                                : "Ela entra na lista junto com as outras. Não substitui o que já está cadastrado."}
                        </DialogDescription>
                    </DialogHeader>
                    <form
                        className="flex flex-col gap-3"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void save();
                        }}
                    >
                        <label className="flex flex-col gap-1 text-sm text-zinc-800 dark:text-zinc-100" htmlFor="service-faq-question">
                            Pergunta do cliente
                            <input
                                id="service-faq-question"
                                value={question}
                                maxLength={FAQ_QUESTION_MAX}
                                placeholder="Ex.: Vocês têm estacionamento?"
                                onChange={(event) => setQuestion(event.target.value)}
                                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground dark:bg-zinc-950"
                            />
                        </label>
                        <label className="flex flex-col gap-1 text-sm text-zinc-800 dark:text-zinc-100" htmlFor="service-faq-answer">
                            Resposta do atendente
                            <textarea
                                id="service-faq-answer"
                                value={answer}
                                maxLength={FAQ_ANSWER_MAX}
                                placeholder="Ex.: Sim, é grátis na frente da loja."
                                onChange={(event) => setAnswer(event.target.value)}
                                className="min-h-24 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground dark:bg-zinc-950"
                            />
                        </label>
                        <div className="flex items-center justify-between gap-4">
                            <span className="text-sm text-zinc-800 dark:text-zinc-100" id="service-faq-active-label">
                                O atendente pode usar esta
                            </span>
                            <Switch checked={active} onCheckedChange={setActive} aria-labelledby="service-faq-active-label" />
                        </div>
                        {message && open ? <p className="text-sm text-zinc-600 dark:text-zinc-300">{message}</p> : null}
                        <DialogFooter>
                            <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={saving || question.trim().length === 0 || answer.trim().length === 0}>
                                {editingId ? "Salvar alteração" : "Adicionar à lista"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </section>
    );
}

function readRow(value: unknown): FaqRow[] {
    if (!value || typeof value !== "object") return [];
    const row = value as { id?: unknown; question?: unknown; answer?: unknown; active?: unknown };
    if (typeof row.id !== "string" || typeof row.question !== "string" || typeof row.answer !== "string") return [];
    return [{ id: row.id, question: row.question, answer: row.answer, active: row.active === true }];
}
