// Storage wrapper API

/**
 * Save a value in localStorage under a key, automatically prefixed by the JS13KGAMES year and game title (hardcoded).
 * JSON-serialised, so `value` can be any JSON-safe type (object, array, ...), not just a string.
 * @params {*} key to save value under
 * @params {*} value to save
 */
export const save = (key, value) => localStorage.setItem(`2026.errands-of-iris.${key}`, JSON.stringify(value));

/**
 * Retrieve a value from localStorage by key, automatically prefixed by the JS13KGAMES year and game title (hardcoded).
 * JSON-parsed; returns null if the key is missing.
 * @params {*} key to load value from
 */
export const load = key => JSON.parse(localStorage.getItem(`2026.errands-of-iris.${key}`));
