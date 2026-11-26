"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { useRouter, useSearchParams } from "next/navigation";
import PasswordInput from "@/components/PasswordInput";
import { BillingPeriodToggle, type BillingPeriodValue } from "@/components/billing/BillingPeriodToggle";
import {
    mixpanelIdentify,
    trackSignUpCompleted,
} from "@/lib/analytics/mixpanelBrowser";
import { OFFICE_PLAN } from "@/lib/billing/planCatalog";
import { formatBrlFromCents } from "@/lib/billing/moneyDisplay";
import { attendanceLandingHref } from "@/lib/marketing/hosts";
import { createClient } from "@/lib/supabase/client";

type SignupResponse = {
    error?: string;
    company_id?: string;
    payment_required?: boolean;
};

async function syncServerSession(session: Session | null): Promise<boolean> {
    if (!session) return false;
    try {
        const response = await fetch("/api/auth/sync-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                access_token: session.access_token,
                refresh_token: session.refresh_token,
            }),
        });
        return response.ok;
    } catch {
        return false;
    }
}

export function OfficeSignupForm() {
    const router = useRouter();
    const params = useSearchParams();
    const supabase = useMemo(() => createClient(), []);
    const fromUrl: BillingPeriodValue = params.get("periodo") === "month" ? "month" : "year";
    const [picked, setPicked] = useState<BillingPeriodValue | null>(null);
    const period = picked ?? fromUrl;
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState({
        company_name: "",
        cnpj: "",
        whatsapp: "",
        email: "",
        password: "",
        password_confirm: "",
    });

    const yearly = period === "year";
    const charge = yearly ? OFFICE_PLAN.yearlyPriceCents : OFFICE_PLAN.monthlyPriceCents;
    const chargeLabel = yearly
        ? `${formatBrlFromCents(charge)} no ano`
        : `${formatBrlFromCents(charge)} por mês`;

    function setField(key: keyof typeof form, value: string) {
        setForm((current) => ({ ...current, [key]: value }));
        setError(null);
    }

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError(null);
        setLoading(true);
        try {
            const res = await fetch("/api/billing/signup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...form,
                    plan: "office",
                    billing_period: period,
                }),
            });
            const data = (await res.json()) as SignupResponse;
            if (!res.ok) {
                setError(data.error ?? "Não foi possível concluir o cadastro.");
                return;
            }

            const email = form.email.trim().toLowerCase();
            const { data: signInData, error: signErr } = await supabase.auth.signInWithPassword({
                email,
                password: form.password,
            });
            if (signErr || !signInData.session) {
                setError(signErr?.message ?? "Conta criada. Entre com o e-mail e a senha.");
                router.push("/login?cadastro=ok");
                return;
            }

            const synced = await syncServerSession(signInData.session);
            if (!synced) {
                setError("Sessão não sincronizada. Faça login manualmente.");
                router.push("/login?cadastro=ok");
                return;
            }

            if (data.company_id) {
                const selected = await fetch("/api/workspace/select", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ company_id: data.company_id }),
                });
                if (!selected.ok) {
                    setError("Conta criada. Entre de novo para abrir o Office.");
                    router.push("/login");
                    return;
                }
            }

            const user = signInData.session.user;
            mixpanelIdentify(user.id, { email: user.email ?? null, company_id: data.company_id ?? null });
            trackSignUpCompleted({
                sign_up_method: "email",
                platform: "web",
                plan: "office",
                billing_period: period,
                company_id: data.company_id ?? null,
            });
            window.location.assign(data.payment_required ? "/plano/pagar" : "/ativar");
        } catch {
            setError("Erro de conexão. Tente novamente.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col px-4 py-10 sm:px-6">
            <a href={attendanceLandingHref(false)} className="text-sm font-semibold text-emerald-800">
                Office
            </a>
            <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-950">Criar a conta do Office</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Uma empresa, um produto. Esta conta não abre o Delivery.
            </p>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
                <BillingPeriodToggle
                    id="office-billing-period"
                    value={period}
                    onValueChange={setPicked}
                    yearlyHint="economize 37%"
                />
                <p className="mt-4 text-2xl font-semibold tabular-nums text-slate-950">
                    {formatBrlFromCents(yearly ? OFFICE_PLAN.yearlyPriceCents / 12 : OFFICE_PLAN.monthlyPriceCents)}
                    <span className="text-sm font-medium text-slate-500">/mês</span>
                </p>
                <p className="mt-1 text-sm text-slate-600">
                    {yearly
                        ? `${formatBrlFromCents(OFFICE_PLAN.yearlyPriceCents)} à vista. 1 usuário. A IA inclusa é R$ 15,90 por mês.`
                        : "1 usuário. Sem assento extra. A IA inclusa é R$ 15,90 por mês."}
                </p>
            </div>

            <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
                <Field label="Nome da empresa" value={form.company_name} autoComplete="organization" onChange={(value) => setField("company_name", value)} />
                <Field label="CNPJ" value={form.cnpj} inputMode="numeric" autoComplete="off" onChange={(value) => setField("cnpj", value)} />
                <Field label="WhatsApp" value={form.whatsapp} type="tel" autoComplete="tel" onChange={(value) => setField("whatsapp", value)} />
                <Field label="E-mail" value={form.email} type="email" autoComplete="email" onChange={(value) => setField("email", value)} />
                <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-800">
                    Senha
                    <PasswordInput
                        className="rounded-xl border border-slate-300 px-3 py-2.5 text-base text-slate-950"
                        value={form.password}
                        minLength={8}
                        autoComplete="new-password"
                        required
                        onChange={(event) => setField("password", event.target.value)}
                    />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-800">
                    Confirmar senha
                    <PasswordInput
                        className="rounded-xl border border-slate-300 px-3 py-2.5 text-base text-slate-950"
                        value={form.password_confirm}
                        minLength={8}
                        autoComplete="new-password"
                        required
                        onChange={(event) => setField("password_confirm", event.target.value)}
                    />
                </label>
                {error ? (
                    <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
                        {error}
                    </p>
                ) : null}
                <button
                    type="submit"
                    disabled={loading}
                    className="rounded-full bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-70"
                >
                    {loading ? "Criando conta…" : `Criar conta e pagar ${chargeLabel}`}
                </button>
            </form>
            <p className="mt-6 text-sm text-slate-600">
                Já tem conta?{" "}
                <a href="/login" className="font-semibold text-emerald-800">
                    Entrar
                </a>
            </p>
        </main>
    );
}

function Field({
    label,
    value,
    onChange,
    type = "text",
    inputMode,
    autoComplete,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: string;
    inputMode?: "numeric" | "text";
    autoComplete?: string;
}) {
    return (
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-800">
            {label}
            <input
                required
                type={type}
                inputMode={inputMode}
                autoComplete={autoComplete}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-base text-slate-950"
            />
        </label>
    );
}
