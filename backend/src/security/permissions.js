const { ROLES } = require("../config/constants");

const PERMISSIONS = Object.freeze({
  ADMIN_DASHBOARD_READ: "admin.dashboard.read",
  OPERATIONS_READ: "operations.read",
  OPERATIONS_WRITE: "operations.write",
  BOKUN_SYNC_READ: "bokun_sync.read",
  BOKUN_SYNC_WRITE: "bokun_sync.write",
  BOOKING_ACCOUNTING_READ: "booking_accounting.read",
  BOOKING_ACCOUNTING_WRITE: "booking_accounting.write",
  PAYMENT_RECONCILIATION_READ: "payment_reconciliation.read",
  PAYMENT_RECONCILIATION_WRITE: "payment_reconciliation.write",
  BUSINESS_INTELLIGENCE_READ: "business_intelligence.read",
  REPORT_CENTER_READ: "report_center.read",
  REPORT_CENTER_EXPORT: "report_center.export",
  AUDIT_CONTROL_READ: "audit_control.read",
  DATA_QUALITY_READ: "data_quality.read",
  OPS_CONTROL_READ: "ops_control.read",
  OPS_CONTROL_WRITE: "ops_control.write",
  BUSINESS_ACCOUNTING_READ: "business_accounting.read",
  BUSINESS_ACCOUNTING_WRITE: "business_accounting.write",
  BUSINESS_EXPENSE_READ: "business_expense.read",
  BUSINESS_EXPENSE_WRITE: "business_expense.write",
  BUSINESS_INCOME_READ: "business_income.read",
  BUSINESS_INCOME_WRITE: "business_income.write",
  GL_VIEW: "gl.view",
  GL_MANAGE_CHART: "gl.manage_chart",
  GL_CREATE_JOURNAL: "gl.create_journal",
  GL_APPROVE_JOURNAL: "gl.approve_journal",
  GL_POST_JOURNAL: "gl.post_journal",
  GL_REVERSE_JOURNAL: "gl.reverse_journal",
  GL_CLOSE_PERIOD: "gl.close_period",
  GL_VIEW_TRIAL_BALANCE: "gl.view_trial_balance",
  GL_VIEW_BALANCE_SHEET: "gl.view_balance_sheet",
  GL_VIEW_PROFIT_LOSS: "gl.view_profit_loss",
  GL_VIEW_CASH_FLOW: "gl.view_cash_flow",
  GL_EXPORT: "gl.export",
  GL_CHART_OF_ACCOUNTS_READ: "gl.view",
  GL_CHART_OF_ACCOUNTS_WRITE: "gl.manage_chart",
  GL_JOURNAL_READ: "gl.view",
  GL_JOURNAL_CREATE: "gl.create_journal",
  GL_JOURNAL_APPROVE: "gl.approve_journal",
  GL_JOURNAL_POST: "gl.post_journal",
  GL_JOURNAL_REVERSE: "gl.reverse_journal",
  GL_PERIOD_CLOSE: "gl.close_period",
  GL_REPORT_TRIAL_BALANCE_READ: "gl.view_trial_balance",
  GL_REPORT_BALANCE_SHEET_READ: "gl.view_balance_sheet",
  GL_REPORT_PROFIT_LOSS_READ: "gl.view_profit_loss",
  GL_REPORT_CASH_FLOW_READ: "gl.view_cash_flow",
  CRM_VIEW: "crm.view",
  CRM_MANAGE_LEADS: "crm.manage_leads",
  CRM_ASSIGN_LEADS: "crm.assign_leads",
  CRM_MANAGE_OPPORTUNITIES: "crm.manage_opportunities",
  CRM_MANAGE_QUOTES: "crm.manage_quotes",
  CRM_APPROVE_QUOTES: "crm.approve_quotes",
  CRM_VIEW_CUSTOMERS: "crm.view_customers",
  CRM_MANAGE_CUSTOMERS: "crm.manage_customers",
  CRM_MANAGE_FOLLOWUPS: "crm.manage_followups",
  CRM_VIEW_SALES_ANALYTICS: "crm.view_sales_analytics",
  CRM_VIEW_CUSTOMER_FINANCIALS: "crm.view_customer_financials",
  CRM_MANAGE_B2B: "crm.manage_b2b",
  DISASTER_RECOVERY_READ: "disaster_recovery.read",
  DISASTER_RECOVERY_WRITE: "disaster_recovery.write",
  SYSTEM_HEALTH_READ: "system_health.read",
  PERFORMANCE_REVIEW_READ: "performance_review.read",
  PRODUCTION_READINESS_READ: "production_readiness.read",
  USER_MANAGEMENT_READ: "user_management.read",
  USER_MANAGEMENT_WRITE: "user_management.write",
  AGENT_MANAGEMENT_READ: "agent_management.read",
  AGENT_MANAGEMENT_WRITE: "agent_management.write",
  SYSTEM_SETTINGS_WRITE: "system_settings.write",
  AGENT_PORTAL_READ: "agent_portal.read",
  AGENT_PORTAL_WRITE: "agent_portal.write"
});

const allAdminPermissions = Object.values(PERMISSIONS);

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.SUPER_ADMIN]: allAdminPermissions,
  [ROLES.ADMIN]: allAdminPermissions.filter(
    (permission) =>
      ![
        PERMISSIONS.USER_MANAGEMENT_WRITE,
        PERMISSIONS.SYSTEM_SETTINGS_WRITE,
        PERMISSIONS.DISASTER_RECOVERY_WRITE
      ].includes(permission)
  ),
  [ROLES.STAFF]: [
    PERMISSIONS.ADMIN_DASHBOARD_READ,
    PERMISSIONS.OPERATIONS_READ,
    PERMISSIONS.OPERATIONS_WRITE,
    PERMISSIONS.BOKUN_SYNC_READ,
    PERMISSIONS.BOKUN_SYNC_WRITE,
    PERMISSIONS.BOOKING_ACCOUNTING_READ,
    PERMISSIONS.PAYMENT_RECONCILIATION_READ,
    PERMISSIONS.PAYMENT_RECONCILIATION_WRITE,
    PERMISSIONS.AGENT_MANAGEMENT_READ
  ],
  [ROLES.AGENT]: [
    PERMISSIONS.AGENT_PORTAL_READ,
    PERMISSIONS.AGENT_PORTAL_WRITE
  ]
});

const getPermissionsForRole = (role = "") => [...new Set(ROLE_PERMISSIONS[role] || [])];

const hasPermission = (auth = {}, permission = "") => {
  if (!permission) return true;
  const rolePermissions = getPermissionsForRole(auth.role);
  const authPermissions = Array.isArray(auth.permissions) ? auth.permissions : rolePermissions;
  return authPermissions.includes(permission);
};

const hasAnyPermission = (auth = {}, permissions = []) => {
  const requested = permissions.filter(Boolean);
  if (!requested.length) return true;
  return requested.some((permission) => hasPermission(auth, permission));
};

const hasAllPermissions = (auth = {}, permissions = []) => {
  const requested = permissions.filter(Boolean);
  if (!requested.length) return true;
  return requested.every((permission) => hasPermission(auth, permission));
};

module.exports = {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  getPermissionsForRole,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission
};
