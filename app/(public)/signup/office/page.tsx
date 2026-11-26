import { Suspense } from "react";
import type { Metadata } from "next";
import { OfficeSignupForm } from "@/components/billing/OfficeSignupForm";

export const metadata: Metadata = {
    title: "Criar conta Office — Zampell",
    description: "Checkout do Office. Mensal R$ 159 ou anual R$ 1.198,80 à vista.",
};

export default function OfficeSignupPage() {
    return (
        <Suspense fallback={<main className="px-4 py-10 text-sm text-slate-600">Carregando o checkout…</main>}>
            <OfficeSignupForm />
        </Suspense>
    );
}
