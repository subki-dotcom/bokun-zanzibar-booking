import test from "node:test";
import assert from "node:assert/strict";

import { isSupplierConfirmationPending } from "../src/utils/bookingStatus.js";

test("does not show supplier pending when public statuses are confirmed", () => {
  assert.equal(
    isSupplierConfirmationPending({
      paymentStatus: "paid",
      bookingStatus: "confirmed",
      supplierStatus: "confirmed",
      confirmationCode: "VIA-99284460",
      pendingCheckout: { finalizationPending: false }
    }),
    false
  );
});

test("shows supplier pending for a paid booking still awaiting finalization", () => {
  assert.equal(
    isSupplierConfirmationPending({
      paymentStatus: "paid",
      bookingStatus: "pending",
      supplierStatus: "supplier_pending",
      confirmationCode: "",
      pendingCheckout: { finalizationPending: true }
    }),
    true
  );
});
