// LOCAL DEVELOPMENT ONLY. Adds the agreed example so the pricing can be tried out: Zone A → Zone B,
// 1–5 passengers, USD 45 per vehicle. Every other price must be entered by an admin. Locations are marked
// "(demo)". Refuses in production and does nothing if any zone already exists.
require("dotenv").config();
const { configurationProblems } = require("../../src/transfers/config");
const { env } = require("../../src/config/env");
const { connectTransferDatabase, setTransferStore, closeTransferStore } = require("../../src/transfers/db/connection");
const { createTransferServices } = require("../../src/transfers");

const main = async () => {
  if (env.NODE_ENV === "production") throw new Error("Refusing to seed demo pricing in production.");
  const problems = configurationProblems(env);
  if (problems.length) throw new Error(`Transfer System is not configured: ${problems.join("; ")}`);
  const store = await connectTransferDatabase();
  setTransferStore(store);
  if (await store.models.Zone.countDocuments({})) {
    console.log("Zones already exist; nothing seeded.");
    return;
  }
  const { catalog } = createTransferServices();
  const actor = { id: "", email: "seed-demo-pricing", role: "script" };
  const context = { requestId: "seed-demo-pricing" };
  const zoneA = await catalog.createZone({ actor, context, input: { code: "A", name: "Zone A" } });
  const zoneB = await catalog.createZone({ actor, context, input: { code: "B", name: "Zone B" } });
  await catalog.createLocation({ actor, context, input: { name: "Zone A pickup point (demo)", type: "AIRPORT", zoneId: zoneA.id } });
  await catalog.createLocation({ actor, context, input: { name: "Zone B hotel (demo)", type: "HOTEL", zoneId: zoneB.id } });
  const route = await catalog.createRoute({ actor, context, input: { fromZoneId: zoneA.id, toZoneId: zoneB.id, bidirectional: true } });
  await catalog.createRate({ actor, context, input: { routeId: route.id, minPassengers: 1, maxPassengers: 5, price: "45" } });
  console.log("Seeded: Zone A → Zone B (bidirectional), 1–5 passengers = USD 45 per vehicle, with two demo locations.");
};

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => closeTransferStore());
