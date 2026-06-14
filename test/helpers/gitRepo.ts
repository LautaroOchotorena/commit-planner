import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function createTempDir(prefix: string): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
  });
  return stdout;
}

export async function initGitRepo(root: string): Promise<void> {
  await runGit(root, ["init"]);
  await runGit(root, ["config", "user.email", "test@example.com"]);
  await runGit(root, ["config", "user.name", "Test User"]);
}

export async function writeWorkspaceFile(
  root: string,
  relativePath: string,
  content: string
): Promise<void> {
  const fullPath = path.join(root, ...relativePath.split("/"));
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, content, "utf8");
}

export async function readWorkspaceFile(root: string, relativePath: string): Promise<string> {
  const fullPath = path.join(root, ...relativePath.split("/"));
  return fs.promises.readFile(fullPath, "utf8");
}

export async function fileExists(root: string, relativePath: string): Promise<boolean> {
  try {
    await fs.promises.access(path.join(root, ...relativePath.split("/")));
    return true;
  } catch {
    return false;
  }
}

export async function commitAll(root: string, message: string): Promise<string> {
  await runGit(root, ["add", "-A"]);
  await runGit(root, ["commit", "-m", message]);
  return (await runGit(root, ["rev-parse", "HEAD"])).trim();
}
