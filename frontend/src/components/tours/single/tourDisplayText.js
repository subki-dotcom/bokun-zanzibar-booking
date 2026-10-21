// Bókun sends some included/excluded items as codes (FOOD_AND_DRINKS): show them as words ("Food and drinks").
export const humanizeListItem = (value = "") => {
  const text = String(value || "").trim();
  if (!/^[A-Z0-9]+(?:_[A-Z0-9]+)+$/.test(text)) return text;
  const words = text.toLowerCase().split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// Tour badges: categories plus real highlight phrases. Bókun keywords arrive split into single words ("with", "&",
// "Stone"), so one-word highlights are left out; categories are kept as they are.
export const tourBadges = ({ categories = [], highlights = [] } = {}, limit = 7) => {
  const clean = (item) => String(item || "").trim();
  const phrases = (highlights || []).map(clean).filter((item) => /\s/.test(item) && item.length >= 6);
  const seen = new Set();
  return [...(categories || []).map(clean), ...phrases]
    .filter((item) => item && !seen.has(item.toLowerCase()) && seen.add(item.toLowerCase()))
    .slice(0, limit);
};
