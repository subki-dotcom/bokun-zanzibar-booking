// Transfer Admin roles and permissions. They are separate from the Business Platform's roles: a Back Office
// role never grants anything here and these roles never grant anything there.
const TRANSFER_PERMISSIONS = Object.freeze({
  USERS_MANAGE: "transfer.users.manage",
  PRICING_VIEW: "transfer.pricing.view",
  PRICING_MANAGE: "transfer.pricing.manage",
  AUDIT_VIEW: "transfer.audit.view",
  BOOKINGS_VIEW: "transfer.bookings.view",
  BOOKINGS_MANAGE: "transfer.bookings.manage",
  DISPATCH_MANAGE: "transfer.dispatch.manage",
  FLEET_VIEW: "transfer.fleet.view",
  FLEET_MANAGE: "transfer.fleet.manage",
  PAYMENTS_VIEW: "transfer.payments.view",
  PAYMENTS_MANAGE: "transfer.payments.manage",
  REFUNDS_APPROVE: "transfer.refunds.approve",
  COSTS_VIEW: "transfer.costs.view",
  COSTS_MANAGE: "transfer.costs.manage",
  REPORTS_VIEW: "transfer.reports.view"
});

const TRANSFER_ROLES = Object.freeze({
  ADMIN: "transfer_admin",
  MANAGER: "transfer_manager",
  DISPATCHER: "dispatcher",
  ACCOUNTANT: "transfer_accountant"
});

const P = TRANSFER_PERMISSIONS;

const ROLE_PERMISSIONS = Object.freeze({
  [TRANSFER_ROLES.ADMIN]: Object.values(P),
  [TRANSFER_ROLES.MANAGER]: [
    P.PRICING_VIEW, P.BOOKINGS_VIEW, P.BOOKINGS_MANAGE, P.DISPATCH_MANAGE, P.FLEET_VIEW, P.FLEET_MANAGE,
    P.COSTS_VIEW, P.COSTS_MANAGE, P.REPORTS_VIEW
  ],
  [TRANSFER_ROLES.DISPATCHER]: [P.BOOKINGS_VIEW, P.DISPATCH_MANAGE, P.FLEET_VIEW],
  [TRANSFER_ROLES.ACCOUNTANT]: [
    P.PRICING_VIEW, P.BOOKINGS_VIEW, P.PAYMENTS_VIEW, P.PAYMENTS_MANAGE, P.COSTS_VIEW, P.COSTS_MANAGE, P.REPORTS_VIEW
  ]
});

const isTransferRole = (role) => Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role);

const permissionsForTransferRole = (role) => (isTransferRole(role) ? [...ROLE_PERMISSIONS[role]] : []);

module.exports = {
  TRANSFER_PERMISSIONS,
  TRANSFER_ROLES,
  ROLE_PERMISSIONS,
  isTransferRole,
  permissionsForTransferRole
};
