import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import { commitAll, createTempDir, initGitRepo, writeWorkspaceFile } from "./helpers/gitRepo";

const {
  buildMostRecentSnapshotFileIndex,
  mergeGitAndSnapshotEntries,
  workspaceDiffersFromSnapshotFile,
} = require("../fileSelectionHints");
const { getGitStatus } = require("../git");
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

  it("getGitStatus skips directory lines and lists files inside untracked folders", async () => {
    const workspaceRoot = await createTempDir("fc-workspace-");
    await initGitRepo(workspaceRoot);
    await writeWorkspaceFile(workspaceRoot, "tracked.ts", "ok");
    await commitAll(workspaceRoot, "initial");
    await writeWorkspaceFile(workspaceRoot, "changed.ts", "new");
    await writeWorkspaceFile(workspaceRoot, "l10n/bundle.l10n.json", "{}");
    await writeWorkspaceFile(workspaceRoot, "l10n/bundle.l10n.es.json", "{}");

    const entries = await getGitStatus(workspaceRoot);

    assert.equal(
      entries.some((entry: { path: string }) => entry.path === "l10n"),
      false
    );
    assert.equal(
      entries.some((entry: { path: string }) => entry.path === "l10n/bundle.l10n.json"),
      true
    );
    assert.equal(
      entries.some((entry: { path: string }) => entry.path === "l10n/bundle.l10n.es.json"),
      true
    );
    assert.equal(
      entries.some((entry: { path: string }) => entry.path === "changed.ts"),
      true
    );
  });
});
