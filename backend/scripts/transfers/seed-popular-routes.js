// Adds the six popular transfer routes shown on the website, matched to existing locations by name. It never creates
// locations, zones, routes or prices: a product whose places are missing is skipped and reported. Running it again
// leaves existing products as staff have edited them. Usage: npm run transfers:seed-popular-routes
require("dotenv").config();
const { configurationProblems } = require("../../src/transfers/config");
const { env } = require("../../src/config/env");
const { connectTransferDatabase, setTransferStore, closeTransferStore } = require("../../src/transfers/db/connection");
const { createTransferServices } = require("../../src/transfers");

const AIRPORT = "Abeid Amani Karume International Airport";
// Only the inclusion the system itself guarantees (a private vehicle per booking). Staff switch on others in
// Transfer Admin once the service is confirmed.
const PRODUCTS = [
  { slug: "zanzibar-airport-to-stone-town", title: "Zanzibar Airport to Stone Town", pickup: AIRPORT, dropoff: "Stone Town" },
  { slug: "zanzibar-airport-to-nungwi", title: "Zanzibar Airport to Nungwi", pickup: AIRPORT, dropoff: "Nungwi" },
  { slug: "zanzibar-airport-to-kendwa", title: "Zanzibar Airport to Kendwa", pickup: AIRPORT, dropoff: "Kendwa" },
  { slug: "zanzibar-airport-to-paje", title: "Zanzibar Airport to Paje", pickup: AIRPORT, dropoff: "Paje" },
  { slug: "stone-town-to-nungwi", title: "Stone Town to Nungwi", pickup: "Stone Town", dropoff: "Nungwi" },
  { slug: "nungwi-to-zanzibar-airport", title: "Nungwi to Zanzibar Airport", pickup: "Nungwi", dropoff: AIRPORT }
];

const main = async () => {
  const problems = configurationProblems(env);
  if (problems.length) throw new Error(`Transfer System is not configured: ${problems.join("; ")}`);
  const store = await connectTransferDatabase();
  setTransferStore(store);
  const { models } = store;
  const { popularRoutes } = createTransferServices();
  const actor = { id: "", email: "seed-popular-routes", role: "script" };
  const context = { requestId: "seed-popular-routes" };
  for (const [index, product] of PRODUCTS.entries()) {
    if (await models.PopularRoute.exists({ slug: product.slug })) {
      console.log(`kept     ${product.slug} (already exists)`);
      continue;
    }
    const [pickup, dropoff] = await Promise.all([product.pickup, product.dropoff].map((name) => models.Location.findOne({ name }).lean()));
    if (!pickup || !dropoff) {
      console.log(`skipped  ${product.slug}: location "${!pickup ? product.pickup : product.dropoff}" not found`);
      continue;
    }
    await popularRoutes.create({
      actor,
      context,
      input: { slug: product.slug, title: product.title, pickupLocationId: String(pickup._id), dropoffLocationId: String(dropoff._id), inclusions: ["PRIVATE_VEHICLE"], displayOrder: (index + 1) * 10 }
    });
    console.log(`created  ${product.slug}`);
  }
  for (const item of await popularRoutes.listPublic()) {
    console.log(`  ${item.title.padEnd(32)} ${item.price.status === "PRICED" ? `from USD ${item.price.from}` : "Price on Request"}`);
  }
};

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => closeTransferStore());
