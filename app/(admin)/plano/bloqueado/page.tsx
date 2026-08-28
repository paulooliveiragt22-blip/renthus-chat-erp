import Link from "next/link";
import { Lock } from "lucide-react";

export default function PlanoBloqueadoPage() {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 px-4 py-12 text-center dark:bg-zinc-950">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-100 dark:bg-red-950/40">
                <Lock className="h-8 w-8 text-red-600 dark:text-red-400" />
            </span>
            <div className="max-w-md">
                <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Acesso suspenso</h1>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    Sua assinatura está inativa ou o pagamento está pendente. Regularize a cobrança para
                    voltar a usar o ERP, PDV e demais módulos.
                </p>
            </div>
            <Link
                href="/plano/pagar"
                className="rounded-xl bg-violet-600 px-6 py-3 text-sm font-bold text-white transition hover:bg-violet-700"
            >
                Ir para pagamento
            </Link>
            <Link href="/logout" className="text-xs font-semibold text-zinc-500 hover:text-zinc-800">
                Sair
            </Link>
        </div>
    );
}
