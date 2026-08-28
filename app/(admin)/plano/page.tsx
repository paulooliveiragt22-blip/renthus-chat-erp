import PlanBillingPanel from "@/components/billing/PlanBillingPanel";

export default function PlanoPage() {
    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Plano e pagamentos</h1>
                <p className="mt-0.5 text-xs text-zinc-400">
                    Gerencie sua assinatura RenthusAgent, mensalidade e formas de pagamento
                </p>
            </div>
            <div className="rounded-xl bg-white p-6 shadow-sm transition-all duration-300 dark:bg-zinc-900">
                <PlanBillingPanel variant="full" />
            </div>
        </div>
    );
}
