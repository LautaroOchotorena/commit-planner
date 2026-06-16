import * as fs from "fs";
import * as path from "path";

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function copyFileSafe(source: string, destination: string): Promise<void> {
  await ensureDir(path.dirname(destination));
  await fs.promises.copyFile(source, destination);
}

export async function deleteFileSafe(filePath: string): Promise<void> {
  if (await pathExists(filePath)) {
    await fs.promises.unlink(filePath);
  }
}

export async function deleteDirSafe(dirPath: string): Promise<void> {
  if (await pathExists(dirPath)) {
    await fs.promises.rm(dirPath, { recursive: true, force: true });
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  if (!(await pathExists(filePath))) {
    return undefined;
  }
  const content = await fs.promises.readFile(filePath, "utf8");
  return JSON.parse(content) as T;
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

export async function readFileBuffer(filePath: string): Promise<Buffer | undefined> {
  if (!(await pathExists(filePath))) {
    return undefined;
  }
  return fs.promises.readFile(filePath);
}

export function buffersEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && a.equals(b);
}

export async function filesEqual(pathA: string, pathB: string): Promise<boolean> {
  const [bufferA, bufferB] = await Promise.all([
    readFileBuffer(pathA),
    readFileBuffer(pathB),
  ]);

  if (bufferA === undefined || bufferB === undefined) {
    return bufferA === undefined && bufferB === undefined;
  }

  return buffersEqual(bufferA, bufferB);
}
