import { Snapshot, SnapshotFile } from "./types";
import { t } from "./nls";

export interface FileRemovalSummary {
  total: number;
  existsCount: number;
  deletedCount: number;
  existsPaths: string[];
  deletedPaths: string[];
}

export interface SnapshotRemovalResult {
  snapshotDeleted: boolean;
}

export function summarizeFilesForRemoval(files: SnapshotFile[]): FileRemovalSummary {
  const existsPaths = files.filter((f) => f.state === "exists").map((f) => f.path);
  const deletedPaths = files.filter((f) => f.state === "deleted").map((f) => f.path);

  return {
    total: files.length,
    existsCount: existsPaths.length,
    deletedCount: deletedPaths.length,
    existsPaths,
    deletedPaths,
  };
}

export function pruneEmptyGroups(snapshot: Snapshot): void {
  const groupIdsWithFiles = new Set(
    snapshot.files.map((f) => f.groupId).filter((id): id is string => Boolean(id))
  );
  snapshot.groups = (snapshot.groups ?? []).filter((g) => groupIdsWithFiles.has(g.id));
}

function formatPathList(paths: string[], max = 5): string {
  if (paths.length === 0) {
    return "";
  }
  const listed = paths.slice(0, max).join(", ");
  const suffix = paths.length > max ? t(", and {0} more", paths.length - max) : "";
  return `${listed}${suffix}`;
}

function describePlannedDeletions(deletedCount: number, deletedPaths: string[]): string {
  if (deletedCount === 0) {
    return "";
  }

  const pathsNote =
    deletedCount <= 3
      ? `\n${t("Planned deletions: {0}.", formatPathList(deletedPaths, 3))}`
      : `\n${t("{0} planned deletion(s).", deletedCount)}`;

  return (
    `${pathsNote}\n` +
    t(
      "Those files will no longer be removed from your workspace when you activate this planned commit. This does not restore missing files to your working tree."
    )
  );
}

function describeStoredCopies(existsCount: number, existsPaths: string[]): string {
  if (existsCount === 0) {
    return "";
  }

  const pathsNote =
    existsCount <= 3
      ? `\n${t("Saved copies: {0}.", formatPathList(existsPaths, 3))}`
      : `\n${
          existsCount === 1
            ? t("{0} saved file copy will be deleted from storage.", existsCount)
            : t("{0} saved file copies will be deleted from storage.", existsCount)
        }`;

  return `${pathsNote}\n${t("They will no longer be part of this planned commit.")}`;
}

function describeSnapshotDeletion(): string {
  return `\n\n${t("This planned commit will have no files left and will be deleted entirely.")}`;
}

export function buildRemoveFileConfirmationMessage(
  file: SnapshotFile,
  snapshotWillBeDeleted: boolean
): string {
  const lines = [t('Remove "{0}" from this planned commit?', file.path)];

  if (file.state === "exists") {
    lines.push(
      t("The saved copy will be deleted from storage."),
      t("The file will no longer be included when staging or activating this planned commit.")
    );
  } else {
    lines.push(
      t("This is a planned deletion."),
      t(
        "When you activate this planned commit, this file will no longer be removed from your workspace."
      ),
      t("This does not restore the file to your working tree if it is already missing.")
    );
  }

  if (snapshotWillBeDeleted) {
    lines.push(t("This planned commit will have no files left and will be deleted entirely."));
  }

  return lines.join("\n");
}

export function buildDeleteGroupAndFilesConfirmationMessage(
  groupName: string,
  summary: FileRemovalSummary,
  snapshotWillBeDeleted: boolean
): string {
  const lines = [
    t('Delete group "{0}" and remove its files from this planned commit?', groupName),
  ];

  if (summary.total === 0) {
    lines.push(t("This group has no files. The empty group will be removed."));
    return lines.join("\n");
  }

  lines.push(t("{0} file(s) will be removed from this planned commit.", summary.total));

  const storedNote = describeStoredCopies(summary.existsCount, summary.existsPaths);
  if (storedNote) {
    lines.push(storedNote.trim());
  }

  const deletedNote = describePlannedDeletions(summary.deletedCount, summary.deletedPaths);
  if (deletedNote) {
    lines.push(deletedNote.trim());
  }

  if (snapshotWillBeDeleted) {
    lines.push(describeSnapshotDeletion().trim());
  }

  return lines.join("\n\n");
}
