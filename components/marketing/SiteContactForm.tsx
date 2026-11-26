"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { normalizeVisitorPhone } from "@/src/service/domain/offeringSpeech";

const inputClass =
    "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50";

export function SiteContactForm({
    disabled,
    onSubmit,
    onReset,
}: {
    disabled: boolean;
    onSubmit: (text: string) => void;
    onReset: () => void;
}) {
    const [visitorName, setVisitorName] = useState("");
    const [phone, setPhone] = useState("");
    const [invalid, setInvalid] = useState(false);
    const nameId = "site-chat-contact-name";
    const phoneId = "site-chat-contact-phone";

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const name = visitorName.trim();
        const ready = name.length >= 2 && name.length <= 80 && normalizeVisitorPhone(phone) !== null;
        if (!ready) {
            setInvalid(true);
            return;
        }
        setInvalid(false);
        onSubmit(`${name} ${phone.trim()}`);
    }

    return (
        <form className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 dark:border-zinc-800" onSubmit={submit}>
            <div>
                <label htmlFor={nameId} className="text-sm font-medium text-slate-900 dark:text-zinc-50">Nome</label>
                <input
                    id={nameId}
                    name="name"
                    autoComplete="name"
                    required
                    minLength={2}
                    maxLength={80}
                    disabled={disabled}
                    value={visitorName}
                    aria-invalid={invalid && visitorName.trim().length < 2}
                    onChange={(event) => setVisitorName(event.target.value)}
                    className={inputClass}
                />
            </div>
            <div>
                <label htmlFor={phoneId} className="text-sm font-medium text-slate-900 dark:text-zinc-50">WhatsApp</label>
                <input
                    id={phoneId}
                    name="tel"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    required
                    placeholder="(65) 99999-8888"
                    disabled={disabled}
                    value={phone}
                    aria-invalid={invalid && normalizeVisitorPhone(phone) === null}
                    onChange={(event) => setPhone(event.target.value)}
                    className={inputClass}
                />
            </div>
            {invalid ? (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                    Informe o nome e um WhatsApp com DDD.
                </p>
            ) : null}
            <div className="flex items-center justify-between gap-2">
                <button type="button" className="text-sm text-slate-500 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:text-zinc-400" onClick={onReset}>
                    Nova conversa
                </button>
                <Button type="submit" disabled={disabled}>
                    {disabled ? "Enviando" : "Enviar"}
                </Button>
            </div>
        </form>
    );
}
