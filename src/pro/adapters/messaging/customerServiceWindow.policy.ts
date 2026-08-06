import type { CustomerServiceWindowPort } from "../../ports/customerServiceWindow.port";
import { resolveFreeFormSendPolicy } from "@/src/domain/messaging/customerServiceWindow";

export class DomainCustomerServiceWindowAdapter implements CustomerServiceWindowPort {
    resolveFreeForm(
        params: Parameters<CustomerServiceWindowPort["resolveFreeForm"]>[0]
    ) {
        return resolveFreeFormSendPolicy(params);
    }
}
