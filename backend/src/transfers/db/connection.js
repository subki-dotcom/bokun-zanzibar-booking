const mongoose = require("mongoose");
const logger = require("../../config/logger");
const AppError = require("../../utils/AppError");
const { configurationProblems, transferConfig } = require("../config");
const { env } = require("../../config/env");
const { evaluatePrivileges } = require("./privileges");
const { defineTransferModels } = require("../models");

let store = null;
let pending = null;

const unavailable = (problems = []) =>
  new AppError("The Transfer System is not available.", 503, "TRANSFER_SERVICE_UNAVAILABLE", { problems });

// Opens the Transfer System's own connection: its own database and credentials, verified to hold no
// privileges outside that database.
const connectTransferDatabase = async ({ uri, dbName, businessDbName, nodeEnv } = transferConfig()) => {
  const connection = mongoose.createConnection(uri, {
    dbName,
    autoIndex: false,
    serverSelectionTimeoutMS: 10000
  });
  try {
    await connection.asPromise();
    if (connection.db.databaseName !== dbName) throw unavailable([`connected to ${connection.db.databaseName}, expected ${dbName}`]);
    if (connection.db.databaseName === businessDbName) throw unavailable(["refusing to use the Business Platform database"]);

    const status = await connection.db.command({ connectionStatus: 1, showPrivileges: true });
    const privileges = evaluatePrivileges(status, { transfersDb: dbName, businessDb: businessDbName, nodeEnv });
    privileges.warnings.forEach((warning) => logger.warn("Transfer database", { warning }));
    if (!privileges.ok) throw unavailable(privileges.problems);

    const hello = await connection.db.admin().command({ hello: 1 });
    const models = defineTransferModels(connection);
    await Promise.all(Object.values(models).map((model) => model.createIndexes()));

    logger.info("Transfer database connected", { database: dbName, users: privileges.users, transactions: Boolean(hello.setName || hello.msg === "isdbgrid") });
    return { connection, models, dbName, supportsTransactions: Boolean(hello.setName || hello.msg === "isdbgrid") };
  } catch (error) {
    await connection.close().catch(() => {});
    if (error instanceof AppError) {
      logger.error("Transfer database refused", { problems: error.details?.problems });
      throw error;
    }
    logger.error("Transfer database connection failed", { error: error.message });
    throw unavailable(["database connection failed"]);
  }
};

const getTransferStore = async () => {
  if (store) return store;
  const problems = configurationProblems(env);
  if (problems.length) throw unavailable(problems);
  if (!pending) {
    pending = connectTransferDatabase().then(
      (connected) => {
        store = connected;
        return connected;
      },
      (error) => {
        pending = null;
        throw error;
      }
    );
  }
  return pending;
};

// Tests and scripts can supply a store they opened themselves.
const setTransferStore = (value) => {
  store = value;
  pending = null;
};

const closeTransferStore = async () => {
  const current = store;
  store = null;
  pending = null;
  if (current?.connection) await current.connection.close();
};

// Runs fn inside a transaction when the server supports one (replica set / Atlas), otherwise without.
const withTransaction = async (current, fn) => {
  if (!current.supportsTransactions) return fn(null);
  let result;
  await current.connection.transaction(async (session) => {
    result = await fn(session);
  });
  return result;
};

module.exports = {
  connectTransferDatabase,
  getTransferStore,
  setTransferStore,
  closeTransferStore,
  withTransaction
};
