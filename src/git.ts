import { execFile } from "child_process";
import { promisify } from "util";
import { GitFileStatus, GitStatusEntry, SNAPSHOT_ONLY_GIT_STATUS } from "./types";
import { t } from "./nls";
import { isDirectory, isRegularFile } from "./ioUtils";
import { normalizeRelativePath, workspaceFilePath } from "./pathUtils";

const execFileAsync = promisify(execFile);

export async function execGit(
  workspaceRoot: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, {
    cwd: workspaceRoot,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
}

export async function getCurrentBranch(workspaceRoot: string): Promise<string> {
  try {
    const { stdout } = await execGit(workspaceRoot, ["branch", "--show-current"]);
    return stdout.trim();
  } catch {
    return "";
  }
}

export async function hasStagedChanges(workspaceRoot: string): Promise<boolean> {
  try {
    await execGit(workspaceRoot, ["diff", "--cached", "--quiet"]);
    return false;
  } catch {
    return true;
  }
}

function deriveGitStatus(indexStatus: string, workTreeStatus: string): GitFileStatus {
  if (indexStatus === "?" && workTreeStatus === "?") {
    return "??";
  }
  if (indexStatus === "U" || workTreeStatus === "U") {
    return "U";
  }
  if (indexStatus === "R" || workTreeStatus === "R") {
    return "R";
  }
  if (indexStatus === "C" || workTreeStatus === "C") {
    return "C";
  }
  if (indexStatus === "A") {
    return "A";
  }
  if (workTreeStatus === "D" || indexStatus === "D") {
    return "D";
  }
  if (indexStatus === "M" || workTreeStatus === "M") {
    return "M";
  }
  return `${indexStatus}${workTreeStatus}`.trim() || "?";
}

function parsePorcelainLine(line: string): GitStatusEntry | undefined {
  if (line.length < 4) {
    return undefined;
  }

  const indexStatus = line[0];
  const workTreeStatus = line[1];
  let filePart = line.slice(3).trim();

  if (filePart.includes(" -> ")) {
    const parts = filePart.split(" -> ");
    filePart = parts[parts.length - 1].trim();
  }

  const relativePath = normalizeRelativePath(filePart);
  const gitStatus = deriveGitStatus(indexStatus, workTreeStatus);

  return {
    path: relativePath,
    gitStatus,
    exists: gitStatus !== "D",
  };
}

export async function getGitStatus(workspaceRoot: string): Promise<GitStatusEntry[]> {
  // -uall: list individual untracked files inside directories (default is directory-only).
  const { stdout } = await execGit(workspaceRoot, ["status", "--porcelain", "-uall"]);
  const entries: GitStatusEntry[] = [];
  const seen = new Set<string>();

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const entry = parsePorcelainLine(line);
    if (!entry || seen.has(entry.path)) {
      continue;
    }
    seen.add(entry.path);

    const absolutePath = workspaceFilePath(workspaceRoot, entry.path);
    if (await isDirectory(absolutePath)) {
      entry.isDirectory = true;
      entry.exists = false;
      continue;
    }

    entry.exists = await isRegularFile(absolutePath);
    entries.push(entry);
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export function formatGitStatusLabel(gitStatus: GitFileStatus): string {
  if (gitStatus === SNAPSHOT_ONLY_GIT_STATUS) {
    return t("Not in Git status");
  }

  switch (gitStatus) {
    case "??":
      return t("Untracked");
    case "M":
      return t("Modified");
    case "A":
      return t("Added");
    case "D":
      return t("Deleted");
    case "R":
      return t("Renamed");
    case "U":
      return t("Unmerged");
    default:
      return gitStatus;
  }
}

export async function isGitRepository(workspaceRoot: string): Promise<boolean> {
  try {
    await execGit(workspaceRoot, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}
