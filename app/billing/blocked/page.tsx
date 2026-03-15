"use client";

/**
 * /billing/blocked
 *
 * Página exibida quando a empresa está bloqueada por inadimplência.
 * O middleware redireciona automaticamente para cá quando
 * pagarme_subscriptions.status = 'blocked'.
 */

import { useEffect, useState } from "react";

export default function BillingBlockedPage() {
    const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
    const [amount, setAmount]         = useState<number | null>(null);
    const [loading, setLoading]       = useState(true);

    useEffect(() => {
        fetch("/api/billing/status")
            .then((r) => r.json())
            .then((data) => {
                setPaymentUrl(data?.pending_invoice?.pagarme_payment_url ?? null);
                setAmount(data?.pending_invoice?.amount ?? null);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const RENTHUS_WHATSAPP = "https://wa.me/556692071285";

    return (
        <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center space-y-6">

                {/* Ícone de bloqueio */}
                <div className="flex justify-center">
                    <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center">
                        <svg
                            className="w-10 h-10 text-red-500"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                            />
                        </svg>
                    </div>
                </div>

                {/* Título */}
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">
                        Sistema Bloqueado
                    </h1>
                    <p className="mt-2 text-gray-500">
                        Sua assinatura está bloqueada por falta de pagamento.
                        Regularize para reativar o sistema imediatamente.
                    </p>
                </div>

                {/* Valor pendente */}
                {amount != null && (
                    <div className="bg-red-50 rounded-xl p-4">
                        <p className="text-sm text-red-600 font-medium">Valor pendente</p>
                        <p className="text-3xl font-bold text-red-700 mt-1">
                            {amount.toLocaleString("pt-BR", {
                                style: "currency",
                                currency: "BRL",
                            })}
                        </p>
                    </div>
                )}

                {/* Botões de ação */}
                <div className="space-y-3">
                    {loading ? (
                        <div className="h-12 bg-gray-100 rounded-xl animate-pulse" />
                    ) : paymentUrl ? (
                        <a
                            href={paymentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block w-full py-3 px-6 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors"
                        >
                            Regularizar Pagamento (PIX)
                        </a>
                    ) : (
                        <p className="text-sm text-gray-400">
                            Link de pagamento não disponível. Entre em contato com o suporte.
                        </p>
                    )}

                    <a
                        href={RENTHUS_WHATSAPP}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full py-3 px-6 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl transition-colors"
                    >
                        Falar com Suporte Renthus
                    </a>
                </div>

                {/* Nota */}
                <p className="text-xs text-gray-400">
                    Após o pagamento confirmado, o sistema é reativado automaticamente
                    em até 5 minutos.
                </p>
            </div>
        </main>
    );
}
