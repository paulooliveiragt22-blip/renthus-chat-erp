"use client";

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  BadgeDollarSign, Banknote, CreditCard, Minus, Plus, QrCode,
  Search, ShoppingCart, Trash2, X, CheckCircle2, Printer,
  ChevronDown, User, Keyboard, AlertCircle,
  UserPlus, UserCheck, Lock, Unlock, ArrowDownLeft, ArrowUpRight,
  FileText, TrendingDown, TrendingUp, Clock,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";

// ─── helpers ──────────────────────────────────────────────────────────────────

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function brlSplit(v: number) {
  const full = v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const value = full.replace(/^R\$\s*/i, "").trim();
  return { prefix: "R$", value };
}

// ─── types ────────────────────────────────────────────────────────────────────

interface Variant {
  id: string; // produto_embalagens.id
  produto_id: string; // products.id (pai)
  product_name: string; // products.name
  category: string;

  sigla_comercial: string;
  sigla_humanizada: string;
  volume_formatado: string | null;
  fator_conversao: number;
  unit_price: number; // preco_venda da embalagem

  codigo_interno: string | null;
  codigo_barras_ean: string | null;

  details: string | null; // embalagem.descricao
  tags: string | null;
  is_active: boolean;
  sales_count: number;
}
interface CartItem  { variant: Variant; qty: number }
type PayMethod = "pix"|"card"|"debit"|"cash"|"credit"|"boleto"|"cheque"|"promissoria";
interface PayLine   { id: string; method: PayMethod; value: string; received: string; due_date?: string }

interface CaixaInfo {
  id: string;
  opened_at: string;
  operator_name: string | null;
  initial_amount: number;
  total_in: number;
  total_out: number;
  balance_expected: number;
}

interface CustomerSummary {
  id: string; name: string|null; phone: string|null;
  limite_credito: number; saldo_devedor: number;
  enderecos?: Array<{ id:string; apelido:string; logradouro:string|null; numero:string|null; bairro:string|null }>;
}

const PAY: Record<PayMethod, { label:string; icon:React.ElementType; color:string; bg:string; prazo?:boolean }> = {
  pix:         { label:"PIX",         icon:QrCode,      color:"text-emerald-400", bg:"bg-emerald-900/30 border-emerald-700" },
  card:        { label:"Crédito",     icon:CreditCard,  color:"text-blue-400",   bg:"bg-blue-900/30 border-blue-700"       },
  debit:       { label:"Débito",      icon:CreditCard,  color:"text-sky-400",    bg:"bg-sky-900/30 border-sky-700"         },
  cash:        { label:"Dinheiro",    icon:Banknote,    color:"text-orange-400", bg:"bg-orange-900/30 border-orange-700"   },
  credit:      { label:"A Prazo",     icon:AlertCircle, color:"text-red-400",    bg:"bg-red-900/30 border-red-700",       prazo:true },
  boleto:      { label:"Boleto",      icon:FileText,    color:"text-cyan-400",   bg:"bg-cyan-900/30 border-cyan-700",     prazo:true },
  cheque:      { label:"Cheque",      icon:FileText,    color:"text-slate-400",  bg:"bg-slate-900/30 border-slate-700",   prazo:true },
  promissoria: { label:"Promissória", icon:FileText,    color:"text-amber-400",  bg:"bg-amber-900/30 border-amber-700",   prazo:true },
};

async function fetchCep(cep: string) {
  const clean = cep.replace(/\D/g,"");
  if (clean.length!==8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
    const d = await r.json();
    if (d.erro) return null;
    return { logradouro:d.logradouro, bairro:d.bairro, cidade:d.localidade, estado:d.uf };
  } catch { return null; }
}

function toYMD(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ─── F2 global key ─────────────────────────────────────────────────────────────

function useF2(cb: () => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "F2") { e.preventDefault(); ref.current(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function PDVPage() {
  const supabase     = useMemo(() => createClient(), []);
  const { currentCompanyId: companyId } = useWorkspace();
  const searchParams = useSearchParams();
  const fromOrderId  = searchParams.get("from_order");
  const [fromOrderBanner, setFromOrderBanner] = useState<string | null>(null);

  const [variants,    setVariants]    = useState<Variant[]>([]);
  const [loadingProd, setLoadingProd] = useState(true);
  const [search,      setSearch]      = useState("");
  const [activeCat,   setActiveCat]   = useState("Todos");
  const searchRef = useRef<HTMLInputElement>(null);

  const [cart,       setCart]       = useState<CartItem[]>([]);
  const [sellerName, setSellerName] = useState("");

  // ── customer selection ───────────────────────────────────────────────
  const [customerQuery,    setCustomerQuery]    = useState("");
  const [customerResults,  setCustomerResults]  = useState<CustomerSummary[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSummary|null>(null);
  const [showCustDrop,     setShowCustDrop]     = useState(false);
  const [showNewCust,      setShowNewCust]      = useState(false);
  const [custForm,         setCustForm]         = useState({ name:"", phone:"", cpf_cnpj:"", limite_credito:"0", cep:"", logradouro:"", numero:"", bairro:"", cidade:"", estado:"" });
  const [savingCust,       setSavingCust]       = useState(false);
  const [cepLoading,       setCepLoading]       = useState(false);
  const custSearchRef = useRef<HTMLInputElement>(null);

  // ── caixa ─────────────────────────────────────────────────────────────
  const [caixa,           setCaixa]           = useState<CaixaInfo | null>(null);
  const [caixaLoading,    setCaixaLoading]    = useState(true);
  const [showAbrirCaixa,  setShowAbrirCaixa]  = useState(false);
  const [showFecharCaixa, setShowFecharCaixa] = useState(false);
  const [showMovimento,   setShowMovimento]   = useState(false);
  const [movForm, setMovForm] = useState({ type: "sangria" as "sangria"|"suprimento", amount: "", reason: "" });
  const [abrirForm, setAbrirForm] = useState({ initial_amount: "200", operator: "" });
  const [fecharContagem, setFecharContagem] = useState("");
  const [caixaSubmitting, setCaixaSubmitting] = useState(false);

  // ── checkout ─────────────────────────────────────────────────────────
  const [showCheckout, setShowCheckout] = useState(false);
  const [payments,     setPayments]     = useState<PayLine[]>([{ id:"1", method:"pix", value:"", received:"" }]);
  const [autoPrint,    setAutoPrint]    = useState(true);
  const [finalizing,   setFinalizing]   = useState(false);
  const [saleOk,       setSaleOk]       = useState(false);

  // refs for smart payment UX
  const payInputRefs   = useRef<Record<string, HTMLInputElement | null>>({});
  const pendingFocusId = useRef<string | null>(null);
  const manuallyEdited = useRef(new Set<string>());

  // ── products ──────────────────────────────────────────────────────────────
  const loadVariants = useCallback(async () => {
    if (!companyId) return;
    setLoadingProd(true);
    const { data, error } = await supabase
      .from("view_pdv_produtos")
      .select("id, produto_id, descricao, fator_conversao, preco_venda, codigo_interno, codigo_barras_ean, tags, volume_quantidade, sigla_comercial, sigla_humanizada, volume_formatado, sales_count, product_name, product_unit_type, product_details, category_name")
      .eq("company_id", companyId);
    if (error) console.error("[pdv] loadVariants:", error.message);

    setVariants((data ?? []).map((r: any) => {
      const sigla = String(r.sigla_comercial ?? "UN").toUpperCase();
      return {
        id: String(r.id),
        produto_id: String(r.produto_id),
        product_name: r.product_name ?? "Produto",
        category: r.category_name ?? "Geral",

        sigla_comercial: sigla,
        sigla_humanizada: r.sigla_humanizada ?? sigla,
        volume_formatado: r.volume_formatado ?? null,
        fator_conversao: Number(r.fator_conversao ?? 1),
        unit_price: Number(r.preco_venda ?? 0),

        codigo_interno: r.codigo_interno ?? null,
        codigo_barras_ean: r.codigo_barras_ean ?? null,

        details: r.descricao ?? null,
        tags: r.tags ?? null,
        is_active: true,
        sales_count: Number(r.sales_count ?? 0),
      };
    }));
    setLoadingProd(false);
  }, [companyId, supabase]);

  // ── caixa ops ─────────────────────────────────────────────────────────────
  const loadCaixa = useCallback(async () => {
    if (!companyId) return;
    setCaixaLoading(true);
    const { data } = await supabase
      .from("cash_registers")
      .select("id, opened_at, operator_name, initial_amount")
      .eq("company_id", companyId)
      .eq("status", "open")
      .maybeSingle();

    if (!data) { setCaixa(null); setCaixaLoading(false); return; }

    // Totaliza entradas/saídas do dia via cash_movements + sales
    const [movRes, salesRes] = await Promise.all([
      supabase.from("cash_movements").select("type, amount").eq("cash_register_id", data.id),
      supabase.from("sale_payments")
        .select("amount, payment_method")
        .eq("company_id", companyId)
        .gte("created_at", data.opened_at),
    ]);

    const movements = (movRes.data ?? []) as { type: string; amount: number }[];
    const salePayments = (salesRes.data ?? []) as { amount: number; payment_method: string }[];

    const totalIn  = salePayments.filter(p => !["credit","boleto","cheque","promissoria","credit_installment"].includes(p.payment_method))
                                  .reduce((s, p) => s + Number(p.amount), 0)
                   + movements.filter(m => m.type === "suprimento").reduce((s, m) => s + Number(m.amount), 0)
                   + Number(data.initial_amount ?? 0);
    const totalOut = movements.filter(m => m.type === "sangria").reduce((s, m) => s + Number(m.amount), 0);

    setCaixa({ ...data, total_in: totalIn, total_out: totalOut, balance_expected: totalIn - totalOut });
    setCaixaLoading(false);
  }, [companyId, supabase]);

  const handleAbrirCaixa = async () => {
    if (!companyId) return;
    setCaixaSubmitting(true);
    const { error } = await supabase.from("cash_registers").insert({
      company_id:     companyId,
      operator_name:  abrirForm.operator.trim() || sellerName.trim() || null,
      initial_amount: parseFloat(abrirForm.initial_amount) || 0,
      status:         "open",
      opened_at:      new Date().toISOString(),
    });
    setCaixaSubmitting(false);
    if (error) { alert("Erro ao abrir caixa: " + error.message); return; }
    setShowAbrirCaixa(false);
    await loadCaixa();
  };

  const handleFecharCaixa = async () => {
    if (!caixa || !companyId) return;
    setCaixaSubmitting(true);
    const counted = parseFloat(fecharContagem) || 0;
    const { error } = await supabase.from("cash_registers").update({
      status:         "closed",
      closed_at:      new Date().toISOString(),
      closing_amount: counted,
      difference:     counted - caixa.balance_expected,
    }).eq("id", caixa.id);
    setCaixaSubmitting(false);
    if (error) { alert("Erro ao fechar caixa: " + error.message); return; }
    setShowFecharCaixa(false);
    setFecharContagem("");
    setCaixa(null);
  };

  const handleMovimento = async () => {
    if (!caixa || !companyId || !movForm.amount) return;
    setCaixaSubmitting(true);
    const { error } = await supabase.from("cash_movements").insert({
      cash_register_id: caixa.id,
      company_id:       companyId,
      type:             movForm.type,
      amount:           parseFloat(movForm.amount) || 0,
      reason:           movForm.reason.trim() || null,
      operator_name:    sellerName.trim() || null,
      occurred_at:      new Date().toISOString(),
    });
    setCaixaSubmitting(false);
    if (error) { alert("Erro: " + error.message); return; }
    setShowMovimento(false);
    setMovForm({ type: "sangria", amount: "", reason: "" });
    await loadCaixa();
  };

  useEffect(() => { loadVariants(); }, [loadVariants]);
  useEffect(() => { loadCaixa(); }, [loadCaixa]);
  useEffect(() => { if (!showCheckout) searchRef.current?.focus(); }, [showCheckout]);

  // Pré-carrega carrinho a partir de um pedido existente (botão "Fechar no PDV")
  useEffect(() => {
    if (!fromOrderId || !companyId || variants.length === 0) return;
    (async () => {
      const { data: items } = await supabase
        .from("order_items")
        .select("produto_embalagem_id, quantity, qty, product_name, unit_price")
        .eq("order_id", fromOrderId);
      if (!items || items.length === 0) return;
      const newCart: CartItem[] = [];
      for (const it of items as any[]) {
        const embId = it.produto_embalagem_id;
        const v = variants.find(v => v.id === embId);
        if (v) {
          newCart.push({ variant: v, qty: Number(it.quantity ?? it.qty ?? 1) });
        }
      }
      if (newCart.length > 0) {
        setCart(newCart);
        setFromOrderBanner(`Pedido #${fromOrderId.slice(-6).toUpperCase()}`);
      }
    })();
  }, [fromOrderId, companyId, variants, supabase]);

  // ── customer search (debounced) ──────────────────────────────────────
  useEffect(() => {
    const q = customerQuery.trim();
    if (!q || !companyId) { setCustomerResults([]); return; }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from("customers")
        .select("id,name,phone,limite_credito,saldo_devedor")
        .eq("company_id", companyId)
        .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
        .limit(8);
      setCustomerResults((data as CustomerSummary[]) ?? []);
    }, 280);
    return () => clearTimeout(timer);
  }, [customerQuery, companyId, supabase]);

  // creditAvailable / canUseCredit computed after cartTotal (line ~202)

  // ── CEP for new customer ─────────────────────────────────────────────
  const handleNewCustCep = async (val: string) => {
    setCustForm(p => ({ ...p, cep: val }));
    if (val.replace(/\D/g,"").length === 8) {
      setCepLoading(true);
      const d = await fetchCep(val);
      if (d) setCustForm(p => ({ ...p, logradouro: d.logradouro, bairro: d.bairro, cidade: d.cidade, estado: d.estado }));
      setCepLoading(false);
    }
  };

  // ── save new customer ────────────────────────────────────────────────
  const saveNewCustomer = async () => {
    if (!companyId || !custForm.name.trim() || !custForm.phone.trim()) return;
    setSavingCust(true);
    const { data, error } = await supabase.from("customers").insert({
      company_id:      companyId,
      name:            custForm.name.trim(),
      phone:           custForm.phone.trim(),
      cpf_cnpj:        custForm.cpf_cnpj.trim() || null,
      limite_credito:  parseFloat(custForm.limite_credito) || 0,
      origem:          "admin",
      address:         [custForm.logradouro, custForm.numero && `nº ${custForm.numero}`, custForm.bairro].filter(Boolean).join(", ") || null,
      neighborhood:    custForm.bairro || null,
    }).select("id,name,phone,limite_credito,saldo_devedor").single();
    setSavingCust(false);
    if (error) { alert("Erro: " + error.message); return; }
    const c = data as CustomerSummary;
    setSelectedCustomer(c);
    setCustomerQuery(c.name ?? "");
    setShowNewCust(false);
    setShowCustDrop(false);
    setCustForm({ name:"", phone:"", cpf_cnpj:"", limite_credito:"0", cep:"", logradouro:"", numero:"", bairro:"", cidade:"", estado:"" });
  };

  // ── derived ───────────────────────────────────────────────────────────────
  const categories = useMemo(() => ["Todos", ...[...new Set(variants.map(v => v.category))].sort()], [variants]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = variants.filter(v => {
      const mc = activeCat === "Todos" || v.category === activeCat;
      if (!q) return mc;

      const qDigits = q.replace(/\D/g, "");
      const internalOk = Boolean(v.codigo_interno) && String(v.codigo_interno).toLowerCase().includes(q);
      const eanRaw = v.codigo_barras_ean ?? "";
      const eanDigits = String(eanRaw).replace(/\D/g, "");
      const eanOk = qDigits.length >= 8 && eanDigits && eanDigits === qDigits;

      const textOk =
        v.product_name.toLowerCase().includes(q) ||
        (v.details?.toLowerCase().includes(q) ?? false) ||
        (v.tags?.toLowerCase().includes(q) ?? false);

      return mc && (internalOk || eanOk || textOk);
    });
    return [...list].sort((a, b) => (b.sales_count ?? 0) - (a.sales_count ?? 0));
  }, [variants, search, activeCat]);

  const cartTotal = useMemo(() => cart.reduce((s, i) => s + i.variant.unit_price * i.qty, 0), [cart]);

  // Default para quando a linha "credit" (A Prazo) for selecionada
  const creditDefaultDue = useMemo(() => toYMD(new Date(Date.now() + 30 * 86400000)), []);

  // ── credit availability (depends on cartTotal) ───────────────────────
  const creditAvailable = selectedCustomer
    ? Math.max(0, selectedCustomer.limite_credito - selectedCustomer.saldo_devedor)
    : 0;
  const canUseCredit = creditAvailable >= cartTotal && cartTotal > 0;
  const cartCount = useMemo(() => cart.reduce((s, i) => s + i.qty, 0), [cart]);

  // ── cart ops ─────────────────────────────────────────────────────────────
  const addToCart = useCallback((v: Variant) => setCart(p => {
    const ex = p.find(i => i.variant.id === v.id);
    return ex ? p.map(i => i.variant.id === v.id ? {...i, qty: i.qty+1} : i) : [...p, {variant:v, qty:1}];
  }), []);

  const changeQty = useCallback((id: string, d: number) =>
    setCart(p => p.map(i => i.variant.id===id ? {...i,qty:Math.max(0,i.qty+d)} : i).filter(i=>i.qty>0)), []);

  const rmFromCart = useCallback((id: string) => setCart(p => p.filter(i => i.variant.id !== id)), []);

  const handleEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && filtered.length > 0) addToCart(filtered[0]);
  };

  // ── payments ─────────────────────────────────────────────────────────────
  const payTotal    = useMemo(() => payments.reduce((s,p) => s + (parseFloat(p.value)||0), 0), [payments]);
  const remaining   = useMemo(() => Math.max(0, cartTotal - payTotal), [cartTotal, payTotal]);
  const canFinalize = payTotal >= cartTotal && cartTotal > 0 && !finalizing && !!caixa;

  // Auto-focus newly added payment input after state update
  useEffect(() => {
    if (!pendingFocusId.current) return;
    const id = pendingFocusId.current;
    const el = payInputRefs.current[id];
    if (el) { el.focus(); el.select(); pendingFocusId.current = null; }
  }, [payments]);

  const addPayLine = () => {
    const used = new Set(payments.map(p => p.method));
    const vistaOptions: PayMethod[] = (["pix","card","debit","cash"] as PayMethod[]).filter(m => !used.has(m));
    const prazoOptions: PayMethod[] = selectedCustomer
      ? (["credit","boleto","cheque","promissoria"] as PayMethod[]).filter(m => !used.has(m))
      : [];
    const allMethods: PayMethod[] = [...vistaOptions, ...prazoOptions];
    const next = allMethods[0];
    if (!next) return;
    const newId      = Date.now().toString();
    const alreadySum = payments.reduce((s, p) => s + (parseFloat(p.value) || 0), 0);
    const autoVal    = Math.max(0, cartTotal - alreadySum).toFixed(2);
    pendingFocusId.current = newId;
    setPayments(p => [
      ...p,
      {
        id: newId,
        method: next,
        value: autoVal,
        received: "",
        due_date: next === "credit" ? (creditDefaultDue ?? toYMD(new Date(Date.now() + 30 * 86400000))) : undefined,
      },
    ]);
  };

  const updPay = (id: string, f: keyof PayLine, v: string) => {
    if (f === "method") {
      const nextMethod = v as PayLine["method"];
      setPayments(p =>
        p.map(x => {
          if (x.id !== id) return x;
          if (nextMethod === "credit") {
            return { ...x, method: nextMethod, due_date: x.due_date ?? creditDefaultDue };
          }
          return { ...x, method: nextMethod, due_date: undefined };
        })
      );
      return;
    }

    if (f === "value") {
      manuallyEdited.current.add(id);
      // With exactly 2 lines, auto-adjust the peer if it hasn't been manually touched
      if (payments.length === 2) {
        const peer = payments.find(p => p.id !== id);
        if (peer && !manuallyEdited.current.has(peer.id)) {
          const peerVal = Math.max(0, cartTotal - (parseFloat(v) || 0)).toFixed(2);
          setPayments(p => p.map(x =>
            x.id === id   ? { ...x, value: v }         :
            x.id === peer.id ? { ...x, value: peerVal } : x
          ));
          return;
        }
      }
    }
    setPayments(p => p.map(x => x.id === id ? { ...x, [f]: v } : x));
  };

  const rmPay = (id: string) => {
    if (payments.length > 1) {
      manuallyEdited.current.delete(id);
      setPayments(p => p.filter(x => x.id !== id));
    }
  };

  const cashLine = payments.find(p => p.method==="cash");
  const cashVal  = parseFloat(cashLine?.value    || "0") || 0;
  const cashRec  = parseFloat(cashLine?.received || "0") || 0;
  const change   = cashRec > cashVal ? cashRec - cashVal : 0;

  const openCheckout = useCallback(() => {
    if (cart.length === 0) return;
    manuallyEdited.current.clear();
    pendingFocusId.current = null;
    setPayments([{ id: "1", method: "pix", value: cartTotal.toFixed(2), received: "" }]);
    setSaleOk(false);
    setShowCheckout(true);
  }, [cart.length, cartTotal]);

  const closeSaleAndReset = () => {
    setShowCheckout(false); setSaleOk(false);
    setSelectedCustomer(null); setCustomerQuery("");
    setTimeout(() => searchRef.current?.focus(), 100);
  };

  // F2 opens checkout
  useF2(openCheckout);

  // ── finalize ──────────────────────────────────────────────────────────────
  const finalize = async () => {
    if (!companyId || !canFinalize) return;
    const PRAZO_METHODS: PayMethod[] = ["credit","boleto","cheque","promissoria"];
    const hasCreditPayment = payments.some(p => PRAZO_METHODS.includes(p.method));
    if (hasCreditPayment && !selectedCustomer) {
      alert("Selecione um cliente para usar pagamento a prazo."); return;
    }
    if (!caixa) {
      alert("Abra o caixa antes de finalizar uma venda."); return;
    }
    setFinalizing(true);
    try {
      const primary = [...payments].sort((a,b)=>(parseFloat(b.value)||0)-(parseFloat(a.value)||0))[0];
      const isPaid = !hasCreditPayment;

      // payment_method normalizado: prazo genérico → subtipo
      const normMethod = (m: PayMethod): string => {
        if (m === "credit") return "credit_installment";
        return m;
      };

      // 1. Criar sale (registro financeiro da venda)
      const { data: sale, error: saleErr } = await supabase.from("sales").insert({
        company_id:       companyId,
        cash_register_id: caixa?.id ?? null,
        customer_id:      selectedCustomer?.id ?? null,
        seller_name:      sellerName || null,
        origin:           "pdv",
        subtotal:         cartTotal,
        total:            cartTotal,
        status:           isPaid ? "paid" : "partial",
        notes:            sellerName ? `Balcão — ${sellerName}` : "Balcão",
      }).select("id").single();
      if (saleErr) throw new Error(saleErr.message);
      const saleId = sale.id;

      // 2. sale_items (snapshot de custo zero — sem controle de estoque ainda)
      const { error: saleItemErr } = await supabase.from("sale_items").insert(cart.map(i => ({
        sale_id:             saleId,
        company_id:          companyId,
        produto_embalagem_id: i.variant.id,
        product_name:        `${i.variant.product_name}${i.variant.details ? " " + i.variant.details : ""}`,
        qty:                 i.qty,
        unit_price:          i.variant.unit_price,
        unit_cost:           0,
      })));
      if (saleItemErr) console.error("[pdv] sale_items:", saleItemErr.message);

      // 3. sale_payments — dispara trigger que cria bills para pagamentos a prazo
      const { error: salePayErr } = await supabase.from("sale_payments").insert(payments.map(p => ({
        sale_id:        saleId,
        company_id:     companyId,
        payment_method: normMethod(p.method),
        amount:         parseFloat(p.value) || 0,
        due_date:       p.due_date ? new Date(p.due_date + "T12:00:00").toISOString() : null,
        received_at:    !PAY[p.method].prazo ? new Date().toISOString() : null,
      })));
      if (salePayErr) console.error("[pdv] sale_payments:", salePayErr.message);

      // 4. Pedido legado (orders) linkado ao sale — mantém compatibilidade com impressão e pedidos
      const { data: order, error: ordErr } = await supabase.from("orders").insert({
        company_id:     companyId,
        sale_id:        saleId,
        source:         "pdv",
        customer_id:    selectedCustomer?.id ?? null,
        customer_name:  selectedCustomer?.name ?? (sellerName ? `[Balcão] ${sellerName}` : "Balcão"),
        total:          cartTotal,
        total_amount:   cartTotal,
        delivery_fee:   0,
        payment_method: primary?.method ?? "pix",
        status:         "finalized",
        channel:        "balcao",
        paid:           isPaid,
        confirmed_at:   new Date().toISOString(),
      }).select("id").single();
      if (ordErr) throw new Error(ordErr.message);
      const oid = order.id;

      // 5. order_items (line_total é coluna GENERATED — não enviar)
      const { error: itemErr } = await supabase.from("order_items").insert(cart.map(i => ({
        company_id:           companyId,
        order_id:             oid,
        product_id:           i.variant.produto_id,
        produto_embalagem_id: i.variant.id,
        product_name:         `${i.variant.product_name}${i.variant.details ? " " + i.variant.details : ""}`,
        quantity:             i.qty,
        qty:                  i.qty,
        unit_type:            String(i.variant.sigla_comercial ?? "").toUpperCase() === "CX" ? "case" : "unit",
        unit_price:           i.variant.unit_price,
      })));
      if (itemErr) console.error("[pdv] order_items:", itemErr.message);

      // 6. financial_entries para dashboard legado (sale_id evita duplicação pelo trigger)
      const { error: finErr } = await supabase.from("financial_entries").insert(payments.map(p => ({
        company_id:     companyId,
        order_id:       oid,
        sale_id:        saleId,
        type:           "income",
        amount:         parseFloat(p.value) || 0,
        delivery_fee:   0,
        payment_method: normMethod(p.method),
        origin:         "balcao",
        description:    `Venda PDV${sellerName ? " — " + sellerName : ""}`,
        occurred_at:    new Date().toISOString(),
        status:         PAY[p.method].prazo ? "pending" : "received",
        due_date:       p.due_date ? new Date(p.due_date + "T12:00:00").toISOString() : null,
        received_at:    !PAY[p.method].prazo ? new Date().toISOString() : null,
      })));
      if (finErr) console.error("[pdv] financial_entries:", finErr.message);

      if (autoPrint) {
        // Electron (desktop): impressão direta via IPC
        if (typeof window !== "undefined" && (window as any).electronAPI?.printOrder) {
          try {
            (window as any).electronAPI.printOrder({
              orderId: oid, total: cartTotal, change, seller: sellerName,
              items:    cart.map(i => ({ name: `${i.variant.product_name} ${i.variant.details ?? ""}`.trim(), qty: i.qty, price: i.variant.unit_price })),
              payments: payments.map(p => ({ method: PAY[p.method].label, value: parseFloat(p.value) || 0 })),
            });
          } catch(e) { console.warn("[pdv] electron print:", e); }
        }
        // Fallback web: envia para fila do Print Agent (funciona sem Electron)
        try {
          await fetch("/api/agent/reprint", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ order_id: oid }),
          });
        } catch(e) { console.warn("[pdv] agent reprint:", e); }
      }
      setSaleOk(true);
      setCart([]);
      loadCaixa();
    } catch(err:any) {
      alert("Erro ao finalizar: "+err.message);
    } finally { setFinalizing(false); }
  };

  const closeSale = closeSaleAndReset;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    /* Root: full viewport, dark mode ativado */
    <div className="dark fixed inset-0 left-60 flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden z-10">

      {/* ── Caixa status bar ──────────────────────────────────────────── */}
      {!caixaLoading && (
        <div className={`flex shrink-0 items-center gap-3 border-b px-4 py-1.5 text-xs ${
          caixa
            ? "border-emerald-900/50 bg-emerald-950/40"
            : "border-red-900/50 bg-red-950/40"
        }`}>
          {caixa ? (
            <>
              <Unlock className="h-3 w-3 text-emerald-400 shrink-0" />
              <span className="text-emerald-300 font-semibold">Caixa aberto</span>
              {caixa.operator_name && <span className="text-zinc-500">· {caixa.operator_name}</span>}
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-400">
                {new Date(caixa.opened_at).toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" })}
              </span>
              <span className="ml-auto flex items-center gap-3">
                <span className="flex items-center gap-1 text-emerald-400">
                  <TrendingUp className="h-3 w-3" />
                  {caixa.total_in.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}
                </span>
                {caixa.total_out > 0 && (
                  <span className="flex items-center gap-1 text-red-400">
                    <TrendingDown className="h-3 w-3" />
                    {caixa.total_out.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}
                  </span>
                )}
                <span className="font-bold text-zinc-200">
                  Saldo: {caixa.balance_expected.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}
                </span>
                <button onClick={() => setShowMovimento(true)}
                  className="flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-zinc-400 hover:border-orange-600 hover:text-orange-400 transition-colors">
                  <ArrowDownLeft className="h-2.5 w-2.5" /> Sangria / Suprimento
                </button>
                <button onClick={() => setShowFecharCaixa(true)}
                  className="flex items-center gap-1 rounded-md border border-red-800 bg-red-950/40 px-2 py-0.5 text-red-400 hover:bg-red-900/40 transition-colors">
                  <Lock className="h-2.5 w-2.5" /> Fechar caixa
                </button>
              </span>
            </>
          ) : (
            <>
              <Lock className="h-3 w-3 text-red-400 shrink-0" />
              <span className="text-red-300 font-semibold">Caixa fechado</span>
              <span className="text-zinc-500">— finalizações bloqueadas</span>
              <button onClick={() => setShowAbrirCaixa(true)}
                className="ml-auto flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-0.5 font-semibold text-white hover:bg-emerald-500 transition-colors">
                <Unlock className="h-3 w-3" /> Abrir caixa
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Top bar (compact) ─────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900 px-4 py-2">
        {/* Brand */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-500">
            <ShoppingCart className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="hidden text-sm font-bold text-zinc-100 sm:block">PDV</span>
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-lg">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
          <input
            ref={searchRef} autoFocus
            value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={handleEnter}
            placeholder="Nome, código… Enter = add 1º"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-1.5 pl-8 pr-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-orange-500 focus:outline-none"
          />
        </div>

        {/* Seller */}
        <div className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 shrink-0">
          <User className="h-3 w-3 text-zinc-500" />
          <input value={sellerName} onChange={e=>setSellerName(e.target.value)}
            placeholder="Operador"
            className="w-24 bg-transparent text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none" />
        </div>

        {/* Hint */}
        <div className="hidden items-center gap-1 text-[10px] text-zinc-600 xl:flex shrink-0">
          <Keyboard className="h-3 w-3" />
          <span className="text-orange-400 font-bold">F2</span>
          <span>= Finalizar</span>
        </div>

        {/* Banner: fechando pedido existente */}
        {fromOrderBanner && (
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-700 bg-emerald-950/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 shrink-0">
            <ShoppingCart className="h-3 w-3" />
            Fechando {fromOrderBanner}
          </div>
        )}
      </header>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* ── Left: products ───────────────────────────────────────────── */}
        <div className="flex flex-1 flex-col overflow-hidden border-r border-zinc-800 min-w-0">

          {/* Category tabs — single-line scrollable strip */}
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-800 bg-zinc-900/80 px-3 py-1.5 scrollbar-hide">
            {categories.map(cat => (
              <button key={cat} onClick={()=>setActiveCat(cat)}
                className={`shrink-0 rounded-md px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                  activeCat===cat ? "bg-orange-500 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                }`}>
                {cat}
              </button>
            ))}
          </div>

          {/* Product grid — only this area scrolls */}
          <div className="flex-1 overflow-y-auto p-3 min-h-0">
            {loadingProd ? (
              <div className="grid grid-cols-5 gap-2">
                {Array.from({length:15}).map((_,i)=>(
                  <div key={i} className="h-28 animate-pulse rounded-xl bg-zinc-800" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-zinc-700">
                <Search className="h-8 w-8" />
                <p className="text-xs">Sem resultados.</p>
              </div>
            ) : (
              <div className="grid grid-cols-5 gap-2">
                {filtered.map(v => {
                  const inCart = cart.find(c => c.variant.id === v.id);
                  const isPack = ["CX","FARD","PAC"].includes(v.sigla_comercial);
                  const qtdLabel = isPack ? `${v.fator_conversao} un` : null;
                  return (
                    <button key={v.id} onClick={()=>addToCart(v)}
                      className={`group relative flex flex-col rounded-xl border p-3 text-left transition-all duration-300 active:scale-95 hover:-translate-y-0.5 hover:shadow-lg ${
                        inCart
                          ? "border-orange-500/60 bg-orange-950/30 shadow-[0_0_12px_rgba(249,115,22,0.2)]"
                          : "border-zinc-700 bg-zinc-800/60 hover:border-zinc-600 hover:bg-zinc-800"
                      }`}>
                      {inCart && (
                        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] font-black text-white">
                          {inCart.qty}
                        </span>
                      )}
                      <p className="text-base font-semibold text-zinc-100 line-clamp-2 leading-tight capitalize">
                        {v.product_name}
                      </p>
                      {v.volume_formatado && (
                        <p className="mt-1 text-xs font-normal text-zinc-400 opacity-90 leading-none">{v.volume_formatado}</p>
                      )}
                      {v.details && !v.volume_formatado && (
                        <p className="mt-1 text-xs font-normal text-zinc-400 opacity-90 leading-none truncate">{v.details}</p>
                      )}
                      <div className="mt-1 flex flex-wrap gap-x-1.5 text-xs font-normal text-zinc-400 opacity-[0.7]">
                        <span>{v.sigla_humanizada}</span>
                        {qtdLabel && <span>• {qtdLabel}</span>}
                      </div>
                      <div className="mt-auto flex items-center justify-between pt-2">
                        <span className="text-sm font-semibold">
                          <span className="text-zinc-500 text-xs font-medium">{brlSplit(v.unit_price).prefix} </span>
                          <span className="text-orange-400">{brlSplit(v.unit_price).value}</span>
                        </span>
                        <div className={`flex h-5 w-5 items-center justify-center rounded-md transition-colors ${
                          inCart ? "bg-orange-500 text-white" : "bg-zinc-700 text-zinc-400 group-hover:bg-orange-500 group-hover:text-white"
                        }`}>
                          <Plus className="h-3 w-3" />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: cart — full height, nothing scrolls except items list ── */}
        <div className="flex w-72 shrink-0 flex-col bg-zinc-900 min-h-0">

          {/* Cart header */}
          <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2">
            <ShoppingCart className="h-3.5 w-3.5 text-orange-400" />
            <p className="text-xs font-bold text-zinc-100">Cupom</p>
            {cartCount > 0 && (
              <span className="ml-auto rounded-full bg-orange-500 px-1.5 py-0.5 text-[9px] font-black text-white">
                {cartCount} it.
              </span>
            )}
          </div>

          {/* Customer selector */}
          <div className="relative shrink-0 border-b border-zinc-800 px-2 py-2">
            {selectedCustomer ? (
              <div className="flex items-center gap-2 rounded-xl bg-violet-900/30 border border-violet-700 px-2 py-1.5">
                <UserCheck className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-violet-200 truncate">{selectedCustomer.name}</p>
                  {selectedCustomer.limite_credito > 0 && (
                    <p className={`text-[9px] ${creditAvailable > 0 ? "text-emerald-400" : "text-red-400"}`}>
                      Crédito: {creditAvailable.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})} disp.
                    </p>
                  )}
                </div>
                <button onClick={() => { setSelectedCustomer(null); setCustomerQuery(""); }}
                  className="text-zinc-500 hover:text-red-400">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-600 pointer-events-none" />
                <input ref={custSearchRef}
                  value={customerQuery} onFocus={() => setShowCustDrop(true)}
                  onChange={e => { setCustomerQuery(e.target.value); setShowCustDrop(true); }}
                  onBlur={() => setTimeout(() => setShowCustDrop(false), 200)}
                  placeholder="Buscar cliente…"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-800 py-1.5 pl-7 pr-2 text-[11px] text-zinc-300 placeholder-zinc-600 focus:border-violet-500 focus:outline-none" />
              </div>
            )}

            {/* Dropdown */}
            {showCustDrop && !selectedCustomer && (
              <div className="absolute left-2 right-2 top-full z-40 mt-1 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
                {customerResults.map(c => (
                  <button key={c.id} onMouseDown={() => { setSelectedCustomer(c); setCustomerQuery(c.name ?? ""); setShowCustDrop(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800">
                    <User className="h-3 w-3 shrink-0 text-violet-400" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-zinc-200 truncate">{c.name ?? "—"}</p>
                      <p className="text-[9px] text-zinc-500">{c.phone}</p>
                    </div>
                    {c.limite_credito > 0 && (
                      <span className="ml-auto shrink-0 rounded-full bg-violet-900/40 px-1.5 text-[9px] text-violet-400">
                        Crédito
                      </span>
                    )}
                  </button>
                ))}
                <button onMouseDown={() => { setShowCustDrop(false); setShowNewCust(true); }}
                  className="flex w-full items-center gap-2 border-t border-zinc-800 px-3 py-2 text-left hover:bg-zinc-800">
                  <UserPlus className="h-3 w-3 text-orange-400" />
                  <span className="text-[11px] text-orange-400 font-medium">+ Cadastrar novo cliente</span>
                </button>
              </div>
            )}
          </div>

          {/* Items — only this scrolls */}
          <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-zinc-800/60 px-2">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-zinc-700">
                <ShoppingCart className="h-8 w-8" />
                <p className="text-[11px]">Carrinho vazio</p>
              </div>
            ) : (
              cart.map(item => (
                <div key={item.variant.id} className="flex items-center gap-1.5 py-2 px-0.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium text-zinc-200 truncate leading-tight">
                      {item.variant.product_name}
                      {item.variant.details && <span className="text-zinc-500"> · {item.variant.details}</span>}
                    </p>
                    <p className="text-[9px] text-zinc-500">{brl(item.variant.unit_price)}/un</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button onClick={()=>changeQty(item.variant.id,-1)}
                      className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-orange-400">
                      <Minus className="h-2.5 w-2.5" />
                    </button>
                    <span className="w-6 text-center text-xs font-bold text-zinc-100">{item.qty}</span>
                    <button onClick={()=>changeQty(item.variant.id,+1)}
                      className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-orange-400">
                      <Plus className="h-2.5 w-2.5" />
                    </button>
                  </div>
                  <p className="w-14 shrink-0 text-right text-xs font-bold text-orange-400">
                    {brl(item.variant.unit_price * item.qty)}
                  </p>
                  <button onClick={()=>rmFromCart(item.variant.id)}
                    className="shrink-0 rounded-md p-0.5 text-zinc-600 hover:text-red-400">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* ── Footer: always pinned to bottom ─────────────────────────── */}
          <div className="shrink-0 border-t border-zinc-800 p-3 space-y-2">
            {/* Total */}
            <div className="flex items-center justify-between rounded-xl bg-zinc-800/60 px-3 py-2">
              <span className="text-xs text-zinc-400 font-medium">Total</span>
              <span className="text-3xl font-black tracking-tight text-zinc-50 tabular-nums">
                {brl(cartTotal)}
              </span>
            </div>

            {/* Clear cart */}
            {cart.length > 0 && (
              <button onClick={()=>setCart([])}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-700 py-1.5 text-[11px] text-zinc-500 hover:border-red-800 hover:text-red-400 transition-colors">
                <Trash2 className="h-3 w-3" /> Limpar
              </button>
            )}

            {/* Finalize — F2 */}
            {!caixa && !caixaLoading ? (
              <button onClick={() => setShowAbrirCaixa(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-black text-white hover:bg-emerald-500 transition-all active:scale-95">
                <Unlock className="h-4 w-4" />
                Abrir caixa para vender
              </button>
            ) : (
              <button onClick={openCheckout} disabled={cart.length===0 || !caixa}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-3 text-sm font-black text-white shadow-[0_0_18px_rgba(249,115,22,0.45)] transition-all hover:bg-orange-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-25">
                <BadgeDollarSign className="h-4 w-4" />
                Finalizar
                <kbd className="ml-auto rounded bg-orange-400/40 px-1.5 py-0.5 text-[10px] font-bold">F2</kbd>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────
          CHECKOUT MODAL
      ───────────────────────────────────────────────────────────────────── */}
      {/* ── Novo Cliente Modal ─────────────────────────────────────────── */}
      {showNewCust && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden">
            <div className="flex items-center gap-3 border-b border-zinc-800 px-5 py-3.5">
              <UserPlus className="h-4 w-4 text-orange-400" />
              <p className="font-bold text-zinc-100 text-sm">Cadastrar Cliente</p>
              <button onClick={() => setShowNewCust(false)} className="ml-auto text-zinc-500 hover:text-zinc-200"><X className="h-4 w-4" /></button>
            </div>
            <div className="overflow-y-auto max-h-[70vh] p-5 space-y-3">
              {[
                { label:"Nome *",    field:"name",      type:"text",   placeholder:"Nome completo" },
                { label:"WhatsApp *",field:"phone",     type:"text",   placeholder:"+55 66 9…" },
                { label:"CPF/CNPJ",  field:"cpf_cnpj",  type:"text",   placeholder:"000.000.000-00" },
              ].map(({ label, field, type, placeholder }) => (
                <div key={field}>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{label}</label>
                  <input type={type} value={(custForm as any)[field]}
                    onChange={e => setCustForm(p => ({ ...p, [field]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-orange-500 focus:outline-none" />
                </div>
              ))}
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Limite de Crédito (Fiado)</label>
                <div className="flex items-center overflow-hidden rounded-xl border border-zinc-700 bg-zinc-800">
                  <span className="px-3 text-xs text-zinc-500">R$</span>
                  <input type="number" min={0} value={custForm.limite_credito}
                    onChange={e => setCustForm(p => ({ ...p, limite_credito: e.target.value }))}
                    className="flex-1 bg-transparent py-2 pr-3 text-sm text-zinc-100 focus:outline-none" />
                </div>
              </div>
              <div className="border-t border-zinc-800 pt-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  CEP {cepLoading && <span className="text-orange-400">(buscando…)</span>}
                </p>
                <input value={custForm.cep} onChange={e => handleNewCustCep(e.target.value)}
                  maxLength={9} placeholder="00000-000"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-orange-500 focus:outline-none mb-2" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={custForm.logradouro} onChange={e => setCustForm(p => ({ ...p, logradouro: e.target.value }))}
                    placeholder="Logradouro"
                    className="col-span-2 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-orange-500 focus:outline-none" />
                  <input value={custForm.numero} onChange={e => setCustForm(p => ({ ...p, numero: e.target.value }))}
                    placeholder="Número"
                    className="rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-orange-500 focus:outline-none" />
                  <input value={custForm.bairro} onChange={e => setCustForm(p => ({ ...p, bairro: e.target.value }))}
                    placeholder="Bairro"
                    className="rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-orange-500 focus:outline-none" />
                </div>
              </div>
            </div>
            <div className="border-t border-zinc-800 px-5 py-3.5 flex gap-3">
              <button onClick={() => setShowNewCust(false)} className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">Cancelar</button>
              <button onClick={saveNewCustomer} disabled={savingCust || !custForm.name.trim() || !custForm.phone.trim()}
                className="flex-1 rounded-xl bg-orange-500 py-2.5 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-40 transition-all">
                {savingCust ? "Salvando…" : "Cadastrar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCheckout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="relative flex w-full max-w-md flex-col rounded-3xl border border-zinc-700 bg-zinc-900 shadow-2xl max-h-[92vh] overflow-hidden">

            {/* Modal header */}
            <div className="flex shrink-0 items-center gap-3 border-b border-zinc-800 px-5 py-3.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-500/20 text-orange-400">
                <BadgeDollarSign className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-zinc-100">Finalizar Venda</p>
                <p className="text-[11px] text-zinc-500">
                  {cart.length} {cart.length===1?"item":"itens"} · <span className="text-orange-400 font-bold">{brl(cartTotal)}</span>
                </p>
              </div>
              <button onClick={()=>{setShowCheckout(false);setSaleOk(false);}}
                className="rounded-lg p-1 text-zinc-500 hover:text-zinc-200">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Scrollable body */}
            {saleOk ? (
              /* ── Success ── */
              <div className="flex flex-col items-center gap-4 px-8 py-10">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-900/40 ring-4 ring-emerald-500/30">
                  <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                </div>
                <p className="text-lg font-bold text-zinc-100">Venda Finalizada!</p>
                {change > 0 && (
                  <div className="w-full rounded-2xl border border-orange-700 bg-orange-950/40 px-6 py-3 text-center">
                    <p className="text-xs text-orange-400 font-medium mb-0.5">Troco</p>
                    <p className="text-4xl font-black text-orange-400">{brl(change)}</p>
                  </div>
                )}
                <button onClick={closeSale}
                  className="flex items-center gap-2 rounded-xl bg-orange-500 px-8 py-2.5 text-sm font-bold text-white hover:bg-orange-600">
                  <Plus className="h-4 w-4" /> Nova venda
                </button>
              </div>
            ) : (
              <div className="overflow-y-auto flex-1 min-h-0">
                {/* Summary */}
                <div className="border-b border-zinc-800 px-5 py-3">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Resumo</p>
                  <div className="max-h-28 overflow-y-auto space-y-0.5">
                    {cart.map(i => (
                      <div key={i.variant.id} className="flex justify-between text-xs">
                        <span className="text-zinc-400">{i.qty}× {i.variant.product_name}{i.variant.details?" "+i.variant.details:""}</span>
                        <span className="font-medium text-zinc-200">{brl(i.variant.unit_price*i.qty)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t border-zinc-800 pt-2">
                    <span className="text-xs text-zinc-400">Total</span>
                    <span className="text-xl font-black text-orange-400">{brl(cartTotal)}</span>
                  </div>
                </div>

                {/* Payment lines */}
                <div className="px-5 py-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Formas de pagamento</p>
                    {payments.length < 3 && (
                      <button onClick={addPayLine}
                        className="flex items-center gap-1 rounded-lg bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-700">
                        <Plus className="h-2.5 w-2.5" /> Adicionar
                      </button>
                    )}
                  </div>

                  {payments.map(pay => {
                    const cfg = PAY[pay.method];
                    const Icon = cfg.icon;
                    return (
                      <div key={pay.id} className={`rounded-2xl border p-3 space-y-2 ${cfg.bg}`}>
                        <div className="flex items-center gap-2">
                          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-zinc-900 ${cfg.color}`}>
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          <div className="relative">
                            <select value={pay.method}
                              onChange={e=>updPay(pay.id,"method",e.target.value as PayMethod)}
                              className="appearance-none rounded-lg bg-zinc-900/60 pl-2.5 pr-6 py-1 text-xs font-medium text-zinc-200 border border-zinc-700 focus:outline-none">
                              {(["pix","card","debit","cash",
                                 ...(selectedCustomer ? ["credit","boleto","cheque","promissoria"] : [])] as PayMethod[])
                                .filter(m => m === pay.method || !payments.some(p => p.id !== pay.id && p.method === m))
                                .map(m => <option key={m} value={m}>{PAY[m].label}</option>)}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-500" />
                          </div>
                          <div className="flex flex-1 items-center overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900/60 focus-within:border-orange-500/70 transition-colors">
                            <span className="px-2 text-[11px] text-zinc-500">R$</span>
                            <input
                              ref={el => { payInputRefs.current[pay.id] = el; }}
                              type="number" min={0} step={0.01} value={pay.value}
                              onChange={e => updPay(pay.id, "value", e.target.value)}
                              className="flex-1 bg-transparent py-1 pr-2 text-sm font-bold text-zinc-100 focus:outline-none min-w-0"
                              placeholder="0,00" />
                          </div>
                          {payments.length>1 && (
                            <button onClick={()=>rmPay(pay.id)} className="text-zinc-600 hover:text-red-400">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        {PAY[pay.method].prazo && (
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                              Vencimento {!selectedCustomer && <span className="text-red-400">(cliente obrigatório)</span>}
                            </label>
                            <input
                              type="date"
                              value={pay.due_date ?? creditDefaultDue}
                              onChange={(e) => updPay(pay.id, "due_date" as keyof PayLine, e.target.value)}
                              className="w-full rounded-lg bg-zinc-900/60 border border-zinc-700 px-2 py-1.5 text-xs font-medium text-zinc-200 focus:outline-none focus:border-orange-500"
                            />
                          </div>
                        )}

                        {pay.method==="cash" && (
                          <div className="space-y-1.5">
                            <div className="flex items-center overflow-hidden rounded-xl border border-orange-700/50 bg-zinc-900/80">
                              <span className="px-2 text-[11px] text-zinc-500">Recebido R$</span>
                              <input type="number" min={0} step={0.01} value={pay.received}
                                onChange={e=>updPay(pay.id,"received",e.target.value)}
                                className="flex-1 bg-transparent py-1.5 pr-2 text-sm font-bold text-zinc-100 focus:outline-none"
                                placeholder="valor entregue" />
                            </div>
                            {cashRec > 0 && (
                              <div className={`flex items-center justify-between rounded-xl px-3 py-1.5 ${change>=0?"bg-orange-950/50 border border-orange-700/50":"bg-red-950/50 border border-red-700/50"}`}>
                                <span className="text-xs text-zinc-400">Troco</span>
                                <span className={`text-3xl font-black ${change>=0?"text-orange-400":"text-red-400"}`}>
                                  {brl(change)}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Credit warning */}
                {payments.some(p => PAY[p.method].prazo) && selectedCustomer && (
                  <div className="flex items-start gap-2 rounded-xl bg-red-900/20 border border-red-700/50 px-3 py-2">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400 mt-0.5" />
                    <div>
                      <p className="text-[11px] font-semibold text-red-300">Venda a prazo — {selectedCustomer.name}</p>
                      <p className="text-[10px] text-zinc-500">
                        Saldo devedor atual: {brl(selectedCustomer.saldo_devedor)} · Limite: {brl(selectedCustomer.limite_credito)}
                      </p>
                    </div>
                  </div>
                )}
                {payments.some(p => PAY[p.method].prazo) && !selectedCustomer && (
                  <p className="text-[11px] text-red-400">⚠ Selecione um cliente para formas a prazo.</p>
                )}

                {/* Remaining — red while unpaid, green when covered */}
                  <div className={`flex items-center justify-between rounded-2xl px-3 py-2.5 transition-all ${
                    remaining <= 0
                      ? "bg-emerald-900/20 border border-emerald-700/40"
                      : "bg-red-950/30 border border-red-700/50"
                  }`}>
                    <span className="text-xs text-zinc-400">Saldo restante</span>
                    <span className={`text-base font-black transition-colors ${remaining <= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {remaining <= 0 ? "✓ Coberto" : `Faltam ${brl(remaining)}`}
                    </span>
                  </div>
                </div>

                {/* Auto-print toggle */}
                <div className="border-t border-zinc-800 px-5 py-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <button type="button" onClick={()=>setAutoPrint(v=>!v)}
                      className={`relative h-5 w-9 rounded-full transition-colors ${autoPrint?"bg-orange-500":"bg-zinc-700"}`}>
                      <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${autoPrint?"translate-x-4":"translate-x-0.5"}`} />
                    </button>
                    <Printer className="h-3.5 w-3.5 text-zinc-400" />
                    <span className="text-xs text-zinc-400">Imprimir comprovante</span>
                  </label>
                </div>

                {/* Confirm */}
                <div className="border-t border-zinc-800 px-5 pb-5 pt-3">
                  <button onClick={finalize} disabled={!canFinalize}
                    className={`flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-base font-black text-white transition-all active:scale-95 disabled:cursor-not-allowed ${
                      canFinalize
                        ? "bg-orange-500 hover:bg-orange-600 shadow-[0_0_24px_rgba(249,115,22,0.55)]"
                        : "bg-zinc-700 opacity-40"
                    }`}>
                    {finalizing ? <>⏳ Processando…</> : <><CheckCircle2 className="h-5 w-5" /> Confirmar · {brl(cartTotal)}</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal: Abrir Caixa ──────────────────────────────────────────── */}
      {showAbrirCaixa && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-xs rounded-3xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden">
            <div className="flex items-center gap-3 border-b border-zinc-800 px-5 py-3.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600/20">
                <Unlock className="h-4 w-4 text-emerald-400" />
              </div>
              <p className="text-sm font-bold text-zinc-100">Abrir Caixa</p>
              <button onClick={() => setShowAbrirCaixa(false)} className="ml-auto text-zinc-500 hover:text-zinc-200"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Operador</label>
                <input value={abrirForm.operator} onChange={e => setAbrirForm(p => ({...p, operator: e.target.value}))}
                  placeholder={sellerName || "Nome do operador"}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Fundo de caixa (R$)</label>
                <input type="number" min={0} step={0.01} value={abrirForm.initial_amount}
                  onChange={e => setAbrirForm(p => ({...p, initial_amount: e.target.value}))}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none" />
              </div>
            </div>
            <div className="border-t border-zinc-800 px-5 py-3.5 flex gap-3">
              <button onClick={() => setShowAbrirCaixa(false)}
                className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">Cancelar</button>
              <button onClick={handleAbrirCaixa} disabled={caixaSubmitting}
                className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50 transition-all">
                {caixaSubmitting ? "Abrindo…" : "Abrir Caixa"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Fechar Caixa ─────────────────────────────────────────── */}
      {showFecharCaixa && caixa && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden">
            <div className="flex items-center gap-3 border-b border-zinc-800 px-5 py-3.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-red-600/20">
                <Lock className="h-4 w-4 text-red-400" />
              </div>
              <p className="text-sm font-bold text-zinc-100">Fechar Caixa</p>
              <button onClick={() => setShowFecharCaixa(false)} className="ml-auto text-zinc-500 hover:text-zinc-200"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              {/* Resumo */}
              <div className="rounded-xl bg-zinc-800/60 border border-zinc-700 divide-y divide-zinc-700">
                {[
                  { label: "Fundo inicial",  value: brl(caixa.initial_amount), cls: "text-zinc-300" },
                  { label: "Total vendido",  value: brl(caixa.total_in - caixa.initial_amount), cls: "text-emerald-400" },
                  { label: "Sangrias",       value: `- ${brl(caixa.total_out)}`, cls: "text-red-400" },
                  { label: "Saldo esperado", value: brl(caixa.balance_expected), cls: "text-orange-400 font-black" },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between px-4 py-2.5 text-xs">
                    <span className="text-zinc-500">{row.label}</span>
                    <span className={row.cls}>{row.value}</span>
                  </div>
                ))}
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  Contagem física (R$)
                </label>
                <input type="number" min={0} step={0.01} value={fecharContagem}
                  onChange={e => setFecharContagem(e.target.value)}
                  placeholder="Valor contado no caixa"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-orange-500 focus:outline-none" />
                {fecharContagem && (
                  <p className={`mt-1 text-xs font-semibold ${
                    (parseFloat(fecharContagem)||0) >= caixa.balance_expected ? "text-emerald-400" : "text-red-400"
                  }`}>
                    Diferença: {brl((parseFloat(fecharContagem)||0) - caixa.balance_expected)}
                  </p>
                )}
              </div>
            </div>
            <div className="border-t border-zinc-800 px-5 py-3.5 flex gap-3">
              <button onClick={() => setShowFecharCaixa(false)}
                className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">Cancelar</button>
              <button onClick={handleFecharCaixa} disabled={caixaSubmitting}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-50 transition-all">
                {caixaSubmitting ? "Fechando…" : "Confirmar Fechamento"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Sangria / Suprimento ────────────────────────────────── */}
      {showMovimento && caixa && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-xs rounded-3xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden">
            <div className="flex items-center gap-3 border-b border-zinc-800 px-5 py-3.5">
              <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${movForm.type === "sangria" ? "bg-red-600/20" : "bg-emerald-600/20"}`}>
                {movForm.type === "sangria"
                  ? <ArrowDownLeft className="h-4 w-4 text-red-400" />
                  : <ArrowUpRight className="h-4 w-4 text-emerald-400" />
                }
              </div>
              <p className="text-sm font-bold text-zinc-100">Movimento de Caixa</p>
              <button onClick={() => setShowMovimento(false)} className="ml-auto text-zinc-500 hover:text-zinc-200"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              {/* Tipo toggle */}
              <div className="grid grid-cols-2 gap-2">
                {(["sangria","suprimento"] as const).map(t => (
                  <button key={t} onClick={() => setMovForm(p => ({...p, type: t}))}
                    className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-semibold transition-all ${
                      movForm.type === t
                        ? t === "sangria"
                          ? "border-red-600 bg-red-950/40 text-red-300"
                          : "border-emerald-600 bg-emerald-950/40 text-emerald-300"
                        : "border-zinc-700 text-zinc-500 hover:border-zinc-600"
                    }`}>
                    {t === "sangria"
                      ? <><ArrowDownLeft className="h-3 w-3" /> Sangria</>
                      : <><ArrowUpRight className="h-3 w-3" /> Suprimento</>
                    }
                  </button>
                ))}
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Valor (R$)</label>
                <input type="number" min={0} step={0.01} value={movForm.amount}
                  onChange={e => setMovForm(p => ({...p, amount: e.target.value}))}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-orange-500 focus:outline-none" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Motivo</label>
                <input value={movForm.reason} onChange={e => setMovForm(p => ({...p, reason: e.target.value}))}
                  placeholder={movForm.type === "sangria" ? "Ex: Depósito banco" : "Ex: Troco adicional"}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-orange-500 focus:outline-none" />
              </div>
            </div>
            <div className="border-t border-zinc-800 px-5 py-3.5 flex gap-3">
              <button onClick={() => setShowMovimento(false)}
                className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">Cancelar</button>
              <button onClick={handleMovimento} disabled={caixaSubmitting || !movForm.amount}
                className="flex-1 rounded-xl bg-orange-500 py-2.5 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-50 transition-all">
                {caixaSubmitting ? "Salvando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
