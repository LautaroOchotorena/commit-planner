import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import {
  commitAll,
  createTempDir,
  fileExists,
  initGitRepo,
  readWorkspaceFile,
  writeWorkspaceFile,
} from "./helpers/gitRepo";

const {
  applySnapshotState,
  buildSnapshotFiles,
  FILES_DIR,
  restoreFromRuntimeBackup,
} = require("../snapshotEngine");

async function buildTestSnapshot(workspaceRoot: string, snapshotDir: string) {
  const filesDir = path.join(snapshotDir, FILES_DIR);

  const snapshotFiles = await buildSnapshotFiles(
    workspaceRoot,
    filesDir,
    [
      { path: "feature.ts", gitStatus: "M", exists: true },
      { path: "removed.ts", gitStatus: "D", exists: false },
    ],
    new Map()
  );

  return {
    id: "snap_test",
    createdAt: new Date().toISOString(),
    branch: "main",
    workspaceRoot,
    files: snapshotFiles,
  };
}

describe("snapshotEngine integration", () => {
  it("applies selected files and backs them up for deactivate", async () => {
    const workspaceRoot = await createTempDir("fc-workspace-");
    const snapshotDir = await createTempDir("fc-snapshot-");
    const runtimeDir = path.join(await createTempDir("fc-runtime-"), "snap_test");
    const runtimeFilesDir = path.join(runtimeDir, FILES_DIR);

    await initGitRepo(workspaceRoot);
    await writeWorkspaceFile(workspaceRoot, "feature.ts", "v1");
    await writeWorkspaceFile(workspaceRoot, "removed.ts", "will-be-deleted");
    await commitAll(workspaceRoot, "initial");

    await writeWorkspaceFile(workspaceRoot, "feature.ts", "snapshot-version");
    await writeWorkspaceFile(workspaceRoot, "removed.ts", "still-here");

    const snapshot = await buildTestSnapshot(workspaceRoot, snapshotDir);

    await writeWorkspaceFile(workspaceRoot, "feature.ts", "current-work");
    await writeWorkspaceFile(workspaceRoot, "removed.ts", "current-work");
    await writeWorkspaceFile(workspaceRoot, "other.ts", "untouched");

    const { backupFiles, result } = await applySnapshotState({
      workspaceRoot,
      snapshotDir,
      snapshot,
      runtimeFilesDir,
    });

    assert.equal(result.restored, 1);
    assert.equal(result.deleted, 1);
    assert.equal(await readWorkspaceFile(workspaceRoot, "feature.ts"), "snapshot-version");
    assert.equal(await fileExists(workspaceRoot, "removed.ts"), false);
    assert.equal(await readWorkspaceFile(workspaceRoot, "other.ts"), "untouched");

    await writeWorkspaceFile(workspaceRoot, "feature.ts", "while-active");
    await writeWorkspaceFile(workspaceRoot, "removed.ts", "recreated");

    await restoreFromRuntimeBackup(workspaceRoot, runtimeDir, backupFiles);

    assert.equal(await readWorkspaceFile(workspaceRoot, "feature.ts"), "current-work");
    assert.equal(await readWorkspaceFile(workspaceRoot, "removed.ts"), "current-work");
    assert.equal(await readWorkspaceFile(workspaceRoot, "other.ts"), "untouched");
  });

  it("only touches snapshot file paths on activate", async () => {
    const workspaceRoot = await createTempDir("fc-workspace-");
    const snapshotDir = await createTempDir("fc-snapshot-");

    await initGitRepo(workspaceRoot);
    await writeWorkspaceFile(workspaceRoot, "feature.ts", "v1");
    await commitAll(workspaceRoot, "initial");

    await writeWorkspaceFile(workspaceRoot, "feature.ts", "snapshot-version");
    await writeWorkspaceFile(workspaceRoot, "other.ts", "other-local");

    const snapshot = await buildTestSnapshot(
      workspaceRoot,
      snapshotDir
    );

    await writeWorkspaceFile(workspaceRoot, "feature.ts", "current");
    await writeWorkspaceFile(workspaceRoot, "other.ts", "other-current");

    await applySnapshotState({
      workspaceRoot,
      snapshotDir,
      snapshot: {
        ...snapshot,
        files: snapshot.files.filter((f: { path: string }) => f.path === "feature.ts"),
      },
    });

    assert.equal(await readWorkspaceFile(workspaceRoot, "feature.ts"), "snapshot-version");
    assert.equal(await readWorkspaceFile(workspaceRoot, "other.ts"), "other-current");
  });
});
