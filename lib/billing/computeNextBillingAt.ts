/**
 * Próxima data de cobrança após um pagamento confirmado.
 * Regra: +1 mês civil a partir de paidAt (date-fns trata meses curtos, ex. 31 jan → 28/29 fev).
 */

import { addMonths } from "date-fns";

export function computeNextBillingAt(paidAt: Date): Date {
    return addMonths(paidAt, 1);
}
