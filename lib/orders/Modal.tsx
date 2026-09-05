"use client";

import React from "react";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Modal de domínio (pedidos / WhatsApp) — Radix Dialog (ADR-0009 Onda B).
 * API estável: title / open / onClose / children / zClass.
 */
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
    /** Camadas empilhadas (confirmação sobre “Ver pedido”). */
    zClass?: string;
}>) {
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
        >
            <DialogContent
                hideClose
                overlayClassName={zClass}
                className={cn(
                    "flex max-h-[90vh] w-full max-w-4xl flex-col gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl",
                    zClass
                )}
                aria-describedby={undefined}
            >
                <DialogHeader className="flex shrink-0 flex-row items-center justify-between space-y-0 border-b border-border px-5 py-4 pr-14 text-left">
                    <DialogTitle className="line-clamp-1 text-sm font-bold">
                        {title}
                    </DialogTitle>
                    <DialogClose asChild>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="absolute right-4 top-3 h-7 w-7"
                            aria-label="Fechar"
                        >
                            <X className="h-3.5 w-3.5" />
                        </Button>
                    </DialogClose>
                </DialogHeader>
                <div className="overflow-y-auto px-5 py-4 text-foreground">{children}</div>
            </DialogContent>
        </Dialog>
    );
}
