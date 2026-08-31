import type { ActorContext } from "../../../../lib/billing/use-cases/actorContext";

export function fakeActor(overrides: Partial<ActorContext> = {}): ActorContext {
  return {
    actorId: "actor-1",
    actorEmail: "admin@renthus.com",
    actorRole: "superadmin",
    requestId: "req-1",
    ipAddress: "127.0.0.1",
    userAgent: "test",
    ...overrides,
  };
}
