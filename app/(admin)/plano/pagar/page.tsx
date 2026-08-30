import Link from "next/link";
import PlanBillingPanel from "@/components/billing/PlanBillingPanel";

/**
 * Gate de pagamento (pay-to-start / overdue).
 * Renderizado sem AdminShell (sidebar) — pagar primeiro, depois /ativar.
 */
export default function PlanoPagarPage() {
    return (
        <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
            <header className="border-b border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mx-auto flex max-w-lg items-center justify-between">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src="/brand/renthus-wordmark-on-light.svg"
                        alt="RenthusAgent"
                        className="h-7 w-auto dark:hidden"
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src="/brand/renthus-wordmark-on-dark.svg"
                        alt="RenthusAgent"
                        className="hidden h-7 w-auto dark:block"
                    />
                    <Link
                        href="/logout"
                        className="text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                    >
                        Sair
                    </Link>
                </div>
            </header>
            <main className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-8">
                <div>
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
                        Concluir pagamento
                    </h1>
                    <p className="mt-1 text-sm text-zinc-500">
                        Pague com PIX ou cartão para liberar o acesso ao sistema. Depois do
                        pagamento você será direcionado à ativação da loja.
                    </p>
                </div>
                <div className="rounded-xl bg-white p-6 shadow-sm dark:bg-zinc-900">
                    <PlanBillingPanel variant="pay" />
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    <strong>Assinatura desativada por inatividade?</strong>{" "}
                    <Link
                        href="/plano/reativar"
                        className="font-semibold underline hover:text-amber-700 dark:hover:text-amber-100"
                    >
                        Reative aqui
                    </Link>{" "}
                    para ganhar um novo período de teste.
                </div>
            </main>
        </div>
    );
}
