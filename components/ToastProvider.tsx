"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

type ToastVariant = "success" | "error" | "info";

type Toast = {
    id: number;
    message: string;
    variant: ToastVariant;
    actionLabel?: string;
    onAction?: () => void;
};

type ToastContextValue = {
    showToast: (toast: Omit<Toast, "id">) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const removeToast = useCallback((id: number) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, []);

    const showToast = useCallback(
        (toast: Omit<Toast, "id">) => {
            const id = Date.now();
            setToasts((prev) => [...prev, { ...toast, id }]);

            // auto dismiss after 6s
            setTimeout(() => removeToast(id), 6000);
        },
        [removeToast]
    );

    const value = useMemo(() => ({ showToast }), [showToast]);

    return (
        <ToastContext.Provider value={value}>
            {children}
            <div
                aria-live="assertive"
                style={{
                    position: "fixed",
                    top: 16,
                    right: 16,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    zIndex: 50,
                    maxWidth: 360,
                }}
            >
                {toasts.map((toast) => {
                    const background =
                        toast.variant === "success"
                            ? "rgba(18, 146, 64, 0.1)"
                            : toast.variant === "error"
                              ? "rgba(220, 38, 38, 0.12)"
                              : "rgba(59, 36, 107, 0.1)";

                    return (
                        <div
                            key={toast.id}
                            role="alert"
                            style={{
                                background,
                                border: "1px solid rgba(0,0,0,0.06)",
                                borderRadius: 12,
                                padding: "12px 14px",
                                boxShadow: "0 10px 24px rgba(0,0,0,0.08)",
                                display: "flex",
                                gap: 10,
                                alignItems: "center",
                                justifyContent: "space-between",
                            }}
                        >
                            <div style={{ flex: 1 }}>{toast.message}</div>
                            {toast.actionLabel ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        toast.onAction?.();
                                        removeToast(toast.id);
                                    }}
                                    style={{
                                        background: "transparent",
                                        border: "none",
                                        color: "#3B246B",
                                        fontWeight: 700,
                                        cursor: "pointer",
                                    }}
                                >
                                    {toast.actionLabel}
                                </button>
                            ) : null}
                            <button
                                aria-label="Fechar toast"
                                type="button"
                                onClick={() => removeToast(toast.id)}
                                style={{
                                    border: "none",
                                    background: "transparent",
                                    cursor: "pointer",
                                    color: "#555",
                                    fontWeight: 700,
                                }}
                            >
                                ×
                            </button>
                        </div>
                    );
                })}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error("useToast deve ser usado dentro de um ToastProvider");
    return ctx;
}
