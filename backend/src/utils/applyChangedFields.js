const { isDeepStrictEqual } = require('util');

const plain = value => typeof value?.toObject === 'function' ? value.toObject() : value;
const object = value => value && Object.getPrototypeOf(value) === Object.prototype;

// Split only schema-defined nested objects. Mixed supplier payloads and arrays
// remain atomic, so arbitrary supplier keys never become MongoDB update paths.
// Keep sync timestamps and all changed values, but do not resend equal evidence.
const applyChangedFields = (document, patch) => {
  if (typeof document.set !== 'function' || !document.schema) return Object.assign(document, patch);
  const assign = (path, value) => {
    const previous = plain(document.get(path));
    const next = plain(value);
    if (isDeepStrictEqual(previous, next)) return;
    if (document.schema.nested[path] && object(previous) && object(next)) {
      for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
        assign(`${path}.${key}`, next[key]);
      }
    } else {
      document.set(path, value);
    }
  };
  for (const [path, value] of Object.entries(patch)) assign(path, value);
  return document;
};

module.exports = { applyChangedFields };
