import * as path from "path";

const STORAGE_PATH_SEPARATOR = "__";

export function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function normalizeRelativePath(relativePath: string): string {
  return toPosixPath(relativePath).replace(/^\.\/+/, "");
}

/** Case-insensitive key for matching Git paths across snapshot metadata and porcelain output. */
export function pathKey(relativePath: string): string {
  return normalizeRelativePath(relativePath).toLowerCase();
}

export function pathToStorageKey(relativePath: string): string {
  return normalizeRelativePath(relativePath).replace(/\//g, STORAGE_PATH_SEPARATOR);
}

export function storageKeyToPath(storageKey: string): string {
  return storageKey.split(STORAGE_PATH_SEPARATOR).join("/");
}

export function workspaceFilePath(workspaceRoot: string, relativePath: string): string {
  return path.join(workspaceRoot, ...normalizeRelativePath(relativePath).split("/"));
}

export function normalizeWorkspaceRoot(workspaceRoot: string): string {
  return workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
