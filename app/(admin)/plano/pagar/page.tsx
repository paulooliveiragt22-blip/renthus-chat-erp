import PlanBillingPanel from "@/components/billing/PlanBillingPanel";

export default function PlanoPagarPage() {
    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Concluir pagamento</h1>
                <p className="mt-0.5 text-xs text-zinc-400">
                    Pague com PIX ou cartão para liberar o acesso ao RenthusAgent
                </p>
            </div>
            <div className="rounded-xl bg-white p-6 shadow-sm transition-all duration-300 dark:bg-zinc-900">
                <PlanBillingPanel variant="pay" />
            </div>
        </div>
    );
}
