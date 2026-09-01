export function objectAt(root: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = root[key];
  const object = asPlainObject(existing);
  if (object) {
    return object;
  }
  const next: Record<string, unknown> = {};
  root[key] = next;
  return next;
}

export function asPlainObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}
