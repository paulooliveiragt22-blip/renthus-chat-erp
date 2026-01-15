"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function Modal({
    title,
    open,
    onClose,
    children,
}: {
    title: string;
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
}) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => setMounted(true), []);

    useEffect(() => {
        if (!open) return;

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);

        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        return () => {
            window.removeEventListener("keydown", onKey);
            document.body.style.overflow = prev;
        };
    }, [open, onClose]);

    if (!open || !mounted) return null;

    return createPortal(
        <div
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.45)",
                display: "grid",
                placeItems: "center",
                padding: 12,
                zIndex: 9999,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: "min(1080px, 100%)",
                    background: "#fff",
                    borderRadius: 12,
                    border: "1px solid #ddd",
                    padding: 12,
                    maxHeight: "90vh",
                    overflow: "auto",
                    boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
                }}
            >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>{title}</h3>
                    <button
                        onClick={onClose}
                        style={{
                            border: "1px solid #ccc",
                            borderRadius: 10,
                            padding: "6px 10px",
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 900,
                        }}
                    >
                        Fechar
                    </button>
                </div>

                <div style={{ marginTop: 10 }}>{children}</div>
            </div>
        </div>,
        document.body
    );
}
