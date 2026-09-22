/**
 * Completa cidade/UF (e opcionalmente CEP) a partir da loja + ViaCEP.
 * Cliente no WhatsApp só precisa de rua, número e bairro — cidade/UF vêm da empresa.
 * Sem Google Places: ViaCEP (rua+UF+cidade) e BrasilAPI (CEP).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DraftAddress } from "@/src/types/contracts";
import { lookupCep } from "@/lib/address/cepLookup";

export type CompanyServiceLocale = {
    cidade: string;
    estado: string;
};

async function fetchJson(
    url: string,
    timeoutMs: number
): Promise<unknown> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            cache: "no-store",
            signal: ac.signal,
            headers: { Accept: "application/json" },
        });
        if (!res.ok) return null;
        return await res.json().catch(() => null);
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Cidade/UF de atendimento: `company_delivery_policy.service_city` + UF da empresa,
 * senão `companies.cidade` / `companies.uf`.
 */
export async function loadCompanyServiceLocale(
    admin: SupabaseClient,
    companyId: string
): Promise<CompanyServiceLocale | null> {
    const [companyRes, policyRes] = await Promise.all([
        admin.from("companies").select("cidade, uf").eq("id", companyId).maybeSingle(),
        admin
            .from("company_delivery_policy")
            .select("service_city")
            .eq("company_id", companyId)
            .maybeSingle(),
    ]);
    const company = companyRes.data;
    const policy = policyRes.data;
    const cidade = String(policy?.service_city ?? company?.cidade ?? "")
        .trim();
    const estado = String(company?.uf ?? "")
        .trim()
        .toUpperCase()
        .slice(0, 2);
    if (!cidade || estado.length !== 2) return null;
    return { cidade, estado };
}

function normalizeLoose(s: string): string {
    return s
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .replaceAll(/\s+/gu, " ")
        .trim();
}

/**
 * ViaCEP: busca por UF/cidade/logradouro. Escolhe a linha cujo bairro mais se aproxima.
 */
export async function lookupCepByStreet(params: {
    uf: string;
    cidade: string;
    logradouro: string;
    bairro?: string | null;
    timeoutMs?: number;
}): Promise<{ cep: string; bairro: string; logradouro: string } | null> {
    const uf = params.uf.trim().toUpperCase().slice(0, 2);
    const cidade = params.cidade.trim();
    const logradouro = params.logradouro.trim();
    if (uf.length !== 2 || cidade.length < 2 || logradouro.length < 3) return null;

    const url =
        `https://viacep.com.br/ws/${encodeURIComponent(uf)}/` +
        `${encodeURIComponent(cidade)}/${encodeURIComponent(logradouro)}/json/`;
    const data = await fetchJson(url, params.timeoutMs ?? 3500);
    if (!Array.isArray(data) || data.length === 0) return null;

    const rows = data.filter(
        (r): r is Record<string, unknown> =>
            r != null && typeof r === "object" && !Array.isArray(r)
    );
    if (!rows.length) return null;

    const wantBairro = normalizeLoose(params.bairro ?? "");
    let best = rows[0]!;
    if (wantBairro) {
        const hit = rows.find((r) =>
            normalizeLoose(String(r.bairro ?? "")).includes(wantBairro) ||
            wantBairro.includes(normalizeLoose(String(r.bairro ?? "")))
        );
        if (hit) best = hit;
    }

    const cep = String(best.cep ?? "").replace(/\D/gu, "");
    if (cep.length !== 8) return null;
    return {
        cep,
        bairro: String(best.bairro ?? "").trim(),
        logradouro: String(best.logradouro ?? "").trim() || logradouro,
    };
}

/**
 * Preenche cidade/UF da loja e tenta CEP via ViaCEP (rua) ou lookup por CEP já digitado.
 * Não inventa rua/número/bairro.
 */
export async function enrichDeliveryAddress(params: {
    admin: SupabaseClient;
    companyId: string;
    address: DraftAddress;
}): Promise<DraftAddress> {
    let next: DraftAddress = { ...params.address };
    const locale = await loadCompanyServiceLocale(params.admin, params.companyId);
    if (locale) {
        if (!next.cidade?.trim()) next = { ...next, cidade: locale.cidade };
        const uf = next.estado?.trim().toUpperCase() ?? "";
        if (uf.length !== 2) next = { ...next, estado: locale.estado };
    }

    const cepDigits = String(next.cep ?? "").replace(/\D/gu, "");
    if (cepDigits.length === 8 && (!next.cidade?.trim() || (next.estado?.trim().length ?? 0) !== 2)) {
        const byCep = await lookupCep(cepDigits);
        if (byCep) {
            next = {
                ...next,
                cidade: next.cidade?.trim() || byCep.localidade,
                estado: (next.estado?.trim().length === 2
                    ? next.estado
                    : byCep.uf
                )
                    ?.trim()
                    .toUpperCase()
                    .slice(0, 2) ?? next.estado,
                cep: byCep.cep,
                logradouro: next.logradouro?.trim() || byCep.logradouro || next.logradouro,
                bairro: next.bairro?.trim() || byCep.bairro || next.bairro,
            };
        }
    } else if (
        !cepDigits &&
        next.logradouro?.trim() &&
        next.cidade?.trim() &&
        (next.estado?.trim().length ?? 0) === 2
    ) {
        const byStreet = await lookupCepByStreet({
            uf: next.estado!,
            cidade: next.cidade!,
            logradouro: next.logradouro,
            bairro: next.bairro,
        });
        if (byStreet) {
            next = {
                ...next,
                cep: byStreet.cep,
                /** Não sobrescreve bairro que o cliente digitou se ViaCEP divergir. */
                logradouro: next.logradouro,
            };
        }
    }

    return next;
}

/** Rua+número+bairro já bastam para o cliente; cidade/UF vêm do enrich. */
export function hasCustomerAddressCore(address: DraftAddress | null | undefined): boolean {
    if (!address) return false;
    return Boolean(
        address.logradouro?.trim() && address.numero?.trim() && address.bairro?.trim()
    );
}
