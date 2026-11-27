"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { optionalCustomerAddress } from "@/lib/customers/optionalAddress";

type Props = {
    open: boolean;
    name: string;
    phone: string;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
};

const inputClass =
    "w-full rounded-md border border-zinc-200/80 bg-transparent px-2 py-1.5 text-sm outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-zinc-400 dark:border-zinc-800/80";

export function SaveCustomerDialog({ open, name, phone, onOpenChange, onSaved }: Props) {
    const uid = useId();
    const [draftName, setDraftName] = useState(name);
    const [draftPhone, setDraftPhone] = useState(phone);
    const [logradouro, setLogradouro] = useState("");
    const [numero, setNumero] = useState("");
    const [bairro, setBairro] = useState("");
    const [cidade, setCidade] = useState("");
    const [estado, setEstado] = useState("");
    const [cep, setCep] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const cepAbort = useRef<AbortController | null>(null);

    useEffect(() => {
        if (!open) return;
        setDraftName(name);
        setDraftPhone(phone);
        setLogradouro("");
        setNumero("");
        setBairro("");
        setCidade("");
        setEstado("");
        setCep("");
        setError(null);
    }, [open, name, phone]);

    async function lookupCep(value: string) {
        setCep(value);
        const digits = value.replaceAll(/\D/g, "");
        if (digits.length !== 8) return;
        cepAbort.current?.abort();
        const controller = new AbortController();
        cepAbort.current = controller;
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
            const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal: controller.signal });
            const data = (await res.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
            if (!data.erro) {
                setLogradouro(data.logradouro ?? "");
                setBairro(data.bairro ?? "");
                setCidade(data.localidade ?? "");
                setEstado(data.uf ?? "");
            }
        } catch {
            /* CEP continua editável */
        } finally {
            clearTimeout(timer);
        }
    }

    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const address = optionalCustomerAddress({ logradouro, numero, bairro, cidade, estado, cep });
        if (!address.ok) {
            setError("Complete o endereço ou deixe os campos em branco.");
            return;
        }
        setSaving(true);
        setError(null);
        const res = await fetch("/api/admin/customers", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: draftName.trim(),
                phone: draftPhone.trim(),
                ...(address.address ? { address: address.address } : {}),
            }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setSaving(false);
        if (!res.ok) {
            setError(json.error === "already_customer" ? "Este WhatsApp já está cadastrado." : "Não foi possível salvar o cliente.");
            return;
        }
        onOpenChange(false);
        onSaved();
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85dvh] overflow-y-auto border-zinc-200/80 dark:border-zinc-800/80">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <UserPlus className="h-4 w-4" aria-hidden />
                        Salvar cliente
                    </DialogTitle>
                    <DialogDescription>
                        O nome e o WhatsApp vieram da conversa. O endereço é opcional.
                    </DialogDescription>
                </DialogHeader>
                <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
                    <label className="flex flex-col gap-1 text-xs text-zinc-500" htmlFor={`${uid}-name`}>
                        Nome
                        <input id={`${uid}-name`} value={draftName} onChange={(event) => setDraftName(event.target.value)} required className={inputClass} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-zinc-500" htmlFor={`${uid}-phone`}>
                        WhatsApp
                        <input id={`${uid}-phone`} value={draftPhone} onChange={(event) => setDraftPhone(event.target.value)} required className={`${inputClass} font-mono tabular-nums`} />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                        <label className="flex flex-col gap-1 text-xs text-zinc-500" htmlFor={`${uid}-cep`}>
                            CEP
                            <input id={`${uid}-cep`} value={cep} onChange={(event) => void lookupCep(event.target.value)} inputMode="numeric" className={`${inputClass} font-mono tabular-nums`} />
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-zinc-500" htmlFor={`${uid}-num`}>
                            Número
                            <input id={`${uid}-num`} value={numero} onChange={(event) => setNumero(event.target.value)} className={inputClass} />
                        </label>
                        <label className="col-span-2 flex flex-col gap-1 text-xs text-zinc-500" htmlFor={`${uid}-log`}>
                            Logradouro
                            <input id={`${uid}-log`} value={logradouro} onChange={(event) => setLogradouro(event.target.value)} className={inputClass} />
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-zinc-500" htmlFor={`${uid}-bairro`}>
                            Bairro
                            <input id={`${uid}-bairro`} value={bairro} onChange={(event) => setBairro(event.target.value)} className={inputClass} />
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-zinc-500" htmlFor={`${uid}-cidade`}>
                            Cidade
                            <input id={`${uid}-cidade`} value={cidade} onChange={(event) => setCidade(event.target.value)} className={inputClass} />
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-zinc-500" htmlFor={`${uid}-uf`}>
                            UF
                            <input id={`${uid}-uf`} value={estado} maxLength={2} onChange={(event) => setEstado(event.target.value.toUpperCase())} className={`${inputClass} font-mono uppercase`} />
                        </label>
                    </div>
                    {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
                    <Button type="submit" size="sm" disabled={saving || draftName.trim().length === 0 || draftPhone.trim().length < 8}>
                        {saving ? "Salvando…" : "Salvar cliente"}
                    </Button>
                </form>
            </DialogContent>
        </Dialog>
    );
}
