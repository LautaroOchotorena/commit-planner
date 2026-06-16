import { filesEqual, pathExists } from "./ioUtils";
import { normalizeRelativePath, pathKey, workspaceFilePath } from "./pathUtils";
import { SnapshotStore } from "./snapshotStore";
import {
  FileSelectionHint,
  GitStatusEntry,
  SNAPSHOT_ONLY_GIT_STATUS,
  Snapshot,
  SnapshotFile,
} from "./types";

function formatSnapshotReferenceDate(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoDate;
  }
}

export interface MostRecentSnapshotFileRef {
  snapshot: Snapshot;
  file: SnapshotFile;
}

export function buildMostRecentSnapshotFileIndex(
  snapshots: Snapshot[]
): Map<string, MostRecentSnapshotFileRef> {
  const index = new Map<string, MostRecentSnapshotFileRef>();

  for (const snapshot of snapshots) {
    for (const file of snapshot.files) {
      const key = pathKey(file.path);
      if (!index.has(key)) {
        index.set(key, { snapshot, file });
      }
    }
  }

  return index;
}

export async function workspaceDiffersFromSnapshotFile(
  workspaceRoot: string,
  workspaceExists: boolean,
  snapshotFile: SnapshotFile,
  snapshotContentPath: string | undefined
): Promise<boolean> {
  const snapshotExists = snapshotFile.state === "exists";

  if (snapshotExists !== workspaceExists) {
    return true;
  }

  if (!snapshotExists) {
    return false;
  }

  if (!snapshotContentPath || !(await pathExists(snapshotContentPath))) {
    return true;
  }

  const workspacePath = workspaceFilePath(workspaceRoot, snapshotFile.path);
  return !(await filesEqual(snapshotContentPath, workspacePath));
}

export function formatFileSelectionHintDetail(hint: FileSelectionHint | undefined): string | undefined {
  if (!hint?.mark) {
    return undefined;
  }

  if (hint.mark === "never_snapshotted") {
    return "Never in a planned commit";
  }

  if (hint.mark === "in_past_snapshot") {
    const snapshotLabel = hint.snapshotName?.trim()
      ? `"${hint.snapshotName.trim()}"`
      : hint.snapshotCreatedAt
        ? formatSnapshotReferenceDate(hint.snapshotCreatedAt)
        : "a past planned commit";
    return `In ${snapshotLabel} (not in Git status)`;
  }

  const snapshotLabel = hint.snapshotName?.trim()
    ? `"${hint.snapshotName.trim()}"`
    : hint.snapshotCreatedAt
      ? formatSnapshotReferenceDate(hint.snapshotCreatedAt)
      : "last planned commit";

  return `Changed since ${snapshotLabel}`;
}

function hintSortRank(hint: FileSelectionHint | undefined): number {
  if (hint?.mark === "never_snapshotted") {
    return 0;
  }
  if (hint?.mark === "modified_since_snapshot") {
    return 1;
  }
  if (hint?.mark === "in_past_snapshot") {
    return 2;
  }
  return 3;
}

export function sortEntriesForSelection(
  entries: GitStatusEntry[],
  hints: Map<string, FileSelectionHint>
): GitStatusEntry[] {
  return [...entries].sort((a, b) => {
    const rankDiff =
      hintSortRank(hints.get(a.path)) - hintSortRank(hints.get(b.path));
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return a.path.localeCompare(b.path);
  });
}

export async function mergeGitAndSnapshotEntries(
  workspaceRoot: string,
  gitEntries: GitStatusEntry[],
  snapshots: Snapshot[]
): Promise<GitStatusEntry[]> {
  const index = buildMostRecentSnapshotFileIndex(snapshots);
  const byPathKey = new Map<string, GitStatusEntry>();

  for (const entry of gitEntries) {
    byPathKey.set(pathKey(entry.path), entry);
  }

  for (const ref of index.values()) {
    const key = pathKey(ref.file.path);
    if (byPathKey.has(key)) {
      continue;
    }

    const normalizedPath = normalizeRelativePath(ref.file.path);
    const absolutePath = workspaceFilePath(workspaceRoot, normalizedPath);
    const exists = await pathExists(absolutePath);

    byPathKey.set(key, {
      path: normalizedPath,
      gitStatus: SNAPSHOT_ONLY_GIT_STATUS,
      exists,
    });
  }

  return [...byPathKey.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export async function buildFileSelectionEntries(
  store: SnapshotStore,
  workspaceRoot: string,
  gitEntries: GitStatusEntry[]
): Promise<GitStatusEntry[]> {
  const snapshots = await store.listSnapshots();
  return mergeGitAndSnapshotEntries(workspaceRoot, gitEntries, snapshots);
}

export async function computeFileSelectionHints(
  store: SnapshotStore,
  workspaceRoot: string,
  entries: GitStatusEntry[]
): Promise<Map<string, FileSelectionHint>> {
  const snapshots = await store.listSnapshots();
  const index = buildMostRecentSnapshotFileIndex(snapshots);
  const hints = new Map<string, FileSelectionHint>();

  for (const entry of entries) {
    const ref = index.get(pathKey(entry.path));

    if (!ref) {
      hints.set(entry.path, { mark: "never_snapshotted" });
      continue;
    }

    const snapshotPath = store.getSnapshotFileAbsolutePath(ref.snapshot.id, ref.file);
    const differs = await workspaceDiffersFromSnapshotFile(
      workspaceRoot,
      entry.exists,
      ref.file,
      snapshotPath
    );

    if (differs) {
      hints.set(entry.path, {
        mark: "modified_since_snapshot",
        snapshotId: ref.snapshot.id,
        snapshotName: ref.snapshot.name,
        snapshotCreatedAt: ref.snapshot.createdAt,
      });
    } else if (entry.gitStatus === SNAPSHOT_ONLY_GIT_STATUS) {
      hints.set(entry.path, {
        mark: "in_past_snapshot",
        snapshotId: ref.snapshot.id,
        snapshotName: ref.snapshot.name,
        snapshotCreatedAt: ref.snapshot.createdAt,
      });
    } else {
      hints.set(entry.path, {
        snapshotId: ref.snapshot.id,
        snapshotName: ref.snapshot.name,
        snapshotCreatedAt: ref.snapshot.createdAt,
      });
    }
  }

  return hints;
}
