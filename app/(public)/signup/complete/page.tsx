"use client";

/**
 * app/(public)/signup/complete/page.tsx  →  rota: /signup/complete?token=xxx
 * Página standalone pós-pagamento: completa o cadastro e define a senha.
 */

import Image from "next/image";
import { useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter }  from "next/navigation";
import { createClient }                from "@/lib/supabase/client";

type CompanyData = {
    company_id:   string;
    company_name: string;
    email:        string;
    whatsapp:     string;
    cnpj:         string;
    plan:         string | null;
};

export default function SignupCompletePage() {
    const searchParams = useSearchParams();
    const router       = useRouter();
    const supabase     = createClient();
    const token        = searchParams.get("token") ?? "";

    const [company,  setCompany]  = useState<CompanyData | null>(null);
    const [notFound, setNotFound] = useState(false);
    const [loading,  setLoading]  = useState(true);

    // Form state
    const [razaoSocial,  setRazaoSocial]  = useState("");
    const [cep,          setCep]          = useState("");
    const [endereco,     setEndereco]     = useState("");
    const [bairro,       setBairro]       = useState("");
    const [cidade,       setCidade]       = useState("");
    const [uf,           setUf]           = useState("");
    const [numero,       setNumero]       = useState("");
    const [complemento,  setComplemento]  = useState("");
    const [password,     setPassword]     = useState("");
    const [confirm,      setConfirm]      = useState("");
    const [submitting,   setSubmitting]   = useState(false);
    const [error,        setError]        = useState<string | null>(null);

    const cepRef = useRef<string>("");

    // Carrega dados pelo token
    useEffect(() => {
        if (!token) { setLoading(false); setNotFound(true); return; }

        fetch(`/api/signup/complete?token=${encodeURIComponent(token)}`)
            .then((r) => r.json())
            .then((d) => {
                if (d.error) { setNotFound(true); }
                else         { setCompany(d); setRazaoSocial(d.company_name); }
            })
            .catch(() => setNotFound(true))
            .finally(() => setLoading(false));
    }, [token]);

    // Busca CEP via ViaCEP
    useEffect(() => {
        const digits = cep.replaceAll(/\D/g, "");
        if (digits.length !== 8 || digits === cepRef.current) return;
        cepRef.current = digits;
        fetch(`https://viacep.com.br/ws/${digits}/json/`)
            .then((r) => r.json())
            .then((d) => {
                if (!d.erro) {
                    setEndereco(d.logradouro ?? "");
                    setBairro(d.bairro ?? "");
                    setCidade(d.localidade ?? "");
                    setUf((d.uf ?? "").toUpperCase());
                }
            })
            .catch(() => {/* usuário preenche manualmente */});
    }, [cep]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);

        if (password.length < 8) {
            setError("A senha deve ter no mínimo 8 caracteres.");
            return;
        }
        if (password !== confirm) {
            setError("As senhas não coincidem.");
            return;
        }
        if (!razaoSocial.trim()) {
            setError("Informe a razão social.");
            return;
        }

        setSubmitting(true);
        try {
            // 1. Salva dados no servidor
            const res = await fetch("/api/signup/complete", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    token, razao_social: razaoSocial, cep, endereco,
                    numero, complemento, bairro, cidade, uf, password,
                }),
            });
            const data = await res.json();
            if (!res.ok) { setError(data.error ?? "Erro ao salvar dados."); return; }

            // 2. Login automático com o email + nova senha
            const { error: loginErr } = await supabase.auth.signInWithPassword({
                email:    company!.email,
                password,
            });
            if (loginErr) { setError("Senha definida! Faça login em /login."); return; }

            // 3. Sincroniza sessão server-side
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                await fetch("/api/auth/sync-session", {
                    method:  "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        access_token:  session.access_token,
                        refresh_token: session.refresh_token,
                    }),
                }).catch(() => {/* não bloquear */});
            }

            // 4. Seleciona workspace
            await fetch("/api/workspace/list")
                .then((r) => r.json())
                .then(async (j) => {
                    const companies = Array.isArray(j.companies) ? j.companies : [];
                    if (companies.length === 1) {
                        await fetch("/api/workspace/select", {
                            method:  "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ company_id: companies[0].id }),
                        });
                    }
                })
                .catch(() => {/* não bloquear */});

            // 5. Redireciona para onboarding
            router.replace("/onboarding");
        } catch (err: any) {
            setError(err?.message ?? "Erro inesperado.");
        } finally {
            setSubmitting(false);
        }
    }

    // -----------------------------------------------------------------------
    // Render helpers
    // -----------------------------------------------------------------------
    if (loading) {
        return (
            <div style={S.page}>
                <p style={{ color: "#fff" }}>Carregando...</p>
            </div>
        );
    }

    if (notFound) {
        return (
            <div style={S.page}>
                <div style={S.card}>
                    <h2 style={{ margin: "0 0 12px", color: "#b91c1c" }}>Link inválido</h2>
                    <p style={{ color: "#6b7280" }}>
                        Este link de cadastro não é válido ou já foi utilizado.
                        Se precisar de ajuda, entre em contato com o suporte.
                    </p>
                    <a href="/login" style={{ color: "#FF6B00", fontWeight: 700 }}>
                        Ir para o login →
                    </a>
                </div>
            </div>
        );
    }

    const passwordMatch = confirm.length === 0 || password === confirm;

    return (
        <div style={S.page}>
            {/* Logo */}
            <div style={{ marginBottom: 32 }}>
                <Image src="/renthus_logo.png" alt="Renthus" width={140} height={42}
                    style={{ objectFit: "contain" }} priority />
            </div>

            {/* Banner de lembrete */}
            <div style={S.reminderBanner}>
                <b>⚠️ Lembrete:</b> verifique seu e-mail para confirmar sua conta quando possível.
                {" "}Enviamos um link de backup para <b>{company?.email}</b>
            </div>

            <div style={S.card}>
                <h1 style={S.title}>Quase lá! Complete seu cadastro</h1>
                <p style={S.subtitle}>
                    Seu pagamento foi confirmado. Agora defina sua senha de acesso.
                </p>

                <form onSubmit={handleSubmit}>
                    {/* E-mail — bloqueado */}
                    <div style={S.fieldRow}>
                        <div style={{ ...S.field, flex: 1 }}>
                            <label style={S.label}>E-mail</label>
                            <input style={{ ...S.input, background: "#f3f4f6", color: "#6b7280" }}
                                value={company?.email ?? ""} readOnly />
                        </div>
                        <div style={{ ...S.field, flex: 1 }}>
                            <label style={S.label}>Nome da empresa</label>
                            <input style={{ ...S.input, background: "#f3f4f6", color: "#6b7280" }}
                                value={company?.company_name ?? ""} readOnly />
                        </div>
                    </div>

                    {/* Razão social */}
                    <div style={S.field}>
                        <label style={S.label}>Razão social *</label>
                        <input style={S.input} placeholder="Razão social conforme CNPJ"
                            value={razaoSocial}
                            onChange={(e) => setRazaoSocial(e.target.value)} required />
                    </div>

                    {/* Endereço */}
                    <div style={S.fieldRow}>
                        <div style={{ ...S.field, width: 160 }}>
                            <label style={S.label}>CEP *</label>
                            <input style={S.input} placeholder="00000-000"
                                value={cep}
                                onChange={(e) => setCep(e.target.value)} required />
                        </div>
                        <div style={{ ...S.field, flex: 1 }}>
                            <label style={S.label}>Endereço</label>
                            <input style={S.input} placeholder="Rua, Av..."
                                value={endereco}
                                onChange={(e) => setEndereco(e.target.value)} />
                        </div>
                        <div style={{ ...S.field, width: 100 }}>
                            <label style={S.label}>Número *</label>
                            <input style={S.input} placeholder="Nº"
                                value={numero}
                                onChange={(e) => setNumero(e.target.value)} required />
                        </div>
                    </div>

                    <div style={S.fieldRow}>
                        <div style={{ ...S.field, flex: 1 }}>
                            <label style={S.label}>Complemento</label>
                            <input style={S.input} placeholder="Sala, apt, bloco (opcional)"
                                value={complemento}
                                onChange={(e) => setComplemento(e.target.value)} />
                        </div>
                        <div style={{ ...S.field, flex: 1 }}>
                            <label style={S.label}>Bairro</label>
                            <input style={S.input} value={bairro}
                                onChange={(e) => setBairro(e.target.value)} />
                        </div>
                        <div style={{ ...S.field, flex: 1 }}>
                            <label style={S.label}>Cidade</label>
                            <input style={S.input} value={cidade}
                                onChange={(e) => setCidade(e.target.value)} />
                        </div>
                        <div style={{ ...S.field, width: 70 }}>
                            <label style={S.label}>UF</label>
                            <input style={S.input} value={uf}
                                onChange={(e) => setUf(e.target.value.toUpperCase())}
                                maxLength={2} />
                        </div>
                    </div>

                    {/* Senha */}
                    <div style={{ borderTop: "1px solid #f3f4f6", marginTop: 8, paddingTop: 20 }}>
                        <div style={S.fieldRow}>
                            <div style={{ ...S.field, flex: 1 }}>
                                <label style={S.label}>Senha *</label>
                                <input style={S.input} type="password" placeholder="Mínimo 8 caracteres"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)} required />
                                {password.length > 0 && password.length < 8 && (
                                    <span style={S.hint}>Mínimo 8 caracteres</span>
                                )}
                            </div>
                            <div style={{ ...S.field, flex: 1 }}>
                                <label style={S.label}>Confirmar senha *</label>
                                <input
                                    style={{
                                        ...S.input,
                                        borderColor: !passwordMatch ? "#ef4444" : undefined,
                                    }}
                                    type="password"
                                    placeholder="Repita a senha"
                                    value={confirm}
                                    onChange={(e) => setConfirm(e.target.value)} required />
                                {!passwordMatch && (
                                    <span style={{ ...S.hint, color: "#ef4444" }}>
                                        Senhas não coincidem
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {error && <div style={S.errorBox}>{error}</div>}

                    <button type="submit" disabled={submitting || !passwordMatch}
                        style={{ ...S.submitBtn, opacity: submitting ? 0.7 : 1 }}>
                        {submitting ? "Salvando..." : "Concluir cadastro →"}
                    </button>
                </form>
            </div>

            <p style={S.footer}>© {new Date().getFullYear()} Renthus · Todos os direitos reservados</p>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------
const S = {
    page: {
        minHeight:     "100vh",
        background:    "#1A123D",
        display:       "flex",
        flexDirection: "column" as const,
        alignItems:    "center",
        padding:       "40px 16px 64px",
        fontFamily:    "'Inter', 'Segoe UI', system-ui, sans-serif",
    },
    reminderBanner: {
        background:   "#fef9c3",
        border:       "1px solid #fde68a",
        borderRadius: 10,
        padding:      "12px 18px",
        fontSize:     13,
        color:        "#713f12",
        maxWidth:     640,
        width:        "100%",
        marginBottom: 24,
        lineHeight:   1.6,
    },
    card: {
        background:   "#fff",
        borderRadius: 20,
        padding:      "32px 28px",
        width:        "100%",
        maxWidth:     640,
        boxShadow:    "0 16px 48px rgba(0,0,0,0.35)",
    },
    title: {
        margin:      "0 0 8px",
        fontSize:    22,
        fontWeight:  800,
        color:       "#111827",
    },
    subtitle: {
        margin:       "0 0 28px",
        fontSize:     14,
        color:        "#6b7280",
        lineHeight:   1.6,
    },
    field: {
        display:       "flex",
        flexDirection: "column" as const,
        gap:           5,
        marginBottom:  14,
    },
    fieldRow: {
        display:     "flex",
        gap:         12,
        flexWrap:    "wrap" as const,
        marginBottom: 0,
    },
    label: {
        fontSize:   12,
        fontWeight: 600,
        color:      "#374151",
    },
    input: {
        padding:      "10px 13px",
        border:       "1.5px solid #d1d5db",
        borderRadius: 9,
        fontSize:     14,
        color:        "#111827",
        outline:      "none",
        width:        "100%",
        boxSizing:    "border-box" as const,
    },
    hint: {
        fontSize: 11,
        color:    "#9ca3af",
    },
    errorBox: {
        background:   "#fef2f2",
        border:       "1px solid #fecaca",
        borderRadius: 10,
        padding:      "10px 14px",
        fontSize:     13,
        color:        "#b91c1c",
        marginBottom: 16,
        marginTop:    8,
    },
    submitBtn: {
        width:        "100%",
        padding:      "14px 20px",
        background:   "#FF6B00",
        color:        "#fff",
        border:       "none",
        borderRadius: 12,
        fontSize:     16,
        fontWeight:   700,
        cursor:       "pointer",
        boxShadow:    "0 4px 14px rgba(255,107,0,0.40)",
        marginTop:    8,
    },
    footer: {
        marginTop: 32,
        fontSize:  12,
        color:     "rgba(255,255,255,0.30)",
    },
};
