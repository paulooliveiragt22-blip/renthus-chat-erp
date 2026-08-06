/**
 * Compat: reexporta política de domínio.
 * Preferir `@/src/domain/messaging/customerServiceWindow` em código novo.
 */

export {
    CUSTOMER_SERVICE_WINDOW_HOURS,
    CUSTOMER_SERVICE_WINDOW_MS,
    hoursSinceLastInbound,
    isWithinCustomerServiceWindow,
    isCustomerServiceWindowClosing,
    resolveFreeFormSendPolicy,
} from "@/src/domain/messaging/customerServiceWindow";
