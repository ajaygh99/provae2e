// Manual Jest mock for chalk (ESM-only in v5, incompatible with Jest's CJS transform).
// Auto-used for every test per Jest's node_modules manual-mock convention.
const identity = (str) => str;

module.exports = {
  blue: identity,
  green: identity,
  yellow: identity,
  red: identity,
  gray: identity
};
