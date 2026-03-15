/**
 * app/billing/blocked/page.tsx
 *
 * Página standalone exibida quando a empresa está bloqueada por inadimplência.
 * Sem sidebar, sem header — layout completamente isolado.
 *
 * O AdminShell e o HeaderClient ignoram esta rota via verificação de pathname.
 */

import type { Metadata }     from "next";
import { cookies }            from "next/headers";
import { createAdminClient }  from "@/lib/supabase/admin";

export const metadata: Metadata = {
    title: "Acesso Suspenso — Renthus",
    robots: "noindex",
};

// ----------------------------------------------------------------------------
// Busca dados no servidor: nome da empresa + link de pagamento
// ----------------------------------------------------------------------------
async function getBlockedData(): Promise<{
    companyName: string | null;
    paymentUrl:  string | null;
    amount:      number | null;
}> {
    try {
        const companyId = (await cookies()).get("renthus_company_id")?.value;
        if (!companyId) return { companyName: null, paymentUrl: null, amount: null };

        const admin = createAdminClient();

        const [{ data: company }, { data: inv }] = await Promise.all([
            admin
                .from("companies")
                .select("name")
                .eq("id", companyId)
                .maybeSingle(),

            admin
                .from("invoices")
                .select("pagarme_payment_url, amount")
                .eq("company_id", companyId)
                .eq("status", "pending")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle(),
        ]);

        return {
            companyName: company?.name ?? null,
            paymentUrl:  inv?.pagarme_payment_url ?? null,
            amount:      inv?.amount ?? null,
        };
    } catch {
        return { companyName: null, paymentUrl: null, amount: null };
    }
}

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------
export default async function BillingBlockedPage() {
    const { companyName, paymentUrl, amount } = await getBlockedData();

    const SUPPORT_WA = "https://wa.me/5566992071285";

    const amountFormatted = amount != null
        ? amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
        : null;

    return (
        <div
            style={{
                minHeight: "100vh",
                background: "linear-gradient(160deg, #1a0030 0%, #0d0018 100%)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "24px 16px",
                fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
            }}
        >
            {/* Logo */}
            <div style={{ marginBottom: 36 }}>
                <img
                    src="/assets/renthus-logo.svg"
                    alt="Renthus"
                    style={{ height: 40, width: "auto", filter: "brightness(0) invert(1)" }}
                />
            </div>

            {/* Card central */}
            <div
                style={{
                    background: "#ffffff",
                    borderRadius: 20,
                    boxShadow: "0 24px 64px rgba(0,0,0,0.40)",
                    padding: "40px 36px",
                    maxWidth: 440,
                    width: "100%",
                    textAlign: "center",
                }}
            >
                {/* Ícone de cadeado */}
                <div
                    style={{
                        width: 72,
                        height: 72,
                        borderRadius: "50%",
                        background: "#fef2f2",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto 24px",
                    }}
                >
                    <svg
                        width="36"
                        height="36"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                </div>

                {/* Título */}
                <h1
                    style={{
                        margin: "0 0 10px",
                        fontSize: 26,
                        fontWeight: 800,
                        color: "#111827",
                        letterSpacing: "-0.5px",
                    }}
                >
                    Acesso suspenso
                </h1>

                {/* Subtítulo */}
                <p
                    style={{
                        margin: "0 0 20px",
                        fontSize: 15,
                        color: "#6b7280",
                        lineHeight: 1.6,
                    }}
                >
                    Sua mensalidade está em aberto.
                    <br />
                    Regularize para reativar o sistema imediatamente.
                </p>

                {/* Badge empresa */}
                {companyName && (
                    <div
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            background: "#f3f4f6",
                            border: "1px solid #e5e7eb",
                            borderRadius: 999,
                            padding: "6px 14px",
                            fontSize: 13,
                            fontWeight: 600,
                            color: "#374151",
                            marginBottom: 24,
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                            <polyline points="9 22 9 12 15 12 15 22" />
                        </svg>
                        {companyName}
                    </div>
                )}

                {/* Valor pendente */}
                {amountFormatted && (
                    <div
                        style={{
                            background: "#fef2f2",
                            border: "1px solid #fecaca",
                            borderRadius: 12,
                            padding: "14px 18px",
                            marginBottom: 24,
                        }}
                    >
                        <p style={{ margin: "0 0 2px", fontSize: 12, color: "#b91c1c", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                            Valor pendente
                        </p>
                        <p style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#991b1b" }}>
                            {amountFormatted}
                        </p>
                    </div>
                )}

                {/* Botões */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
                    {paymentUrl ? (
                        <a
                            href={paymentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                                display: "block",
                                padding: "14px 20px",
                                background: "#22c55e",
                                color: "#fff",
                                borderRadius: 12,
                                fontWeight: 700,
                                fontSize: 16,
                                textDecoration: "none",
                                boxShadow: "0 4px 14px rgba(34,197,94,0.35)",
                                transition: "opacity 0.15s",
                            }}
                        >
                            Pagar agora (PIX)
                        </a>
                    ) : (
                        <div
                            style={{
                                padding: "14px 20px",
                                background: "#f3f4f6",
                                color: "#9ca3af",
                                borderRadius: 12,
                                fontWeight: 600,
                                fontSize: 15,
                            }}
                        >
                            Link de pagamento indisponível
                        </div>
                    )}

                    <a
                        href={SUPPORT_WA}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            display: "block",
                            padding: "13px 20px",
                            background: "transparent",
                            color: "#7c3aed",
                            border: "2px solid #7c3aed",
                            borderRadius: 12,
                            fontWeight: 700,
                            fontSize: 15,
                            textDecoration: "none",
                        }}
                    >
                        Falar com suporte
                    </a>
                </div>

                {/* Separador */}
                <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 20 }}>
                    <p style={{ margin: 0, fontSize: 12, color: "#9ca3af", lineHeight: 1.6 }}>
                        Após o pagamento confirmado, o sistema é reativado
                        automaticamente em até 5 minutos.
                    </p>
                </div>
            </div>

            {/* Rodapé */}
            <p style={{ marginTop: 28, fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
                © {new Date().getFullYear()} Renthus — Todos os direitos reservados
            </p>
        </div>
    );
}
