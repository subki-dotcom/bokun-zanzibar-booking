// Tours saved with the heart, on this device only.
const WISHLIST_KEY = "riser_wishlist_v1";

export const readWishlist = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(WISHLIST_KEY) || "[]"));
  } catch {
    return new Set();
  }
};

// Adds or removes a tour; returns whether it is saved now. Storage can be unavailable: the heart still toggles.
export const toggleWishlist = (id) => {
  const list = readWishlist();
  if (list.has(id)) list.delete(id);
  else list.add(id);
  try {
    localStorage.setItem(WISHLIST_KEY, JSON.stringify([...list]));
  } catch {
    // Kept for this visit only.
  }
  return list.has(id);
};
