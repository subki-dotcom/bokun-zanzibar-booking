// Pure helpers for the site header: the current page, the menu's searches and which menu links to show.
import { MEGA_MENU, styleLabel } from "../../../config/site";

// Which main navigation item is the current page.
export const activeNavKey = (pathname = "/", search = "") => {
  const path = String(pathname).replace(/\/+$/, "") || "/";
  if (path === "/") return "home";
  if (path === "/contact") return "contact";
  if (path === "/my-booking" || path.startsWith("/my-booking/")) return "booking";
  if (path === "/tours" || path.startsWith("/tours/")) {
    const category = styleLabel(new URLSearchParams(search).get("category") || "");
    if (path === "/tours" && category === "Transfers") return "transfers";
    if (path === "/tours" && category === "Safari trips") return "safaris";
    return "tours";
  }
  return "";
};

// Every search the menu needs a count for (one request).
export const menuSearches = (columns = MEGA_MENU) =>
  [...new Set(columns.flatMap((column) => column.links.map((link) => link.search).filter(Boolean)))];

// A link stays when it has no search, when its search found tours, or (before the counts arrive) unless it waits
// for a match.
export const showMenuLink = (link, searches = null) => {
  if (!link.search) return true;
  if (!searches) return !link.hideUntilFound;
  return Number(searches[link.search]?.count || 0) > 0;
};

export const menuLinkPrice = (link, searches = null) => (link.price && searches ? Number(searches[link.search]?.fromPrice || 0) : 0);
