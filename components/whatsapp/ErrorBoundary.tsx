"use client";

import React from "react";

interface Props {
    children: React.ReactNode;
    fallback?: React.ReactNode;
}
interface State {
    hasError: boolean;
    message: string;
}

export class WhatsAppErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, message: "" };
    }

    static getDerivedStateFromError(error: unknown): State {
        return { hasError: true, message: error instanceof Error ? error.message : String(error) };
    }

    componentDidCatch(error: unknown, info: React.ErrorInfo) {
        console.error("[WhatsAppErrorBoundary]", error, info.componentStack);
    }

    render() {
        if (this.state.hasError) {
            return this.props.fallback ?? (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                    <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                        Ocorreu um erro inesperado no módulo WhatsApp.
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{this.state.message}</p>
                    <button
                        onClick={() => this.setState({ hasError: false, message: "" })}
                        className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                        Tentar novamente
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
