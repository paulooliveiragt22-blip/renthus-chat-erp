/**
 * Re-export — implementação em startBillingAfterSignup.ts
 * @deprecated import from @/lib/billing/startBillingAfterSignup
 */

export {
    startBillingAfterSignup,
    startTrialAfterSignup,
    type StartBillingResult,
} from "@/lib/billing/startBillingAfterSignup";

export { getDefaultTrialDays, getTrialDays } from "@/lib/billing/getDefaultTrialDays";
