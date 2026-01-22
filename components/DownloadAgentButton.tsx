// components/DownloadAgentButton.tsx
"use client";

import React from "react";

export default function DownloadAgentButton() {
    const [loading, setLoading] = React.useState(false);

    const handleClick = () => {
        setLoading(true);
        // abrir em nova aba para manter a página, o browser fará o download do zip
        window.open("/api/print/download-agent", "_blank");
        // pequena espera para voltar estado (UX)
        setTimeout(() => setLoading(false), 1500);
    };

    return (
        <button
            onClick={handleClick}
            disabled={loading}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60"
        >
            {loading ? "Gerando..." : "Gerar chave e baixar Agente"}
        </button>
    );
}
