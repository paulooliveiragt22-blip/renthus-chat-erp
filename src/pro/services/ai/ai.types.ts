import type { AiServiceInput, AiServiceResult } from "@/src/types/contracts";

export interface AiService {
    run(input: AiServiceInput): Promise<AiServiceResult>;
}

export type { AiServiceResult };

