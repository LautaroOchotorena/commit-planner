import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import { createTempDir, writeWorkspaceFile } from "./helpers/gitRepo";

const {
  buildMostRecentSnapshotFileIndex,
  mergeGitAndSnapshotEntries,
  workspaceDiffersFromSnapshotFile,
} = require("../fileSelectionHints");
const { SNAPSHOT_ONLY_GIT_STATUS } = require("../types");

describe("fileSelectionHints", () => {
  it("buildMostRecentSnapshotFileIndex keeps the newest snapshot per path", () => {
    const index = buildMostRecentSnapshotFileIndex([
      {
        id: "snap_new",
        createdAt: "2026-06-14T12:00:00.000Z",
        branch: "main",
        workspaceRoot: "/repo",
        files: [{ path: "src/app.ts", gitStatus: "M", state: "exists" }],
      },
      {
        id: "snap_old",
        createdAt: "2026-06-13T12:00:00.000Z",
        branch: "main",
        workspaceRoot: "/repo",
        files: [{ path: "src/app.ts", gitStatus: "M", state: "exists" }],
      },
      {
        id: "snap_other",
        createdAt: "2026-06-12T12:00:00.000Z",
        branch: "main",
        workspaceRoot: "/repo",
        files: [{ path: "src/other.ts", gitStatus: "A", state: "exists" }],
      },
    ]);

    assert.equal(index.get("src/app.ts")?.snapshot.id, "snap_new");
    assert.equal(index.get("src/other.ts")?.snapshot.id, "snap_other");
  });

  it("workspaceDiffersFromSnapshotFile detects identical content", async () => {
    const workspaceRoot = await createTempDir("fc-hints-workspace-");
    const snapshotDir = await createTempDir("fc-hints-snapshot-");

    await writeWorkspaceFile(workspaceRoot, "feature.ts", "same-content");
    const snapshotPath = path.join(snapshotDir, "feature.ts");
    await writeWorkspaceFile(snapshotDir, "feature.ts", "same-content");

    const differs = await workspaceDiffersFromSnapshotFile(
      workspaceRoot,
      true,
      { path: "feature.ts", gitStatus: "M", state: "exists" },
      snapshotPath
    );

    assert.equal(differs, false);
  });

  it("workspaceDiffersFromSnapshotFile detects changed content", async () => {
    const workspaceRoot = await createTempDir("fc-hints-workspace-");
    const snapshotDir = await createTempDir("fc-hints-snapshot-");

    await writeWorkspaceFile(workspaceRoot, "feature.ts", "current-content");
    const snapshotPath = path.join(snapshotDir, "feature.ts");
    await writeWorkspaceFile(snapshotDir, "feature.ts", "snapshot-content");

    const differs = await workspaceDiffersFromSnapshotFile(
      workspaceRoot,
      true,
      { path: "feature.ts", gitStatus: "M", state: "exists" },
      snapshotPath
    );

    assert.equal(differs, true);
  });

  it("workspaceDiffersFromSnapshotFile detects exists vs deleted mismatch", async () => {
    const workspaceRoot = await createTempDir("fc-hints-workspace-");
    const snapshotDir = await createTempDir("fc-hints-snapshot-");

    await writeWorkspaceFile(workspaceRoot, "feature.ts", "current-content");
    const snapshotPath = path.join(snapshotDir, "feature.ts");
    await writeWorkspaceFile(snapshotDir, "feature.ts", "snapshot-content");

    const recreatedDiffers = await workspaceDiffersFromSnapshotFile(
      workspaceRoot,
      true,
      { path: "feature.ts", gitStatus: "D", state: "deleted" },
      undefined
    );
    assert.equal(recreatedDiffers, true);

    const deletedDiffers = await workspaceDiffersFromSnapshotFile(
      workspaceRoot,
      false,
      { path: "feature.ts", gitStatus: "M", state: "exists" },
      snapshotPath
    );
    assert.equal(deletedDiffers, true);

    const bothDeleted = await workspaceDiffersFromSnapshotFile(
      workspaceRoot,
      false,
      { path: "feature.ts", gitStatus: "D", state: "deleted" },
      undefined
    );
    assert.equal(bothDeleted, false);
  });

  it("mergeGitAndSnapshotEntries adds snapshot files missing from git status", async () => {
    const workspaceRoot = await createTempDir("fc-hints-workspace-");
    await writeWorkspaceFile(workspaceRoot, "feature.ts", "content-a");

    const merged = await mergeGitAndSnapshotEntries(
      workspaceRoot,
      [],
      [
        {
          id: "snap_old",
          createdAt: "2026-06-13T12:00:00.000Z",
          branch: "main",
          workspaceRoot,
          files: [{ path: "feature.ts", gitStatus: "M", state: "exists" }],
        },
      ]
    );

    assert.equal(merged.length, 1);
    assert.equal(merged[0].path, "feature.ts");
    assert.equal(merged[0].gitStatus, SNAPSHOT_ONLY_GIT_STATUS);
    assert.equal(merged[0].exists, true);
  });

  it("mergeGitAndSnapshotEntries does not duplicate git status paths", async () => {
    const workspaceRoot = await createTempDir("fc-hints-workspace-");
    await writeWorkspaceFile(workspaceRoot, "feature.ts", "content-a");

    const merged = await mergeGitAndSnapshotEntries(
      workspaceRoot,
      [{ path: "feature.ts", gitStatus: "M", exists: true }],
      [
        {
          id: "snap_old",
          createdAt: "2026-06-13T12:00:00.000Z",
          branch: "main",
          workspaceRoot,
          files: [{ path: "feature.ts", gitStatus: "M", state: "exists" }],
        },
      ]
    );

    assert.equal(merged.length, 1);
    assert.equal(merged[0].gitStatus, "M");
  });
});
