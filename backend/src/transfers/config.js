const { env } = require("../config/env");

const MIN_SECRET_LENGTH = 32;

// Name of the Business Platform database, taken from MONGO_URI, so the Transfer System can refuse to use it.
const businessDatabaseName = (uri = env.MONGO_URI) => {
  const match = String(uri || "").match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/i);
  return decodeURIComponent((match && match[1]) || "test");
};

const uriUsername = (uri = "") => {
  const match = String(uri || "").match(/^mongodb(?:\+srv)?:\/\/([^:@/]+)(?::[^@/]*)?@/i);
  return match ? decodeURIComponent(match[1]) : "";
};

// Problems that make the Transfer System unavailable. The Business Platform keeps running either way.
const configurationProblems = (source = env) => {
  const problems = [];
  if (!source.TRANSFERS_MONGO_URI) problems.push("TRANSFERS_MONGO_URI is not set");
  if (!/^[a-z0-9_-]{1,38}$/i.test(source.TRANSFERS_DB_NAME || "")) problems.push("TRANSFERS_DB_NAME is invalid");
  if (source.TRANSFERS_DB_NAME === businessDatabaseName(source.MONGO_URI)) {
    problems.push("TRANSFERS_DB_NAME must differ from the Business Platform database");
  }
  const secret = String(source.TRANSFER_JWT_SECRET || "");
  if (secret.length < MIN_SECRET_LENGTH) problems.push(`TRANSFER_JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  if (secret && secret === source.JWT_SECRET) problems.push("TRANSFER_JWT_SECRET must differ from JWT_SECRET");
  if (source.NODE_ENV === "production") {
    const transferUser = uriUsername(source.TRANSFERS_MONGO_URI);
    if (!transferUser) problems.push("TRANSFERS_MONGO_URI must use its own database credentials in production");
    if (transferUser && transferUser === uriUsername(source.MONGO_URI)) {
      problems.push("TRANSFERS_MONGO_URI must not reuse the Business Platform database user");
    }
  }
  return problems;
};

const transferConfig = () => ({
  uri: env.TRANSFERS_MONGO_URI,
  dbName: env.TRANSFERS_DB_NAME,
  jwtSecret: env.TRANSFER_JWT_SECRET,
  jwtExpiresIn: env.TRANSFER_JWT_EXPIRES_IN,
  nodeEnv: env.NODE_ENV,
  businessDbName: businessDatabaseName(env.MONGO_URI)
});

module.exports = {
  MIN_SECRET_LENGTH,
  businessDatabaseName,
  uriUsername,
  configurationProblems,
  transferConfig
};
