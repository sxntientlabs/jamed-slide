/**
 * Firestore rejects undefined values, including undefined fields nested inside
 * citation and attachment objects. Keep the sanitizer limited to plain data so
 * Firebase sentinels, Dates, and other SDK values are passed through intact.
 */
export function stripUndefinedFirestoreValues<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedFirestoreValues(item)) as unknown as T;
  }

  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) output[key] = stripUndefinedFirestoreValues(child);
    }
    return output as T;
  }

  return value;
}
