// Mirrors the server's Transfer permissions. The UI only hides what a user cannot do; the server enforces it.
export const P = Object.freeze({
  USERS_MANAGE: "transfer.users.manage",
  PRICING_VIEW: "transfer.pricing.view",
  PRICING_MANAGE: "transfer.pricing.manage",
  AUDIT_VIEW: "transfer.audit.view",
  BOOKINGS_VIEW: "transfer.bookings.view",
  BOOKINGS_MANAGE: "transfer.bookings.manage"
});

export const ROLES = Object.freeze([
  ["transfer_admin", "Transfer admin"],
  ["transfer_manager", "Manager"],
  ["dispatcher", "Dispatcher"],
  ["transfer_accountant", "Accountant"]
]);

export const roleLabel = (role) => ROLES.find(([value]) => value === role)?.[1] || role;

export const can = (user, permission) => Boolean(user?.permissions?.includes(permission));

export const NAVIGATION = Object.freeze([
  { to: "/", label: "Dashboard", permission: P.BOOKINGS_VIEW, end: true },
  { to: "/bookings", label: "Bookings", permission: P.BOOKINGS_VIEW },
  { to: "/bookings/new", label: "New booking", permission: P.BOOKINGS_MANAGE },
  { section: "Pricing" },
  { to: "/pricing/zones", label: "Zones", permission: P.PRICING_VIEW },
  { to: "/pricing/locations", label: "Locations", permission: P.PRICING_VIEW },
  { to: "/pricing/routes", label: "Routes", permission: P.PRICING_VIEW },
  { to: "/pricing/rates", label: "Rates & price check", permission: P.PRICING_VIEW },
  { to: "/pricing/settings", label: "Booking settings", permission: P.PRICING_VIEW },
  { section: "Administration" },
  { to: "/users", label: "Users & roles", permission: P.USERS_MANAGE },
  { to: "/audit", label: "Audit log", permission: P.AUDIT_VIEW }
]);

// Navigation for a user: links they may open, and section headings only when something follows them.
export const navigationFor = (user) => {
  const visible = NAVIGATION.filter((item) => item.section || can(user, item.permission));
  return visible.filter((item, index) => !item.section || (visible[index + 1] && !visible[index + 1].section));
};
