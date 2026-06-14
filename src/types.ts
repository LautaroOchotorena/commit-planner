export type GitFileStatus = "M" | "A" | "D" | "R" | "C" | "??" | "U" | string;

export interface SnapshotFile {
  path: string;
  gitStatus: GitFileStatus;
  state: "exists" | "deleted";
  snapshotRelativePath?: string;
  groupId?: string;
}

export interface SnapshotGroup {
  id: string;
  name: string;
  colorIndex: number;
  createdAt: string;
}

export interface Snapshot {
  id: string;
  name?: string;
  createdAt: string;
  branch: string;
  workspaceRoot: string;
  files: SnapshotFile[];
  groups?: SnapshotGroup[];
}

export interface CreateSnapshotGroupInput {
  name: string;
  filePaths: string[];
}

export interface RuntimeBackupFile {
  path: string;
  stateBeforeActivation: "exists" | "missing";
  backupRelativePath?: string;
}

export interface ActiveSnapshotState {
  snapshotId: string;
  activatedAt: string;
  branchAtActivation: string;
  files: RuntimeBackupFile[];
}

export interface ApplySnapshotStateResult {
  restored: number;
  deleted: number;
}

export interface SnapshotsIndex {
  snapshots: string[];
}

export interface GitStatusEntry {
  path: string;
  gitStatus: GitFileStatus;
  exists: boolean;
}

export interface FileSnapshotRef {
  snapshotId: string;
  snapshotName?: string;
  createdAt: string;
  isActive: boolean;
}
