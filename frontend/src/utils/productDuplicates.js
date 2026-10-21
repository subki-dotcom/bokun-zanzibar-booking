// Groups product titles that differ only in punctuation, capitals or generic words ("Zanzibar", "tour", "half day"),
// so staff can spot possible duplicates such as two "Zanzibar Half Day Trip in Mnemba Island" products.
const GENERIC_WORDS = new Set([
  "zanzibar", "tour", "tours", "with", "and", "the", "from", "to", "day", "half", "full", "trip", "private", "shared",
  "guided", "local", "guide", "walking", "walk", "in", "on", "of", "hotel", "hotels", "ferry"
]);

export const duplicateGroupKey = (title = "") =>
  String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !GENERIC_WORDS.has(word))
    .join(" ");
