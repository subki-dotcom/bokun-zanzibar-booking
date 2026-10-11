// Roles allowed into the Back Office. Page-level permissions are still enforced per route in AdminRoutes.
export const BACK_OFFICE_ROLES = ["super_admin", "admin", "staff"];

export const canUseBackOffice = (role) => BACK_OFFICE_ROLES.includes(role);

// Where "/" sends a visitor. Route guards redirect unauthorised users to "/", so a signed-in user without
// Back Office access must get a page of their own rather than a redirect back into /admin (a loop).
export const backOfficeEntry = ({ loading, isAuthenticated, role }) => {
  if (loading) return "loading";
  if (!isAuthenticated) return "login";
  return canUseBackOffice(role) ? "admin" : "no-access";
};
