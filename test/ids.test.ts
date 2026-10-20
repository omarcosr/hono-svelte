import { describe, expect, it } from "vitest";
import { getIds, ID_PATTERN } from "../src/ids.js";

describe("getIds", () => {
  it("ids match ID_PATTERN (the contract testing.ts relies on)", () => {
    const re = new RegExp("^" + ID_PATTERN + "$");
    const ids = getIds("dashboard/index");
    expect(ids.rootId).toMatch(re);
    expect(ids.dataId).toMatch(re);
  });

  it("returns deterministic ids in r-<hex> format", () => {
    const first = getIds("dashboard");
    const second = getIds("dashboard");
    expect(first).toEqual(second);
    expect(first.rootId).toMatch(/^r-[0-9a-f]{8}$/);
    expect(first.dataId).toMatch(/^r-[0-9a-f]{8}$/);
  });

  it("derives different pairs per entryName", () => {
    const a = getIds("index");
    const b = getIds("dashboard");
    const c = getIds("dashboard/pagina1");
    expect(a.rootId).not.toBe(b.rootId);
    expect(a.dataId).not.toBe(b.dataId);
    expect(b.rootId).not.toBe(c.rootId);
    expect(b.rootId).not.toBe(b.dataId);
  });

  it("root and data differ within the same entry", () => {
    const ids = getIds("auth");
    expect(ids.rootId).not.toBe(ids.dataId);
  });

  it("is stable across calls with a slashed entryName", () => {
    expect(getIds("a/b")).toEqual(getIds("a/b"));
  });
});