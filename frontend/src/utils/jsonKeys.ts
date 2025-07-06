/** Collect all JSON keys (depth-first) – flattened like "address.city" if nested */
export function collectJsonKeys(
  obj: Record<string, unknown>,
  prefix = ""
): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    keys.push(full);
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      keys.push(...collectJsonKeys(v as any, full));
    }
  }
  return keys;
}
