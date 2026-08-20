import {
  BsActivity,
  BsArchive,
  BsArrowRepeat,
  BsBarChartLine,
  BsBell,
  BsBriefcase,
  BsBuilding,
  BsCalendar2Check,
  BsCashCoin,
  BsClipboard2Check,
  BsCloudCheck,
  BsCreditCard2Front,
  BsFileEarmarkBarGraph,
  BsGear,
  BsGraphUpArrow,
  BsGrid1X2,
  BsJournalCheck,
  BsPeople,
  BsReceipt,
  BsShieldCheck,
  BsTruck,
  BsWallet2
} from "react-icons/bs";

export const ADMIN_ROLES = {
  ALL: ["super_admin", "admin", "staff"],
  MANAGE: ["super_admin", "admin"]
};

export const ADMIN_PERMISSIONS = {
  BUSINESS_ACCOUNTING_READ: "business_accounting.read",
  BUSINESS_INTELLIGENCE_READ: "business_intelligence.read",
  REPORT_CENTER_READ: "report_center.read",
  AUDIT_CONTROL_READ: "audit_control.read",
  DATA_QUALITY_READ: "data_quality.read",
  OPS_CONTROL_READ: "ops_control.read",
  OPS_CONTROL_WRITE: "ops_control.write",
  DISASTER_RECOVERY_READ: "disaster_recovery.read",
  DISASTER_RECOVERY_WRITE: "disaster_recovery.write",
  SYSTEM_HEALTH_READ: "system_health.read",
  PERFORMANCE_REVIEW_READ: "performance_review.read",
  PRODUCTION_READINESS_READ: "production_readiness.read"
};

export const adminNavigation = [
  {
    id: "main-dashboard",
    label: "Main Dashboard",
    path: "/admin",
    icon: BsGrid1X2,
    roles: ADMIN_ROLES.ALL,
    status: "active"
  },
  {
    id: "operations",
    label: "Operations",
    icon: BsCalendar2Check,
    roles: ADMIN_ROLES.ALL,
    children: [
      {
        id: "operations-dashboard",
        label: "Dashboard",
        path: "/admin/operations/dashboard",
        icon: BsActivity,
        roles: ADMIN_ROLES.ALL,
        status: "planned"
      },
      {
        id: "operations-bookings",
        label: "Bookings",
        path: "/admin/operations/bookings",
        icon: BsCalendar2Check,
        roles: ADMIN_ROLES.ALL,
        status: "active"
      },
      {
        id: "operations-requests",
        label: "Booking Requests",
        path: "/admin/operations/booking-requests",
        matchPrefix: "/admin/operations/booking-requests",
        icon: BsClipboard2Check,
        roles: ADMIN_ROLES.ALL,
        status: "active"
      },
      {
        id: "operations-tour-ops",
        label: "Tour Operations",
        path: "/admin/operations/tour-operations",
        icon: BsTruck,
        roles: ADMIN_ROLES.ALL,
        status: "active"
      },
      {
        id: "operations-recovery",
        label: "Recovery",
        path: "/admin/operations/recovery",
        icon: BsArrowRepeat,
        roles: ADMIN_ROLES.ALL,
        status: "active"
      },
      {
        id: "operations-agents",
        label: "Agents",
        path: "/admin/operations/agents",
        icon: BsPeople,
        roles: ADMIN_ROLES.ALL,
        status: "active"
      },
      {
        id: "operations-bokun-sync",
        label: "Bokun Sync",
        icon: BsCloudCheck,
        roles: ADMIN_ROLES.ALL,
        children: [
          {
            id: "bokun-import",
            label: "Confirmed Booking Import",
            path: "/admin/operations/bokun-sync/confirmed-import",
            icon: BsCloudCheck,
            roles: ADMIN_ROLES.ALL,
            status: "planned"
          },
          {
            id: "bokun-manual-sync",
            label: "Manual Sync",
            path: "/admin/operations/bokun-sync/manual",
            icon: BsArrowRepeat,
            roles: ADMIN_ROLES.ALL,
            status: "planned"
          },
          {
            id: "bokun-single-sync",
            label: "Single Booking Sync",
            path: "/admin/operations/bokun-sync/single-booking",
            icon: BsJournalCheck,
            roles: ADMIN_ROLES.ALL,
            status: "planned"
          },
          {
            id: "bokun-sync-logs",
            label: "Sync Logs",
            path: "/admin/operations/bokun-sync/sync-logs",
            icon: BsArchive,
            roles: ADMIN_ROLES.ALL,
            status: "active"
          }
        ]
      }
    ]
  },
  {
    id: "booking-accounting",
    label: "Booking Accounting",
    icon: BsCashCoin,
    roles: ADMIN_ROLES.ALL,
    children: [
      {
        id: "booking-accounting-dashboard",
        label: "Dashboard",
        path: "/admin/booking-accounting/dashboard",
        icon: BsGrid1X2,
        roles: ADMIN_ROLES.ALL,
        status: "planned"
      },
      {
        id: "booking-accounting-invoices",
        label: "Invoices",
        path: "/admin/booking-accounting/invoices",
        icon: BsReceipt,
        roles: ADMIN_ROLES.ALL,
        status: "planned"
      },
      {
        id: "booking-accounting-payments",
        label: "Payments",
        path: "/admin/booking-accounting/payments",
        icon: BsCreditCard2Front,
        roles: ADMIN_ROLES.ALL,
        status: "active"
      },
      {
        id: "booking-accounting-refunds",
        label: "Refunds",
        path: "/admin/booking-accounting/refunds",
        icon: BsWallet2,
        roles: ADMIN_ROLES.ALL,
        status: "planned"
      },
      {
        id: "booking-accounting-expenses",
        label: "Booking Expenses",
        path: "/admin/booking-accounting/expenses",
        icon: BsBriefcase,
        roles: ADMIN_ROLES.ALL,
        status: "planned"
      },
      {
        id: "booking-accounting-cost-templates",
        label: "Product Cost Templates",
        path: "/admin/booking-accounting/cost-templates",
        icon: BsJournalCheck,
        roles: ADMIN_ROLES.ALL,
        status: "planned"
      },
      {
        id: "booking-accounting-profitability",
        label: "Booking Profitability",
        path: "/admin/booking-accounting/profitability",
        icon: BsBarChartLine,
        roles: ADMIN_ROLES.ALL,
        status: "planned"
      },
      {
        id: "booking-accounting-reconciliation",
        label: "Reconciliation",
        path: "/admin/booking-accounting/reconciliation",
        icon: BsShieldCheck,
        roles: ADMIN_ROLES.ALL,
        status: "planned"
      }
    ]
  },
  {
    id: "business-accounting",
    label: "Business Accounting",
    path: "/admin/business-accounting",
    icon: BsBuilding,
    roles: ADMIN_ROLES.MANAGE,
    permissions: [ADMIN_PERMISSIONS.BUSINESS_ACCOUNTING_READ],
    status: "active"
  },
  {
    id: "business-intelligence",
    label: "Business Intelligence",
    path: "/admin/business-intelligence",
    icon: BsBarChartLine,
    roles: ADMIN_ROLES.MANAGE,
    permissions: [ADMIN_PERMISSIONS.BUSINESS_INTELLIGENCE_READ],
    status: "active"
  },
  {
    id: "report-center",
    label: "Report Center",
    path: "/admin/report-center",
    icon: BsFileEarmarkBarGraph,
    roles: ADMIN_ROLES.MANAGE,
    permissions: [ADMIN_PERMISSIONS.REPORT_CENTER_READ],
    status: "active"
  },
  {
    id: "audit-control",
    label: "Audit & Control",
    icon: BsShieldCheck,
    roles: ADMIN_ROLES.MANAGE,
    permissions: [ADMIN_PERMISSIONS.AUDIT_CONTROL_READ],
    children: [
      {
        id: "audit-control-logs",
        label: "Audit Logs",
        path: "/admin/audit-control",
        icon: BsShieldCheck,
        roles: ADMIN_ROLES.MANAGE,
        permissions: [ADMIN_PERMISSIONS.AUDIT_CONTROL_READ],
        status: "active"
      },
      {
        id: "audit-control-data-quality",
        label: "Data Quality",
        path: "/admin/audit-control/data-quality",
        icon: BsClipboard2Check,
        roles: ADMIN_ROLES.MANAGE,
        permissions: [ADMIN_PERMISSIONS.DATA_QUALITY_READ],
        status: "active"
      },
      {
        id: "audit-control-ops-control",
        label: "Ops Control",
        path: "/admin/audit-control/ops-control",
        icon: BsBell,
        roles: ADMIN_ROLES.MANAGE,
        permissions: [ADMIN_PERMISSIONS.OPS_CONTROL_READ],
        status: "active"
      }
    ]
  },
  {
    id: "disaster-recovery",
    label: "Disaster Recovery",
    path: "/admin/disaster-recovery",
    icon: BsArchive,
    roles: ADMIN_ROLES.MANAGE,
    permissions: [ADMIN_PERMISSIONS.DISASTER_RECOVERY_READ],
    status: "active"
  },
  {
    id: "system-health",
    label: "System Health",
    path: "/admin/system-health",
    icon: BsActivity,
    roles: ADMIN_ROLES.MANAGE,
    permissions: [ADMIN_PERMISSIONS.SYSTEM_HEALTH_READ],
    status: "active"
  },
  {
    id: "performance-review",
    label: "Performance Review",
    path: "/admin/performance-review",
    icon: BsGraphUpArrow,
    roles: ADMIN_ROLES.MANAGE,
    permissions: [ADMIN_PERMISSIONS.PERFORMANCE_REVIEW_READ],
    status: "active"
  },
  {
    id: "production-readiness",
    label: "Production Readiness",
    path: "/admin/production-readiness",
    icon: BsClipboard2Check,
    roles: ADMIN_ROLES.MANAGE,
    permissions: [ADMIN_PERMISSIONS.PRODUCTION_READINESS_READ],
    status: "active"
  },
  {
    id: "settings",
    label: "Settings",
    path: "/admin/settings",
    icon: BsGear,
    roles: ADMIN_ROLES.MANAGE,
    status: "planned"
  }
];

const actorRole = (actor = "") => (typeof actor === "string" ? actor : actor?.role || "");
const actorPermissions = (actor = "") => (Array.isArray(actor?.permissions) ? actor.permissions : []);

const canViewItem = (item, actor) => {
  const role = actorRole(actor);
  const permissions = actorPermissions(actor);
  if (item.permissions?.length && permissions.length) {
    return item.permissions.some((permission) => permissions.includes(permission));
  }
  if (!item.roles?.length) return true;
  return item.roles.includes(role);
};

export const filterAdminNavigation = (items = adminNavigation, actor = "") =>
  items
    .filter((item) => canViewItem(item, actor))
    .map((item) => ({
      ...item,
      children: item.children ? filterAdminNavigation(item.children, actor) : undefined
    }))
    .filter((item) => !item.children || item.children.length > 0);

const flattenNavigation = (items = adminNavigation, parents = []) =>
  items.flatMap((item) => {
    const nextParents = item.path ? [...parents, item] : [...parents, item];
    const current = item.path ? [{ ...item, parents }] : [];
    return item.children ? [...current, ...flattenNavigation(item.children, nextParents)] : current;
  });

export const adminNavigationItems = flattenNavigation();

export const getAdminRouteMeta = (pathname = "") => {
  const exact = adminNavigationItems.find((item) => item.path === pathname);
  if (exact) {
    return {
      ...exact,
      breadcrumbs: [...exact.parents.filter((parent) => parent.label), exact]
    };
  }

  const prefix = adminNavigationItems
    .filter((item) => item.matchPrefix && pathname.startsWith(item.matchPrefix))
    .sort((left, right) => right.matchPrefix.length - left.matchPrefix.length)[0];

  if (prefix) {
    return {
      ...prefix,
      label: pathname === prefix.path ? prefix.label : "Request Details",
      breadcrumbs:
        pathname === prefix.path
          ? [...prefix.parents.filter((parent) => parent.label), prefix]
          : [...prefix.parents.filter((parent) => parent.label), prefix, { label: "Details", path: pathname }]
    };
  }

  return {
    id: "admin-page",
    label: "Admin",
    breadcrumbs: [{ label: "Admin", path: "/admin" }]
  };
};

export const isAdminNavItemActive = (item, pathname = "") => {
  if (!item.path && !item.matchPrefix) return false;
  if (item.path === pathname) return true;
  return Boolean(item.matchPrefix && pathname.startsWith(item.matchPrefix));
};

export const hasActiveAdminChild = (item, pathname = "") => {
  if (!item.children?.length) return false;
  return item.children.some((child) => isAdminNavItemActive(child, pathname) || hasActiveAdminChild(child, pathname));
};

export const roleLabel = (role = "") =>
  ({
    super_admin: "Super Admin",
    admin: "Admin",
    staff: "Staff"
  })[role] || "Admin";
