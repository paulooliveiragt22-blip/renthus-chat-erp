import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    isOfflineOrderStatusAllowed,
    isCommandTypeAllowed,
} from "../../lib/offline/domain/SyncEligibility";

describe("offline P2 order status allowlist", () => {
    it("permite preparing e delivered; bloqueia finalize/cancel", () => {
        assert.equal(isOfflineOrderStatusAllowed("preparing"), true);
        assert.equal(isOfflineOrderStatusAllowed("delivered"), true);
        assert.equal(isOfflineOrderStatusAllowed("finalized"), false);
        assert.equal(isOfflineOrderStatusAllowed("canceled"), false);
        assert.equal(isCommandTypeAllowed("UpdateOrderStatus"), true);
    });
});
