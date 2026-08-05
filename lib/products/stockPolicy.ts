/**
 * Política de venda com estoque zero (products.vender_com_estoque_zero).
 * Default do banco = true (pode vender zerado).
 */

export function allowsSellWithZeroStock(flag: boolean | null | undefined): boolean {
    return flag !== false;
}

/** Pode vender `qty` embalagens dado estoque em unidades base e fator. */
export function canFulfillQty(params: {
    venderComEstoqueZero: boolean | null | undefined;
    estoqueUnidades: number;
    fatorConversao: number;
    qty: number;
}): boolean {
    if (allowsSellWithZeroStock(params.venderComEstoqueZero)) return true;
    const fator = Math.max(1, Number(params.fatorConversao) || 1);
    const need = Math.max(0, Number(params.qty) || 0) * fator;
    return Number(params.estoqueUnidades) >= need;
}

/** Cardápio web / busca: ocultar quando flag=false e sem unidades. */
export function shouldHideWhenOutOfStock(
    venderComEstoqueZero: boolean | null | undefined,
    estoqueUnidades: number
): boolean {
    return !allowsSellWithZeroStock(venderComEstoqueZero) && Number(estoqueUnidades) <= 0;
}

export function disponivelVenda(estoqueUnidades: number, fatorConversao: number): number {
    const fator = Math.max(1, Number(fatorConversao) || 1);
    return Math.floor(Math.max(0, Number(estoqueUnidades) || 0) / fator);
}
