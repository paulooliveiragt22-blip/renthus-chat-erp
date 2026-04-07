"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export default function Modal({
    title,
    open,
    onClose,
    children,
    zClass = "z-[9999]",
}: Readonly<{
    title: string;
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
    /** Camadas empilhadas (ex.: confirmação sobre “Ver pedido”) precisam de z-index maior. */
    zClass?: string;
}>) {
    const [mounted, setMounted] = useState(false);
    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => setMounted(true), []);

    useEffect(() => {
        if (!open) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = prev;
        };
    }, [open]);

    // Só monta o <dialog> quando open — evita vários elementos modal no DOM com showModal() “preso”.
    useLayoutEffect(() => {
        if (!open || !mounted) return;
        const el = dialogRef.current;
        if (!el) return;
        if (!el.open) el.showModal();
        return () => {
            if (el.open) el.close();
        };
    }, [open, mounted]);

    if (!mounted || !open) return null;

    return createPortal(
        <dialog
            ref={dialogRef}
            className={`fixed left-1/2 top-1/2 ${zClass} flex max-h-[90vh] w-full max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl backdrop:bg-black/50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50`}
            onCancel={(e) => {
                e.preventDefault();
                onClose();
            }}
        >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
                <h3 className="line-clamp-1 text-sm font-bold text-zinc-900 dark:text-zinc-50">
                    {title}
                </h3>
                <button
                    type="button"
                    onClick={onClose}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>

            <div className="overflow-y-auto px-5 py-4 text-zinc-900 dark:text-zinc-50">{children}</div>
        </dialog>,
        document.body
    );
}
