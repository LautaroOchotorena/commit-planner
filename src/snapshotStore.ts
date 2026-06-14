import * as path from "path";
import * as vscode from "vscode";
import { getCurrentBranch, hasStagedChanges } from "./git";
import { nextGroupColorIndex } from "./groupColors";
import {
  applySnapshotState,
  buildSnapshotFiles,
  FILES_DIR,
  restoreFromRuntimeBackup,
} from "./snapshotEngine";
import {
  ActiveSnapshotState,
  ApplySnapshotStateResult,
  CreateSnapshotGroupInput,
  FileSnapshotRef,
  GitStatusEntry,
  Snapshot,
  SnapshotFile,
  SnapshotGroup,
  SnapshotsIndex,
} from "./types";
import {
  deleteDirSafe,
  deleteFileSafe,
  ensureDir,
  generateGroupId,
  generateSnapshotId,
  getConfig,
  normalizeRelativePath,
  normalizeWorkspaceRoot,
  readJsonFile,
  requireWorkspaceRoot,
  writeJsonFile,
} from "./utils";

const SNAPSHOTS_DIR = "snapshots";
const RUNTIME_DIR = "runtime";
const INDEX_FILE = "snapshots.json";
const METADATA_FILE = "metadata.json";
const ACTIVE_FILE = "active.json";
const INSIDE_WORKSPACE_DIR = ".commit-planner";

function normalizeSnapshot(snapshot: Snapshot): Snapshot {
  snapshot.groups = snapshot.groups ?? [];
  return snapshot;
}

export class SnapshotStore {
  private readonly context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  private getStorageRoot(): string {
    const location = getConfig<"workspaceStorage" | "insideWorkspace">(
      "storageLocation",
      "workspaceStorage"
    );

    if (location === "insideWorkspace") {
      const workspaceRoot = requireWorkspaceRoot();
      return path.join(workspaceRoot, INSIDE_WORKSPACE_DIR);
    }

    if (!this.context.storageUri) {
      throw new Error("Workspace storage is not available.");
    }
    return this.context.storageUri.fsPath;
  }

  private snapshotsRoot(): string {
    return path.join(this.getStorageRoot(), SNAPSHOTS_DIR);
  }

  private runtimeRoot(): string {
    return path.join(this.getStorageRoot(), RUNTIME_DIR);
  }

  private indexPath(): string {
    return path.join(this.snapshotsRoot(), INDEX_FILE);
  }

  private snapshotDir(snapshotId: string): string {
    return path.join(this.snapshotsRoot(), snapshotId);
  }

  private snapshotMetadataPath(snapshotId: string): string {
    return path.join(this.snapshotDir(snapshotId), METADATA_FILE);
  }

  private snapshotFilesDir(snapshotId: string): string {
    return path.join(this.snapshotDir(snapshotId), FILES_DIR);
  }

  private runtimeSnapshotDir(snapshotId: string): string {
    return path.join(this.runtimeRoot(), snapshotId);
  }

  private activeStatePath(): string {
    return path.join(this.runtimeRoot(), ACTIVE_FILE);
  }

  canUseStorage(): boolean {
    try {
      this.getStorageRoot();
      return true;
    } catch {
      return false;
    }
  }

  async initialize(): Promise<boolean> {
    if (!this.canUseStorage()) {
      return false;
    }

    await ensureDir(this.snapshotsRoot());
    await ensureDir(this.runtimeRoot());

    const index = await readJsonFile<SnapshotsIndex>(this.indexPath());
    if (!index) {
      await writeJsonFile(this.indexPath(), { snapshots: [] } satisfies SnapshotsIndex);
    }

    return true;
  }

  async listSnapshots(): Promise<Snapshot[]> {
    const index = await readJsonFile<SnapshotsIndex>(this.indexPath());
    if (!index) {
      return [];
    }

    const snapshots: Snapshot[] = [];
    for (const id of index.snapshots) {
      const snapshot = await this.getSnapshot(id);
      if (snapshot) {
        snapshots.push(snapshot);
      }
    }

    return snapshots.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getSnapshot(snapshotId: string): Promise<Snapshot | undefined> {
    const snapshot = await readJsonFile<Snapshot>(this.snapshotMetadataPath(snapshotId));
    return snapshot ? normalizeSnapshot(snapshot) : undefined;
  }

  private async saveSnapshot(snapshot: Snapshot): Promise<void> {
    await writeJsonFile(this.snapshotMetadataPath(snapshot.id), snapshot);
  }

  private buildGroupsFromInput(
    groupInputs: CreateSnapshotGroupInput[]
  ): { groups: SnapshotGroup[]; pathToGroupId: Map<string, string> } {
    const groups: SnapshotGroup[] = [];
    const pathToGroupId = new Map<string, string>();
    const baseTime = Date.now();

    for (let i = 0; i < groupInputs.length; i++) {
      const input = groupInputs[i];
      const groupId = generateGroupId();
      groups.push({
        id: groupId,
        name: input.name,
        colorIndex: nextGroupColorIndex(i),
        createdAt: new Date(baseTime + i).toISOString(),
      });
      for (const filePath of input.filePaths) {
        pathToGroupId.set(normalizeRelativePath(filePath), groupId);
      }
    }

    return { groups, pathToGroupId };
  }

  async createSnapshot(
    selectedFiles: GitStatusEntry[],
    name?: string,
    groupInputs?: CreateSnapshotGroupInput[]
  ): Promise<Snapshot> {
    const workspaceRoot = requireWorkspaceRoot();
    const branch = await getCurrentBranch(workspaceRoot);
    const snapshotId = generateSnapshotId();
    const createdAt = new Date().toISOString();

    const filesDir = this.snapshotFilesDir(snapshotId);
    await ensureDir(this.snapshotDir(snapshotId));

    const { groups, pathToGroupId } = groupInputs?.length
      ? this.buildGroupsFromInput(groupInputs)
      : { groups: [] as SnapshotGroup[], pathToGroupId: new Map<string, string>() };

    const snapshotFiles = await buildSnapshotFiles(
      workspaceRoot,
      filesDir,
      selectedFiles,
      pathToGroupId
    );

    const snapshot: Snapshot = {
      id: snapshotId,
      name: name?.trim() || undefined,
      createdAt,
      branch,
      workspaceRoot,
      files: snapshotFiles,
      groups,
    };

    await writeJsonFile(this.snapshotMetadataPath(snapshotId), snapshot);
    await this.addToIndex(snapshotId);

    return snapshot;
  }

  private async addToIndex(snapshotId: string): Promise<void> {
    const index =
      (await readJsonFile<SnapshotsIndex>(this.indexPath())) ?? { snapshots: [] };
    if (!index.snapshots.includes(snapshotId)) {
      index.snapshots.push(snapshotId);
      await writeJsonFile(this.indexPath(), index);
    }
  }

  private async removeFromIndex(snapshotId: string): Promise<void> {
    const index =
      (await readJsonFile<SnapshotsIndex>(this.indexPath())) ?? { snapshots: [] };
    index.snapshots = index.snapshots.filter((id) => id !== snapshotId);
    await writeJsonFile(this.indexPath(), index);
  }

  async renameSnapshot(snapshotId: string, newName: string): Promise<void> {
    const snapshot = await this.getSnapshot(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }
    snapshot.name = newName.trim() || undefined;
    await this.saveSnapshot(snapshot);
  }

  async addGroup(snapshotId: string, name: string): Promise<SnapshotGroup> {
    const snapshot = await this.getSnapshot(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const group: SnapshotGroup = {
      id: generateGroupId(),
      name: name.trim(),
      colorIndex: nextGroupColorIndex(snapshot.groups?.length ?? 0),
      createdAt: new Date().toISOString(),
    };

    snapshot.groups = snapshot.groups ?? [];
    snapshot.groups.push(group);
    await this.saveSnapshot(snapshot);
    return group;
  }

  async renameGroup(snapshotId: string, groupId: string, newName: string): Promise<void> {
    const snapshot = await this.getSnapshot(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const group = snapshot.groups?.find((g) => g.id === groupId);
    if (!group) {
      throw new Error(`Group not found: ${groupId}`);
    }

    group.name = newName.trim();
    await this.saveSnapshot(snapshot);
  }

  async deleteGroup(snapshotId: string, groupId: string): Promise<void> {
    const snapshot = await this.getSnapshot(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    snapshot.groups = (snapshot.groups ?? []).filter((g) => g.id !== groupId);
    for (const file of snapshot.files) {
      if (file.groupId === groupId) {
        delete file.groupId;
      }
    }

    await this.saveSnapshot(snapshot);
  }

  async assignFileToGroup(
    snapshotId: string,
    filePath: string,
    groupId: string | undefined
  ): Promise<void> {
    const snapshot = await this.getSnapshot(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const normalized = normalizeRelativePath(filePath);
    const file = snapshot.files.find((f) => normalizeRelativePath(f.path) === normalized);
    if (!file) {
      throw new Error(`File not found in snapshot: ${filePath}`);
    }

    if (groupId) {
      const group = snapshot.groups?.find((g) => g.id === groupId);
      if (!group) {
        throw new Error(`Group not found: ${groupId}`);
      }
      file.groupId = groupId;
    } else {
      delete file.groupId;
    }

    await this.saveSnapshot(snapshot);
  }

  async assignFilesToGroup(
    snapshotId: string,
    filePaths: string[],
    groupId: string
  ): Promise<void> {
    for (const filePath of filePaths) {
      await this.assignFileToGroup(snapshotId, filePath, groupId);
    }
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    const active = await this.getActiveSnapshotState();
    if (active?.snapshotId === snapshotId) {
      throw new Error("Cannot delete the active snapshot. Deactivate it first.");
    }

    await deleteDirSafe(this.snapshotDir(snapshotId));
    await this.removeFromIndex(snapshotId);
  }

  async getActiveSnapshotState(): Promise<ActiveSnapshotState | undefined> {
    return readJsonFile<ActiveSnapshotState>(this.activeStatePath());
  }

  async hasActiveSnapshot(): Promise<boolean> {
    return (await this.getActiveSnapshotState()) !== undefined;
  }

  async activateSnapshot(snapshotId: string): Promise<ApplySnapshotStateResult> {
    if (await this.hasActiveSnapshot()) {
      throw new Error("A snapshot is already active. Deactivate it before activating another.");
    }

    const snapshot = await this.getSnapshot(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const workspaceRoot = requireWorkspaceRoot();

    if (
      normalizeWorkspaceRoot(snapshot.workspaceRoot) !== normalizeWorkspaceRoot(workspaceRoot)
    ) {
      throw new Error(
        `This planned commit belongs to workspace "${snapshot.workspaceRoot}". Open that folder to activate it.`
      );
    }

    const currentBranch = await getCurrentBranch(workspaceRoot);
    if (snapshot.branch && currentBranch && snapshot.branch !== currentBranch) {
      throw new Error(
        `Cannot activate: created on branch "${snapshot.branch}", current branch is "${currentBranch}".`
      );
    }

    if (getConfig("blockActivationWithStagedChanges", true)) {
      if (await hasStagedChanges(workspaceRoot)) {
        throw new Error(
          "Cannot activate snapshot while there are staged changes. Unstage them first or disable 'blockActivationWithStagedChanges'."
        );
      }
    }

    const runtimeDir = this.runtimeSnapshotDir(snapshotId);
    const runtimeFilesDir = path.join(runtimeDir, FILES_DIR);
    await ensureDir(runtimeDir);

    try {
      const { backupFiles, result } = await applySnapshotState({
        workspaceRoot,
        snapshotDir: this.snapshotDir(snapshotId),
        snapshot,
        runtimeFilesDir,
      });

      const activeState: ActiveSnapshotState = {
        snapshotId,
        activatedAt: new Date().toISOString(),
        branchAtActivation: await getCurrentBranch(workspaceRoot),
        files: backupFiles,
      };
      await writeJsonFile(this.activeStatePath(), activeState);
      return result;
    } catch (error) {
      await this.deactivateActiveSnapshotInternal().catch(() => undefined);
      throw error;
    }
  }

  async deactivateActiveSnapshot(): Promise<void> {
    const active = await this.getActiveSnapshotState();
    if (!active) {
      throw new Error("No active snapshot to deactivate.");
    }
    await this.deactivateActiveSnapshotInternal();
  }

  private async deactivateActiveSnapshotInternal(): Promise<void> {
    const active = await this.getActiveSnapshotState();
    if (!active) {
      return;
    }

    const workspaceRoot = requireWorkspaceRoot();
    const runtimeDir = this.runtimeSnapshotDir(active.snapshotId);

    try {
      await restoreFromRuntimeBackup(workspaceRoot, runtimeDir, active.files);
    } finally {
      await deleteFileSafe(this.activeStatePath());
      await deleteDirSafe(runtimeDir);
    }
  }

  async getFileSnapshotRefs(relativePath: string): Promise<FileSnapshotRef[]> {
    const normalized = normalizeRelativePath(relativePath);
    const snapshots = await this.listSnapshots();
    const active = await this.getActiveSnapshotState();
    const refs: FileSnapshotRef[] = [];

    for (const snapshot of snapshots) {
      const included = snapshot.files.some((f) => normalizeRelativePath(f.path) === normalized);
      if (included) {
        refs.push({
          snapshotId: snapshot.id,
          snapshotName: snapshot.name,
          createdAt: snapshot.createdAt,
          isActive: active?.snapshotId === snapshot.id,
        });
      }
    }

    return refs;
  }

  getSnapshotFileAbsolutePath(snapshotId: string, snapshotFile: SnapshotFile): string | undefined {
    if (snapshotFile.state !== "exists" || !snapshotFile.snapshotRelativePath) {
      return undefined;
    }
    return path.join(this.snapshotDir(snapshotId), snapshotFile.snapshotRelativePath);
  }

  async findSnapshotFile(
    snapshotId: string,
    relativePath: string
  ): Promise<SnapshotFile | undefined> {
    const snapshot = await this.getSnapshot(snapshotId);
    if (!snapshot) {
      return undefined;
    }
    const normalized = normalizeRelativePath(relativePath);
    return snapshot.files.find((f) => normalizeRelativePath(f.path) === normalized);
  }

  resolveStorageKeyPath(snapshotId: string, storageRelativePath: string): string {
    return path.join(this.snapshotDir(snapshotId), storageRelativePath);
  }
}
