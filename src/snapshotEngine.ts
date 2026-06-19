import * as path from "path";
import {
  ApplySnapshotStateResult,
  RuntimeBackupFile,
  Snapshot,
  SnapshotFile,
} from "./types";
import { GitStatusEntry } from "./types";
import { copyFileSafe, deleteFileSafe, ensureDir, isRegularFile, pathExists } from "./ioUtils";
import { t } from "./nls";
import {
  normalizeRelativePath,
  pathToStorageKey,
  workspaceFilePath,
} from "./pathUtils";

export const FILES_DIR = "files";

export async function backupWorkspacePath(
  workspaceRoot: string,
  relativePath: string,
  runtimeFilesDir: string
): Promise<RuntimeBackupFile> {
  const normalized = normalizeRelativePath(relativePath);
  const workspacePath = workspaceFilePath(workspaceRoot, normalized);
  const storageKey = pathToStorageKey(normalized);

  if (await pathExists(workspacePath)) {
    if (!(await isRegularFile(workspacePath))) {
      return {
        path: normalized,
        stateBeforeActivation: "missing",
      };
    }
    const backupPath = path.join(runtimeFilesDir, storageKey);
    await copyFileSafe(workspacePath, backupPath);
    return {
      path: normalized,
      stateBeforeActivation: "exists",
      backupRelativePath: path.join(FILES_DIR, storageKey),
    };
  }

  return {
    path: normalized,
    stateBeforeActivation: "missing",
  };
}

export async function restoreFromRuntimeBackup(
  workspaceRoot: string,
  runtimeDir: string,
  backupFiles: RuntimeBackupFile[]
): Promise<void> {
  for (const file of backupFiles) {
    const relativePath = normalizeRelativePath(file.path);
    const workspacePath = workspaceFilePath(workspaceRoot, relativePath);

    if (file.stateBeforeActivation === "exists" && file.backupRelativePath) {
      const sourcePath = path.join(runtimeDir, file.backupRelativePath);
      await copyFileSafe(sourcePath, workspacePath);
    } else if (file.stateBeforeActivation === "missing") {
      await deleteFileSafe(workspacePath);
    }
  }
}

async function applySnapshotFiles(
  workspaceRoot: string,
  snapshotDir: string,
  snapshotFiles: SnapshotFile[]
): Promise<ApplySnapshotStateResult> {
  let restored = 0;
  let deleted = 0;

  for (const file of snapshotFiles) {
    const relativePath = normalizeRelativePath(file.path);
    const workspacePath = workspaceFilePath(workspaceRoot, relativePath);

    if (file.state === "exists" && file.snapshotRelativePath) {
      const sourcePath = path.join(snapshotDir, file.snapshotRelativePath);
      await copyFileSafe(sourcePath, workspacePath);
      restored++;
    } else if (file.state === "deleted") {
      if (await pathExists(workspacePath)) {
        await deleteFileSafe(workspacePath);
        deleted++;
      }
    }
  }

  return { restored, deleted };
}

export interface ApplySnapshotStateParams {
  workspaceRoot: string;
  snapshotDir: string;
  snapshot: Snapshot;
  runtimeFilesDir?: string;
}

export async function applySnapshotState(
  params: ApplySnapshotStateParams
): Promise<{ backupFiles: RuntimeBackupFile[]; result: ApplySnapshotStateResult }> {
  const { workspaceRoot, snapshotDir, snapshot, runtimeFilesDir } = params;
  const backupFiles: RuntimeBackupFile[] = [];

  if (runtimeFilesDir) {
    await ensureDir(runtimeFilesDir);
    for (const file of snapshot.files) {
      backupFiles.push(await backupWorkspacePath(workspaceRoot, file.path, runtimeFilesDir));
    }
  }

  const result = await applySnapshotFiles(workspaceRoot, snapshotDir, snapshot.files);

  return { backupFiles, result };
}

export async function buildSnapshotFiles(
  workspaceRoot: string,
  filesDir: string,
  entries: GitStatusEntry[],
  pathToGroupId: Map<string, string>
): Promise<SnapshotFile[]> {
  await ensureDir(filesDir);
  const snapshotFiles: SnapshotFile[] = [];

  for (const entry of entries) {
    const relativePath = normalizeRelativePath(entry.path);
    const absolutePath = workspaceFilePath(workspaceRoot, relativePath);
    const storageKey = pathToStorageKey(relativePath);

    if (entry.exists && (await pathExists(absolutePath))) {
      if (!(await isRegularFile(absolutePath))) {
        throw new Error(
          t(
            'Cannot snapshot "{0}": directories are not supported. Select individual files instead.',
            relativePath
          )
        );
      }
      const destPath = path.join(filesDir, storageKey);
      await copyFileSafe(absolutePath, destPath);
      snapshotFiles.push({
        path: relativePath,
        gitStatus: entry.gitStatus,
        state: "exists",
        snapshotRelativePath: path.join(FILES_DIR, storageKey),
        groupId: pathToGroupId.get(relativePath),
      });
    } else {
      snapshotFiles.push({
        path: relativePath,
        gitStatus: entry.gitStatus,
        state: "deleted",
        groupId: pathToGroupId.get(relativePath),
      });
    }
  }

  return snapshotFiles;
}
