import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  rangeDirectionFromActiveMove,
  sliceItemsForRange,
  toggleSetMembership,
} = require("../fileSelectionRange");

describe("sliceItemsForRange", () => {
  const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];

  it("selects from the focused file through the top, including the focused file", () => {
    assert.deepEqual(sliceItemsForRange(files, 2, "above"), ["a.ts", "b.ts", "c.ts"]);
  });

  it("selects from the focused file through the bottom, including the focused file", () => {
    assert.deepEqual(sliceItemsForRange(files, 2, "below"), ["c.ts", "d.ts", "e.ts"]);
  });

  it("selects only the first file when focusing the top and selecting above", () => {
    assert.deepEqual(sliceItemsForRange(files, 0, "above"), ["a.ts"]);
  });

  it("selects the full list when focusing the top and selecting below", () => {
    assert.deepEqual(sliceItemsForRange(files, 0, "below"), files);
  });

  it("selects the full list when focusing the bottom and selecting above", () => {
    assert.deepEqual(sliceItemsForRange(files, 4, "above"), files);
  });

  it("selects only the last file when focusing the bottom and selecting below", () => {
    assert.deepEqual(sliceItemsForRange(files, 4, "below"), ["e.ts"]);
  });

  it("returns an empty list when the focused index is out of range", () => {
    assert.deepEqual(sliceItemsForRange(files, -1, "above"), []);
    assert.deepEqual(sliceItemsForRange(files, 5, "below"), []);
    assert.deepEqual(sliceItemsForRange([], 0, "above"), []);
  });
});

describe("rangeDirectionFromActiveMove", () => {
  it("maps an upward move to above and a downward move to below", () => {
    assert.equal(rangeDirectionFromActiveMove(3, 2), "above");
    assert.equal(rangeDirectionFromActiveMove(3, 4), "below");
  });

  it("returns undefined when the focused item did not move", () => {
    assert.equal(rangeDirectionFromActiveMove(2, 2), undefined);
    assert.equal(rangeDirectionFromActiveMove(-1, 0), undefined);
    assert.equal(rangeDirectionFromActiveMove(0, -1), undefined);
  });
});

describe("toggleSetMembership", () => {
  it("unmarks keys that were selected and marks keys that were not", () => {
    const picked = new Set(["a.ts", "c.ts", "e.ts"]);
    toggleSetMembership(picked, ["a.ts", "b.ts", "c.ts"]);
    assert.deepEqual([...picked].sort(), ["b.ts", "e.ts"]);
  });

  it("leaves keys outside the range unchanged", () => {
    const picked = new Set(["keep.ts"]);
    toggleSetMembership(picked, ["a.ts"]);
    assert.equal(picked.has("keep.ts"), true);
    assert.equal(picked.has("a.ts"), true);
  });
});
