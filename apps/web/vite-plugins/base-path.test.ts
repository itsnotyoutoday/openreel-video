import { describe, expect, it } from "vitest";
import { resolveBase } from "./base-path";

describe("resolveBase", () => {
  it("defaults to the site root, as before", () => {
    expect(resolveBase(undefined, false)).toBe("/");
    expect(resolveBase("", false)).toBe("/");
    expect(resolveBase("/", false)).toBe("/");
  });

  it("normalizes a sub-path to leading and trailing slashes", () => {
    for (const input of ["tools/editor", "/tools/editor", "tools/editor/", "/tools/editor/"]) {
      expect(resolveBase(input, false)).toBe("/tools/editor/");
    }
  });

  it("desktop builds keep relative paths regardless of OPENREEL_BASE", () => {
    expect(resolveBase(undefined, true)).toBe("./");
    expect(resolveBase("/tools/", true)).toBe("./");
  });
});
