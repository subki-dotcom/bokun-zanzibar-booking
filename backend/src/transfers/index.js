// Transfer System: independent of Bókun, the Agent System and the Business Back Office. It uses its own
// database (TRANSFERS_MONGO_URI / TRANSFERS_DB_NAME), its own admin users and its own token secret.
const { transferConfig } = require("./config");
const { getTransferStore } = require("./db/connection");
const { createCatalogService } = require("./services/catalog");
const { createPricingService } = require("./pricing/service");
const { createTransferAuthService } = require("./services/auth");
const { createTransferUserService, createTransferAuditQueryService } = require("./services/users");
const { createTransferAdminRouter } = require("./routes/admin.routes");
const { createTransferPublicRouter } = require("./routes/public.routes");
const { createTransferBookingService } = require("./services/bookings");
const { createTransferAdminBookingService } = require("./services/adminBookings");
const { createTransferFleetService } = require("./services/fleet");
const { createTransferDispatchService } = require("./services/dispatch");
const { createTransferPaymentService } = require("./services/payments");
const { createPopularRouteService } = require("./services/popularRoutes");
const { createPesapalTransferGateway } = require("./payments/pesapalGateway");

// One Pesapal client for the process, so its access token and IPN registration are reused.
let defaultGateway = null;
const pesapalGateway = () => {
  if (!defaultGateway) defaultGateway = createPesapalTransferGateway();
  return defaultGateway;
};

const tokenConfig = () => {
  const config = transferConfig();
  return { secret: config.jwtSecret, expiresIn: config.jwtExpiresIn };
};

const createTransferServices = ({ getStore = getTransferStore, tokens = tokenConfig, gateway = pesapalGateway() } = {}) => {
  const pricing = createPricingService({ getStore });
  const bookings = createTransferBookingService({ getStore, pricing, accessSecret: () => tokens().secret, paymentsAvailable: () => gateway.configured() });
  const payments = createTransferPaymentService({ getStore, bookings, gateway });
  return {
    payments,
    popularRoutes: createPopularRouteService({ getStore }),
    auth: createTransferAuthService({ getStore, tokenConfig: tokens }),
    catalog: createCatalogService({ getStore }),
    pricing,
    bookings,
    adminBookings: createTransferAdminBookingService({ getStore, bookings }),
    fleet: createTransferFleetService({ getStore }),
    dispatch: createTransferDispatchService({ getStore }),
    users: createTransferUserService({ getStore }),
    audit: createTransferAuditQueryService({ getStore })
  };
};

const createTransferAdminApi = ({ getStore = getTransferStore, tokens = tokenConfig, gateway } = {}) =>
  createTransferAdminRouter({ getStore, tokenConfig: tokens, services: createTransferServices({ getStore, tokens, gateway }) });

const createTransferPublicApi = ({ getStore = getTransferStore, tokens = tokenConfig, gateway, limits } = {}) => {
  const services = createTransferServices({ getStore, tokens, gateway });
  return createTransferPublicRouter({ bookings: services.bookings, payments: services.payments, popularRoutes: services.popularRoutes, ...(limits ? { limits } : {}) });
};

module.exports = { tokenConfig, createTransferServices, createTransferAdminApi, createTransferPublicApi };
