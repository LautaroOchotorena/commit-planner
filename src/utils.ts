import * as vscode from "vscode";
import type { SnapshotGroup } from "./types";
import { t } from "./nls";
import {
  copyFileSafe,
  deleteDirSafe,
  deleteFileSafe,
  ensureDir,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from "./ioUtils";
import {
  normalizeRelativePath,
  normalizeWorkspaceRoot,
  pathKey,
  pathToStorageKey,
  storageKeyToPath,
  toPosixPath,
  workspaceFilePath,
} from "./pathUtils";

export {
  copyFileSafe,
  deleteDirSafe,
  deleteFileSafe,
  ensureDir,
  normalizeRelativePath,
  normalizeWorkspaceRoot,
  pathExists,
  pathKey,
  pathToStorageKey,
  readJsonFile,
  storageKeyToPath,
  toPosixPath,
  workspaceFilePath,
  writeJsonFile,
};

export function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  return folders[0].uri.fsPath;
}

export function requireWorkspaceRoot(): string {
  const root = getWorkspaceRoot();
  if (!root) {
    throw new Error(t("No workspace folder is open."));
  }
  return root;
}

export function formatDateTime(isoDate: string): string {
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

export function snapshotCreatedAtLabel(snapshot: { createdAt: string }): string {
  return formatDateTime(snapshot.createdAt);
}

export function snapshotDisplayName(snapshot: { id: string; name?: string; createdAt: string }): string {
  if (snapshot.name && snapshot.name.trim().length > 0) {
    return snapshot.name.trim();
  }
  return formatDateTime(snapshot.createdAt);
}

export function generateSnapshotId(): string {
  return `snap_${Date.now()}`;
}

export function generateGroupId(): string {
  return `grp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function snapshotUsesGroups(snapshot: { groups?: SnapshotGroup[] }): boolean {
  return (snapshot.groups?.length ?? 0) > 0;
}

export function getConfig<T>(key: string, defaultValue: T): T {
  return vscode.workspace.getConfiguration("commitPlanner").get<T>(key, defaultValue);
}
