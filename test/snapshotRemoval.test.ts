import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  buildDeleteGroupAndFilesConfirmationMessage,
  buildRemoveFileConfirmationMessage,
  pruneEmptyGroups,
  summarizeFilesForRemoval,
} = require("../snapshotRemoval");

describe("snapshotRemoval", () => {
  it("summarizeFilesForRemoval splits exists and deleted files", () => {
    const files = [
      { path: "a.ts", gitStatus: "M", state: "exists", snapshotRelativePath: "files/a.ts" },
      { path: "b.ts", gitStatus: "D", state: "deleted" },
    ];

    const summary = summarizeFilesForRemoval(files);

    assert.equal(summary.total, 2);
    assert.equal(summary.existsCount, 1);
    assert.equal(summary.deletedCount, 1);
    assert.deepEqual(summary.existsPaths, ["a.ts"]);
    assert.deepEqual(summary.deletedPaths, ["b.ts"]);
  });

  it("buildRemoveFileConfirmationMessage describes exists files", () => {
    const message = buildRemoveFileConfirmationMessage(
      { path: "src/a.ts", gitStatus: "M", state: "exists" },
      false
    );

    assert.match(message, /Remove "src\/a\.ts"/);
    assert.match(message, /saved copy will be deleted/i);
    assert.doesNotMatch(message, /deleted entirely/i);
  });

  it("buildRemoveFileConfirmationMessage describes deleted files", () => {
    const message = buildRemoveFileConfirmationMessage(
      { path: "legacy.js", gitStatus: "D", state: "deleted" },
      true
    );

    assert.match(message, /planned deletion/i);
    assert.match(message, /no longer be removed from your workspace/i);
    assert.match(message, /does not restore/i);
    assert.match(message, /deleted entirely/i);
  });

  it("buildDeleteGroupAndFilesConfirmationMessage describes mixed group removal", () => {
    const summary = summarizeFilesForRemoval([
      { path: "keep.ts", gitStatus: "M", state: "exists" },
      { path: "gone.ts", gitStatus: "D", state: "deleted" },
    ]);

    const message = buildDeleteGroupAndFilesConfirmationMessage(
      "feat: cleanup",
      summary,
      false
    );

    assert.match(message, /Delete group "feat: cleanup"/);
    assert.match(message, /2 file\(s\)/);
    assert.match(message, /Saved copies: keep\.ts/);
    assert.match(message, /Planned deletions: gone\.ts/);
    assert.match(message, /does not restore missing files/i);
  });

  it("pruneEmptyGroups removes groups with no files", () => {
    const snapshot = {
      id: "snap_1",
      createdAt: new Date().toISOString(),
      branch: "main",
      workspaceRoot: "/repo",
      groups: [
        { id: "g1", name: "Used", colorIndex: 0, createdAt: new Date().toISOString() },
        { id: "g2", name: "Empty", colorIndex: 1, createdAt: new Date().toISOString() },
      ],
      files: [{ path: "a.ts", gitStatus: "M", state: "exists", groupId: "g1" }],
    };

    pruneEmptyGroups(snapshot);

    assert.equal(snapshot.groups?.length, 1);
    assert.equal(snapshot.groups?.[0]?.id, "g1");
  });
});
