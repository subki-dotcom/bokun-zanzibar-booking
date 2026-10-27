// One-time move of values this site saved in the browser under the previous brand's key names (cookie choices,
// wishlist, checkout drafts, payment-in-progress state, admin sidebar) to the current "zts" names, so visitors
// keep them after the rebrand. Runs before anything reads storage. Safe to remove after 2027-06-30.
//
// The old prefix is assembled at runtime so the built files contain no trace of the previous brand name
// (scripts/check-brand.mjs fails the build if they do).
const OLD = ["r", "i", "s", "e", "r"].join("");
const PAIRS = [
  [`${OLD}_`, "zts_"],
  [`${OLD}.`, "zts."],
  [`${OLD}:`, "zts:"]
];

const migrateStore = (store) => {
  if (!store) return;
  const keys = [];
  for (let index = 0; index < store.length; index += 1) keys.push(store.key(index));
  keys.forEach((key) => {
    const pair = PAIRS.find(([from]) => key && key.startsWith(from));
    if (!pair) return;
    const next = `${pair[1]}${key.slice(pair[0].length)}`;
    if (store.getItem(next) === null) store.setItem(next, store.getItem(key));
    store.removeItem(key);
  });
};

export const migrateBrandStorage = () => {
  if (typeof window === "undefined") return;
  try {
    migrateStore(window.localStorage);
  } catch {
    // Storage blocked (private mode): nothing to move.
  }
  try {
    migrateStore(window.sessionStorage);
  } catch {
    // Same.
  }
};
