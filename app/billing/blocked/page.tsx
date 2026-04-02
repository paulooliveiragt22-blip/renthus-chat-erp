import { redirect } from "next/navigation";

/** Legado: bloqueio agora é tratado em Configurações › Plano e pagamentos (PIX na aba). */
export default function BillingBlockedPage() {
    redirect("/configuracoes?tab=plano");
}
