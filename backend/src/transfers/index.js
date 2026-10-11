// Transfer System: independent of Bókun, the Agent System and the Business Back Office. It uses its own
// database (TRANSFERS_MONGO_URI / TRANSFERS_DB_NAME), its own admin users and its own token secret.
const { transferConfig } = require("./config");
const { getTransferStore } = require("./db/connection");
const { createCatalogService } = require("./services/catalog");
const { createPricingService } = require("./pricing/service");
const { createTransferAuthService } = require("./services/auth");
const { createTransferUserService, createTransferAuditQueryService } = require("./services/users");
const { createTransferAdminRouter } = require("./routes/admin.routes");

const tokenConfig = () => {
  const config = transferConfig();
  return { secret: config.jwtSecret, expiresIn: config.jwtExpiresIn };
};

const createTransferServices = ({ getStore = getTransferStore, tokens = tokenConfig } = {}) => ({
  auth: createTransferAuthService({ getStore, tokenConfig: tokens }),
  catalog: createCatalogService({ getStore }),
  pricing: createPricingService({ getStore }),
  users: createTransferUserService({ getStore }),
  audit: createTransferAuditQueryService({ getStore })
});

const createTransferAdminApi = ({ getStore = getTransferStore, tokens = tokenConfig } = {}) =>
  createTransferAdminRouter({ getStore, tokenConfig: tokens, services: createTransferServices({ getStore, tokens }) });

module.exports = { tokenConfig, createTransferServices, createTransferAdminApi };
