import { describe, expect, test } from "vitest";
import { stripUndefinedFirestoreValues } from "./firestoreData";

describe("stripUndefinedFirestoreValues", () => {
  test("removes undefined values recursively without changing valid data", () => {
    const value = stripUndefinedFirestoreValues({
      title: "Evidence",
      optional: undefined,
      nested: { abstract: undefined, doi: "10.1000/example" },
      figures: [{ imageUrl: "https://example.test/figure.png", caption: undefined }, undefined],
    });

    expect(value).toEqual({
      title: "Evidence",
      nested: { doi: "10.1000/example" },
      figures: [{ imageUrl: "https://example.test/figure.png" }],
    });
  });

  test("preserves non-plain SDK-like objects", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(stripUndefinedFirestoreValues({ date })).toEqual({ date });
  });
});
