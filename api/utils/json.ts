export function stableStringify(value: unknown): string {
  return JSON.stringify(value, replacer, 2);
}

function replacer(_key: string, val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map((entry) => (typeof entry === 'object' && entry !== null ? sortObject(entry) : entry));
  }
  if (typeof val === 'object' && val !== null) {
    return sortObject(val as Record<string, unknown>);
  }
  return val;
}

function sortObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const value = obj[key];
    if (Array.isArray(value)) {
      sorted[key] = value.map((entry) => (typeof entry === 'object' && entry !== null ? sortObject(entry as Record<string, unknown>) : entry));
    } else if (typeof value === 'object' && value !== null) {
      sorted[key] = sortObject(value as Record<string, unknown>);
    } else {
      sorted[key] = value;
    }
  }
  return sorted;
}
