import type { PlatformUserEntity } from "../entities/PlatformUser";

export interface PlatformUserRepository {
    findByAuthUserId(authUserId: string): Promise<PlatformUserEntity | null>;
    list(): Promise<PlatformUserEntity[]>;
}
