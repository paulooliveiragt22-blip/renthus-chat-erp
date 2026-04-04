"use client";

/**
 * app/(public)/onboarding/page.tsx  →  rota: /onboarding
 * Stepper pós-cadastro com 4 etapas.
 */

import Image from "next/image";
import { useState } from "react";
import { useRouter }  from "next/navigation";

const STEPS = ["Políticas do Meta", "Número WhatsApp", "Cardápio", "Solicitar ativação"] as const;

export default function OnboardingPage() {
    const router = useRouter();
    const [step, setStep] = useState(0);

    // Etapa 1
    const [metaChecked, setMetaChecked] = useState(false);

    // Etapa 2
    const [whatsappNumber, setWhatsappNumber] = useState("");
    const [whatsappSaved,  setWhatsappSaved]  = useState(false);
    const [savingWA,       setSavingWA]        = useState(false);
    const [waError,        setWaError]         = useState<string | null>(null);

    // Etapa 4
    const [activating,  setActivating]  = useState(false);
    const [activated,   setActivated]   = useState(false);
    const [activateErr, setActivateErr] = useState<string | null>(null);

    function next() { setStep((s) => Math.min(s + 1, STEPS.length - 1)); }

    async function saveWhatsapp() {
        setWaError(null);
        setSavingWA(true);
        try {
            const res = await fetch("/api/onboarding", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "save_whatsapp", whatsapp: whatsappNumber }),
            });
            const d = await res.json();
            if (!res.ok) { setWaError(d.error ?? "Erro ao salvar número."); return; }
            setWhatsappSaved(true);
            setTimeout(next, 600);
        } catch { setWaError("Erro de conexão."); }
        finally { setSavingWA(false); }
    }

    async function requestActivation() {
        setActivateErr(null);
        setActivating(true);
        try {
            const res = await fetch("/api/onboarding", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "request_activation" }),
            });
            const d = await res.json();
            if (!res.ok) { setActivateErr(d.error ?? "Erro ao solicitar ativação."); return; }
            setActivated(true);
        } catch { setActivateErr("Erro de conexão."); }
        finally { setActivating(false); }
    }

    return (
        <div style={S.page}>
            {/* Logo */}
            <div style={{ marginBottom: 32 }}>
                <Image src="/renthus_logo.png" alt="Renthus" width={140} height={42}
                    style={{ objectFit: "contain" }} priority />
            </div>

            {/* Stepper */}
            <div style={S.stepper}>
                {STEPS.map((label, i) => (
                    <div key={label} style={S.stepItem}>
                        <div style={{
                            ...S.stepDot,
                            background:  i <= step ? "#FF6B00" : "rgba(255,255,255,0.2)",
                            border:      i === step ? "2px solid #fff" : "2px solid transparent",
                            boxShadow:   i === step ? "0 0 0 3px rgba(255,107,0,0.4)" : "none",
                        }}>
                            {i < step ? "✓" : i + 1}
                        </div>
                        <span style={{
                            ...S.stepLabel,
                            color: i <= step ? "#fff" : "rgba(255,255,255,0.4)",
                        }}>
                            {label}
                        </span>
                        {i < STEPS.length - 1 && <div style={S.stepLine} />}
                    </div>
                ))}
            </div>

            <div style={S.card}>
                {/* ------------------------------------------------------------------ */}
                {/* ETAPA 1 — Políticas do Meta                                        */}
                {/* ------------------------------------------------------------------ */}
                {step === 0 && (
                    <div>
                        <div style={S.policyCard}>
                            <h2 style={S.policyTitle}>
                                ⚠️ Importante — Políticas do Meta para Bebidas Alcoólicas
                            </h2>

                            <section style={S.policySection}>
                                <p style={S.policyGreen}><b>✅ PERMITIDO:</b></p>
                                <ul style={S.policyList}>
                                    <li>Automatizar pedidos e comunicação com clientes</li>
                                    <li>Enviar cardápio, confirmar pedidos e atualizar status</li>
                                    <li>Responder dúvidas dos clientes</li>
                                </ul>
                            </section>

                            <section style={S.policySection}>
                                <p style={S.policyRed}><b>❌ PROIBIDO pelo Meta:</b></p>
                                <ul style={S.policyList}>
                                    <li>
                                        Vender diretamente bebidas alcoólicas pelo chat
                                        <span style={{ color: "#6b7280", fontSize: 12 }}>
                                            {" "}(receber pagamentos pelos meios do WhatsApp — receber na entrega é totalmente permitido)
                                        </span>
                                    </li>
                                    <li>Enviar mensagens para menores de 18 anos</li>
                                    <li>Usar o WhatsApp para transações financeiras de bebidas</li>
                                    <li>Enviar spam ou mensagens não solicitadas</li>
                                </ul>
                            </section>

                            <section style={S.policySection}>
                                <p style={S.policyOrange}><b>⚠️ CONSEQUÊNCIAS do descumprimento:</b></p>
                                <ul style={S.policyList}>
                                    <li>Aviso do Meta na primeira violação</li>
                                    <li>Bloqueio temporário de 1 a 7 dias</li>
                                    <li>Desativação permanente da conta em caso de reincidência</li>
                                </ul>
                            </section>

                            <p style={{ fontSize: 13, color: "#374151", margin: "12px 0 0" }}>
                                Ao continuar, você declara estar ciente dessas políticas.
                            </p>
                        </div>

                        <label style={S.checkRow}>
                            <input type="checkbox" checked={metaChecked}
                                onChange={(e) => setMetaChecked(e.target.checked)} />
                            <span>
                                Li e estou ciente das políticas do Meta para bebidas alcoólicas
                            </span>
                        </label>

                        <button
                            disabled={!metaChecked}
                            onClick={next}
                            style={{ ...S.btn, opacity: metaChecked ? 1 : 0.4 }}>
                            Estou ciente, continuar →
                        </button>
                    </div>
                )}

                {/* ------------------------------------------------------------------ */}
                {/* ETAPA 2 — Configurar número WhatsApp                               */}
                {/* ------------------------------------------------------------------ */}
                {step === 1 && (
                    <div>
                        <h2 style={S.stepTitle}>Configurar seu número no Meta</h2>

                        <div style={S.attentionCard}>
                            <p style={{ margin: "0 0 12px", fontWeight: 700, fontSize: 14 }}>
                                🔴 ATENÇÃO — Leia antes de continuar:
                            </p>
                            <p style={{ margin: "0 0 10px", fontSize: 13, lineHeight: 1.7 }}>
                                O número que você vai usar <b>no bot</b> precisa ser um número{" "}
                                <b>EXCLUSIVO</b> para o estabelecimento. Ele <b>NÃO pode estar ativo</b>{" "}
                                em nenhum WhatsApp pessoal ou WhatsApp Business App.
                            </p>

                            <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 13 }}>
                                Se o número já tem WhatsApp:
                            </p>
                            <ol style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 13, lineHeight: 1.8 }}>
                                <li>Faça backup das suas conversas<br />
                                    <span style={{ color: "#6b7280" }}>→ No WhatsApp: Configurações → Conversas → Backup</span>
                                </li>
                                <li>Exclua a conta do WhatsApp<br />
                                    <span style={{ color: "#6b7280" }}>→ Configurações → Conta → Excluir minha conta</span>
                                </li>
                                <li>Aguarde 24 horas</li>
                                <li>Somente então informe o número aqui</li>
                            </ol>

                            <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 13, color: "#15803d" }}>
                                Se for um número novo (chip novo):
                            </p>
                            <p style={{ margin: 0, fontSize: 13, color: "#15803d" }}>
                                ✅ Pode usar diretamente, sem etapas acima.
                            </p>
                        </div>

                        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                            <a href="https://faq.whatsapp.com/android/chats/how-to-back-up-your-chats"
                                target="_blank" rel="noreferrer" style={S.linkBtn}>
                                Como fazer backup do WhatsApp →
                            </a>
                            <a href="https://business.facebook.com" target="_blank" rel="noreferrer"
                                style={S.linkBtn}>
                                Acessar Meta Business Manager →
                            </a>
                        </div>

                        <div style={S.supportCard}>
                            <span style={{ fontSize: 13 }}>
                                💬 Precisa de ajuda? Nossa equipe auxilia você nessa etapa.
                            </span>
                            <a href="https://wa.me/5566992071285" target="_blank" rel="noreferrer"
                                style={S.waBtn}>
                                Falar com suporte →
                            </a>
                        </div>

                        <div style={{ marginTop: 20, display: "flex", flexDirection: "column" as const, gap: 6 }}>
                            <label style={S.labelSmall}>Número que será usado no bot *</label>
                            <input style={S.input} type="tel" placeholder="(66) 99999-9999"
                                value={whatsappNumber}
                                onChange={(e) => setWhatsappNumber(e.target.value)} />
                        </div>

                        {waError && <div style={S.errorBox}>{waError}</div>}

                        {whatsappSaved ? (
                            <div style={{ ...S.successNote }}>✅ Número salvo!</div>
                        ) : (
                            <button
                                disabled={savingWA || whatsappNumber.replaceAll(/\D/g, "").length < 10}
                                onClick={saveWhatsapp}
                                style={{
                                    ...S.btn,
                                    marginTop: 16,
                                    opacity: savingWA || whatsappNumber.replaceAll(/\D/g, "").length < 10 ? 0.4 : 1,
                                }}>
                                {savingWA ? "Salvando..." : "Salvar número e continuar →"}
                            </button>
                        )}
                    </div>
                )}

                {/* ------------------------------------------------------------------ */}
                {/* ETAPA 3 — Cadastrar cardápio                                       */}
                {/* ------------------------------------------------------------------ */}
                {step === 2 && (
                    <div>
                        <h2 style={S.stepTitle}>Cadastre seus produtos</h2>

                        <p style={{ fontSize: 14, color: "#374151", lineHeight: 1.7, marginBottom: 20 }}>
                            Seu cardápio é gerenciado diretamente pelo painel do sistema.
                        </p>

                        <div style={S.infoCard}>
                            <p style={{ margin: "0 0 10px", fontWeight: 700, fontSize: 14 }}>
                                Como cadastrar:
                            </p>
                            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.9, color: "#374151" }}>
                                <li>Acesse o painel → menu <b>Produtos</b></li>
                                <li>Clique em <b>"Adicionar produto"</b></li>
                                <li>Preencha: nome, categoria, marca, preço e variantes</li>
                                <li>Ative o produto para aparecer no bot</li>
                            </ol>
                            <p style={{ margin: "12px 0 0", fontSize: 12, color: "#FF6B00", fontWeight: 600 }}>
                                💡 Dica: Comece pelas categorias (Cervejas, Destilados, etc.)
                                antes de cadastrar os produtos.
                            </p>
                        </div>

                        <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" as const }}>
                            <a href="/produtos/lista" target="_blank" rel="noreferrer" style={S.btn}>
                                Ir para Produtos agora →
                            </a>
                            <button onClick={next} style={S.btnSecondary}>
                                Farei depois, continuar →
                            </button>
                        </div>
                    </div>
                )}

                {/* ------------------------------------------------------------------ */}
                {/* ETAPA 4 — Solicitar ativação                                       */}
                {/* ------------------------------------------------------------------ */}
                {step === 3 && !activated && (
                    <div>
                        <h2 style={S.stepTitle}>Tudo pronto! Solicite sua ativação</h2>

                        <div style={S.infoCard}>
                            <p style={{ margin: "0 0 12px", fontWeight: 700, fontSize: 14 }}>
                                Nossa equipe irá:
                            </p>
                            <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 13, lineHeight: 2, color: "#374151" }}>
                                <li>✅ Verificar seu número no Meta Business Manager</li>
                                <li>✅ Configurar o webhook do WhatsApp</li>
                                <li>✅ Testar o bot antes de ativar</li>
                                <li>✅ Te avisar quando estiver tudo pronto</li>
                            </ul>
                            <p style={{ margin: "12px 0 0", fontSize: 13, color: "#6b7280" }}>
                                <b>Prazo:</b> até 48 horas úteis após a solicitação.
                            </p>
                        </div>

                        {activateErr && <div style={S.errorBox}>{activateErr}</div>}

                        <button
                            disabled={activating}
                            onClick={requestActivation}
                            style={{ ...S.btn, marginTop: 24, fontSize: 16, padding: "15px 24px", opacity: activating ? 0.7 : 1 }}>
                            {activating ? "Enviando..." : "Solicitar ativação agora →"}
                        </button>
                    </div>
                )}

                {/* ------------------------------------------------------------------ */}
                {/* ETAPA 4 — Confirmação após ativação solicitada                     */}
                {/* ------------------------------------------------------------------ */}
                {step === 3 && activated && (
                    <div style={{ textAlign: "center" as const, padding: "16px 0" }}>
                        <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
                        <h2 style={{ margin: "0 0 12px", fontSize: 22, fontWeight: 800, color: "#111827" }}>
                            Solicitação enviada!
                        </h2>
                        <p style={{ margin: "0 0 8px", fontSize: 15, color: "#374151", lineHeight: 1.7 }}>
                            Nossa equipe entrará em contato em até 48h úteis
                            pelo seu WhatsApp.
                        </p>
                        <p style={{ margin: "0 0 28px", fontSize: 14, color: "#6b7280" }}>
                            Enquanto isso, acesse o painel e cadastre seus produtos.
                        </p>
                        <button onClick={() => router.replace("/pedidos")} style={S.btn}>
                            Acessar o painel →
                        </button>
                    </div>
                )}
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
    stepper: {
        display:        "flex",
        alignItems:     "flex-start",
        justifyContent: "center",
        marginBottom:   36,
        maxWidth:       680,
        width:          "100%",
        gap:            0,
    },
    stepItem: {
        display:        "flex",
        flexDirection:  "column" as const,
        alignItems:     "center",
        position:       "relative" as const,
        flex:           1,
        gap:            8,
    },
    stepDot: {
        width:          32,
        height:         32,
        borderRadius:   "50%",
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        fontSize:       13,
        fontWeight:     700,
        color:          "#fff",
        transition:     "all 0.2s",
        zIndex:         2,
        position:       "relative" as const,
    },
    stepLabel: {
        fontSize:   11,
        fontWeight: 600,
        textAlign:  "center" as const,
        lineHeight: 1.3,
        maxWidth:   80,
    },
    stepLine: {
        position:   "absolute" as const,
        top:        16,
        left:       "calc(50% + 16px)",
        right:      "calc(-50% + 16px)",
        height:     2,
        background: "rgba(255,255,255,0.2)",
        zIndex:     1,
    },
    card: {
        background:   "#fff",
        borderRadius: 20,
        padding:      "32px 28px",
        width:        "100%",
        maxWidth:     640,
        boxShadow:    "0 16px 48px rgba(0,0,0,0.35)",
    },
    stepTitle: {
        margin:       "0 0 20px",
        fontSize:     20,
        fontWeight:   800,
        color:        "#111827",
    },
    policyCard: {
        background:   "#fffbeb",
        border:       "1.5px solid #fbbf24",
        borderRadius: 14,
        padding:      "20px 20px 14px",
        marginBottom: 20,
    },
    policyTitle: {
        margin:       "0 0 16px",
        fontSize:     16,
        fontWeight:   800,
        color:        "#92400e",
    },
    policySection: {
        marginBottom: 12,
    },
    policyList: {
        margin:      "4px 0 0",
        paddingLeft: 18,
        fontSize:    13,
        lineHeight:  1.8,
        color:       "#374151",
    },
    policyGreen:  { margin: "0 0 4px", fontSize: 13, color: "#15803d" },
    policyRed:    { margin: "0 0 4px", fontSize: 13, color: "#b91c1c" },
    policyOrange: { margin: "0 0 4px", fontSize: 13, color: "#c2410c" },
    checkRow: {
        display:      "flex",
        alignItems:   "flex-start",
        gap:          10,
        fontSize:     13,
        color:        "#374151",
        fontWeight:   500,
        lineHeight:   1.5,
        marginBottom: 20,
        cursor:       "pointer",
    },
    attentionCard: {
        background:   "#fef2f2",
        border:       "1.5px solid #fca5a5",
        borderRadius: 14,
        padding:      "18px 18px 14px",
        marginBottom: 16,
        color:        "#7f1d1d",
    },
    infoCard: {
        background:   "#f0f9ff",
        border:       "1px solid #bae6fd",
        borderRadius: 14,
        padding:      "18px 20px",
    },
    supportCard: {
        background:   "#f0fdf4",
        border:       "1px solid #bbf7d0",
        borderRadius: 14,
        padding:      "14px 18px",
        display:      "flex",
        alignItems:   "center",
        justifyContent: "space-between" as const,
        gap:          12,
    },
    linkBtn: {
        fontSize:       12,
        fontWeight:     600,
        color:          "#2563eb",
        textDecoration: "none" as const,
        padding:        "6px 12px",
        border:         "1px solid #bfdbfe",
        borderRadius:   8,
        background:     "#eff6ff",
        whiteSpace:     "nowrap" as const,
    },
    waBtn: {
        fontSize:       13,
        fontWeight:     700,
        color:          "#fff",
        textDecoration: "none" as const,
        padding:        "8px 16px",
        borderRadius:   10,
        background:     "#16a34a",
        whiteSpace:     "nowrap" as const,
    },
    labelSmall: {
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
    errorBox: {
        background:   "#fef2f2",
        border:       "1px solid #fecaca",
        borderRadius: 10,
        padding:      "10px 14px",
        fontSize:     13,
        color:        "#b91c1c",
        marginTop:    12,
    },
    successNote: {
        marginTop:  16,
        fontSize:   14,
        fontWeight: 700,
        color:      "#15803d",
    },
    btn: {
        display:        "inline-block",
        padding:        "12px 22px",
        background:     "#FF6B00",
        color:          "#fff",
        border:         "none",
        borderRadius:   12,
        fontSize:       14,
        fontWeight:     700,
        cursor:         "pointer",
        textDecoration: "none" as const,
        boxShadow:      "0 4px 14px rgba(255,107,0,0.35)",
        transition:     "opacity 0.15s",
    },
    btnSecondary: {
        display:        "inline-block",
        padding:        "12px 22px",
        background:     "transparent",
        color:          "#6b7280",
        border:         "1.5px solid #d1d5db",
        borderRadius:   12,
        fontSize:       14,
        fontWeight:     600,
        cursor:         "pointer",
        textDecoration: "none" as const,
    },
    footer: {
        marginTop: 32,
        fontSize:  12,
        color:     "rgba(255,255,255,0.30)",
    },
};
