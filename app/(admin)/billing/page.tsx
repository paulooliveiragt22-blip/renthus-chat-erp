import { redirect } from "next/navigation";

/**
 * Página legada "Plano & Uso" — o painel completo de plano, PIX e cartões
 * fica em Configurações → aba "Plano e pagamentos".
 */
export default function BillingPage() {
    redirect("/configuracoes?tab=plano");
}
