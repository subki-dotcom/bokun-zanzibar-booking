// Creates (or narrows) the Transfer System's MongoDB user: readWrite on the transfer database only, no other
// database and no cluster privileges. Run it with an administrator connection supplied for this run only:
//
//   MONGO_ADMIN_URI=mongodb://admin:...@host:27017/admin \
//   TRANSFERS_DB_PASSWORD=<long random value> \
//   node scripts/transfers/create-db-user.js [--db riser_transfers] [--user riser_transfers_app]
//
// MongoDB Atlas does not allow createUser from a driver: create a Database User in the Atlas UI with the single
// built-in role readWrite@riser_transfers instead, and use those credentials in TRANSFERS_MONGO_URI.
require("dotenv").config();
const mongoose = require("mongoose");
const { businessDatabaseName } = require("../../src/transfers/config");

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

const main = async () => {
  const adminUri = process.env.MONGO_ADMIN_URI;
  const dbName = arg("--db", process.env.TRANSFERS_DB_NAME || "riser_transfers");
  const user = arg("--user", "riser_transfers_app");
  const password = process.env.TRANSFERS_DB_PASSWORD || "";
  if (!adminUri) throw new Error("MONGO_ADMIN_URI is required (administrator connection, used for this run only).");
  if (password.length < 24) throw new Error("TRANSFERS_DB_PASSWORD must be at least 24 characters.");
  if (dbName === businessDatabaseName(process.env.MONGO_URI)) throw new Error("Refusing: the transfer database must differ from the Business Platform database.");

  const connection = await mongoose.createConnection(adminUri, { serverSelectionTimeoutMS: 10000 }).asPromise();
  try {
    const db = connection.useDb(dbName, { useCache: false }).db;
    const roles = [{ role: "readWrite", db: dbName }];
    const existing = await db.command({ usersInfo: user });
    if (existing.users.length) {
      // Re-running narrows an existing user back to exactly readWrite on this database.
      await db.command({ updateUser: user, pwd: password, roles });
      console.log(`Updated ${user}@${dbName}: roles set to readWrite@${dbName} only, password rotated.`);
    } else {
      await db.command({ createUser: user, pwd: password, roles });
      console.log(`Created ${user}@${dbName} with readWrite@${dbName} only.`);
    }
    console.log(`TRANSFERS_MONGO_URI=mongodb://${user}:<password>@<host>/${dbName}?authSource=${dbName}`);
  } finally {
    await connection.close();
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
