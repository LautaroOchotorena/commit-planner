import * as vscode from "vscode";
import { execGit, getGitStatus } from "./git";
import { t } from "./nls";
import { normalizeRelativePath, pathKey } from "./utils";

interface GitInputBox {
  value: string;
}

interface GitRepository {
  rootUri: vscode.Uri;
  inputBox: GitInputBox;
  add(paths: string[]): Promise<void>;
}

interface GitAPI {
  repositories: GitRepository[];
}

interface GitExtension {
  getAPI(version: 1): GitAPI;
}

function normalizeFsPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").toLowerCase();
}

async function getGitRepository(workspaceRoot: string): Promise<GitRepository | undefined> {
  const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
  if (!extension) {
    return undefined;
  }

  const exports = extension.isActive ? extension.exports : await extension.activate();
  const api = exports.getAPI(1);
  const normalizedRoot = normalizeFsPath(workspaceRoot);

  return api.repositories.find(
    (repo) => normalizeFsPath(repo.rootUri.fsPath) === normalizedRoot
  );
}

async function getStagedPathKeys(workspaceRoot: string): Promise<Set<string>> {
  const { stdout } = await execGit(workspaceRoot, ["diff", "--cached", "--name-only"]);
  return new Set(
    stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(pathKey)
  );
}

function resolvePathsForGit(
  requestedPaths: string[],
  statusPaths: Map<string, string>
): string[] {
  return requestedPaths.map((requested) => statusPaths.get(pathKey(requested)) ?? requested);
}

export interface StageGroupResult {
  staged: string[];
  skipped: string[];
}

export async function stageGroupForCommit(
  workspaceRoot: string,
  groupName: string,
  filePaths: string[]
): Promise<StageGroupResult> {
  const repo = await getGitRepository(workspaceRoot);
  if (!repo) {
    throw new Error(
      t(
        "Git extension is not available. Enable the built-in Git extension to stage files."
      )
    );
  }

  const normalizedPaths = [...new Set(filePaths.map((p) => normalizeRelativePath(p)))];
  if (normalizedPaths.length === 0) {
    throw new Error(t("No files to stage."));
  }

  await vscode.commands.executeCommand("git.refresh").then(
    () => undefined,
    () => undefined
  );

  const statusEntries = await getGitStatus(workspaceRoot);
  const statusByKey = new Map(statusEntries.map((entry) => [pathKey(entry.path), entry.path]));
  const pathsForGit = resolvePathsForGit(normalizedPaths, statusByKey);

  const changedKeys = new Set(statusEntries.map((entry) => pathKey(entry.path)));
  const skipped = normalizedPaths.filter((p) => !changedKeys.has(pathKey(p)));

  try {
    await repo.add(pathsForGit);
  } catch {
    await execGit(workspaceRoot, ["add", "--", ...pathsForGit]);
  }

  const stagedKeys = await getStagedPathKeys(workspaceRoot);
  const staged = normalizedPaths.filter((p) => stagedKeys.has(pathKey(p)));

  if (staged.length === 0) {
    const listed = normalizedPaths.slice(0, 5).join(", ");
    const suffix = normalizedPaths.length > 5 ? t(", ...") : "";
    throw new Error(
      t(
        "No changes could be staged. Make sure the planned commit is active and those files differ from HEAD. Files: {0}{1}",
        listed,
        suffix
      )
    );
  }

  repo.inputBox.value = groupName;
  await vscode.commands.executeCommand("workbench.scm.focus");

  const skippedAfterAdd = normalizedPaths.filter((p) => !stagedKeys.has(pathKey(p)));

  return { staged, skipped: skippedAfterAdd };
}
