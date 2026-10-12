// Roles allowed into the existing Back Office screens. Page-level permissions are still enforced per route in
// AdminRoutes, and every API call is authorised again by the server.
export const BACK_OFFICE_ROLES = ["super_admin", "admin", "staff"];

// Tour Admin accounts share the Back Office layout but only reach the Tour Admin screens.
export const TOUR_ADMIN_ROLE = "tour_admin";
export const BACK_OFFICE_LAYOUT_ROLES = [...BACK_OFFICE_ROLES, TOUR_ADMIN_ROLE];

export const canUseBackOffice = (role) => BACK_OFFICE_LAYOUT_ROLES.includes(role);

// Where a signed-in account starts. Route guards send unauthorised users to "/", which sends them here, so
// this must be a page the role can open: a Tour Admin landing on /admin (staff screens) would loop.
export const backOfficeLandingPath = (role) => (role === TOUR_ADMIN_ROLE ? "/admin/tour-admin" : "/admin");

// Where "/" sends a visitor. A signed-in user without Back Office access must get a page of their own rather
// than a redirect back into /admin (a loop).
export const backOfficeEntry = ({ loading, isAuthenticated, role }) => {
  if (loading) return "loading";
  if (!isAuthenticated) return "login";
  return canUseBackOffice(role) ? "admin" : "no-access";
};
