export async function loadJsonConfig(path, defaults = {}) {
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const config = await response.json();
    return deepMerge(defaults, config);
  } catch (error) {
    console.warn(`[Config] Failed to load ${path}; using defaults.`, error);
    return structuredClone(defaults);
  }
}

function deepMerge(defaults, overrides) {
  if (!isPlainObject(defaults)) return overrides ?? defaults;

  const merged = { ...defaults };
  if (!isPlainObject(overrides)) return merged;

  Object.entries(overrides).forEach(([key, value]) => {
    merged[key] =
      isPlainObject(value) && isPlainObject(defaults[key])
        ? deepMerge(defaults[key], value)
        : value;
  });

  return merged;
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
