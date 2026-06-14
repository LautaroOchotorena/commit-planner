import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { formatGitStatusLabel, getGitStatus, isGitRepository } from "./git";
import { stageGroupForCommit } from "./gitScm";
import { promptOrganizeIntoGroups } from "./grouping";
import { SnapshotStore } from "./snapshotStore";
import {
  SnapshotTreeItem,
  SnapshotTreeProvider,
  UNGROUPED_NODE_ID,
} from "./snapshotTreeProvider";
import { Snapshot, SnapshotFile } from "./types";
import {
  formatDateTime,
  getWorkspaceRoot,
  requireWorkspaceRoot,
  snapshotCreatedAtLabel,
  snapshotDisplayName,
  snapshotUsesGroups,
  workspaceFilePath,
} from "./utils";

let store: SnapshotStore | undefined;
let treeProvider: SnapshotTreeProvider | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let bootstrapToken: vscode.CancellationTokenSource | undefined;
let isDisposed = false;

export function activate(context: vscode.ExtensionContext): void {
  isDisposed = false;
  bootstrapToken?.cancel();
  bootstrapToken?.dispose();
  bootstrapToken = new vscode.CancellationTokenSource();

  store = new SnapshotStore(context);
  treeProvider = new SnapshotTreeProvider(store);

  const treeView = vscode.window.createTreeView("commitPlanner.snapshots", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView, treeProvider);

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = "commitPlanner.deactivateSnapshot";
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("commitPlanner.createSnapshot", () =>
      createSnapshot()
    ),
    vscode.commands.registerCommand("commitPlanner.listSnapshots", () =>
      listSnapshots()
    ),
    vscode.commands.registerCommand(
      "commitPlanner.activateSnapshot",
      (item?: SnapshotTreeItem) => activateSnapshot(item)
    ),
    vscode.commands.registerCommand("commitPlanner.deactivateSnapshot", () =>
      deactivateSnapshot()
    ),
    vscode.commands.registerCommand(
      "commitPlanner.deleteSnapshot",
      (item?: SnapshotTreeItem) => deleteSnapshot(item)
    ),
    vscode.commands.registerCommand(
      "commitPlanner.renameSnapshot",
      (item?: SnapshotTreeItem) => renameSnapshot(item)
    ),
    vscode.commands.registerCommand(
      "commitPlanner.compareFileWithSnapshot",
      (item?: SnapshotTreeItem) => compareFileWithSnapshot(item)
    ),
    vscode.commands.registerCommand(
      "commitPlanner.openSnapshotFile",
      (item?: SnapshotTreeItem) => openSnapshotFile(item)
    ),
    vscode.commands.registerCommand("commitPlanner.refresh", () => refreshAll()),
    vscode.commands.registerCommand(
      "commitPlanner.addGroup",
      (item?: SnapshotTreeItem) => addGroup(item)
    ),
    vscode.commands.registerCommand(
      "commitPlanner.renameGroup",
      (item?: SnapshotTreeItem) => renameGroup(item)
    ),
    vscode.commands.registerCommand(
      "commitPlanner.deleteGroup",
      (item?: SnapshotTreeItem) => deleteGroup(item)
    ),
    vscode.commands.registerCommand(
      "commitPlanner.assignFileToGroup",
      (item?: SnapshotTreeItem) => assignFileToGroup(item)
    ),
    vscode.commands.registerCommand(
      "commitPlanner.addFilesToGroup",
      (item?: SnapshotTreeItem) => addFilesToGroup(item)
    ),
    vscode.commands.registerCommand(
      "commitPlanner.stageGroupForCommit",
      (item?: SnapshotTreeItem) => stageGroupForCommitCommand(item)
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("commitPlanner")) {
        void refreshAll();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void bootstrapExtension();
    })
  );

  context.subscriptions.push({
    dispose: () => {
      isDisposed = true;
      bootstrapToken?.cancel();
      bootstrapToken?.dispose();
      bootstrapToken = undefined;
      store = undefined;
      treeProvider = undefined;
      statusBarItem = undefined;
    },
  });

  void bootstrapExtension();
}

export function deactivate(): void {
  isDisposed = true;
  bootstrapToken?.cancel();
  statusBarItem?.hide();
}

function getToken(): vscode.CancellationToken | undefined {
  return bootstrapToken?.token;
}

function isCancelled(): boolean {
  return isDisposed || bootstrapToken?.token.isCancellationRequested === true;
}

async function waitForWorkspace(token: vscode.CancellationToken): Promise<boolean> {
  if (getWorkspaceRoot()) {
    return true;
  }

  return new Promise((resolve) => {
    const subscription = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (getWorkspaceRoot()) {
        subscription.dispose();
        resolve(true);
      }
    });

    token.onCancellationRequested(() => {
      subscription.dispose();
      resolve(false);
    });
  });
}

async function bootstrapExtension(): Promise<void> {
  const token = getToken();
  if (!token || !store || !treeProvider || !statusBarItem) {
    return;
  }

  if (!getWorkspaceRoot()) {
    const ready = await waitForWorkspace(token);
    if (!ready || isCancelled()) {
      return;
    }
  }

  try {
    const initialized = await store.initialize();
    if (!initialized || isCancelled()) {
      return;
    }

    await refreshAll();
    if (isCancelled()) {
      return;
    }

    await checkRecoveryOnStartup();
  } catch (error) {
    if (!isCancelled()) {
      console.error("Commit Planner: bootstrap failed", error);
    }
  }
}

async function ensureWorkspaceAndGit(): Promise<string | undefined> {
  const root = getWorkspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage("Commit Planner requires an open workspace folder.");
    return undefined;
  }

  if (!(await isGitRepository(root))) {
    vscode.window.showErrorMessage("The workspace folder is not a Git repository.");
    return undefined;
  }

  return root;
}

async function refreshAll(): Promise<void> {
  if (isCancelled() || !store || !treeProvider || !statusBarItem) {
    return;
  }

  if (!store.canUseStorage()) {
    return;
  }

  treeProvider.refresh();
  if (isCancelled()) {
    return;
  }
  await updateStatusBar();
}

async function updateStatusBar(): Promise<void> {
  if (isCancelled() || !store || !statusBarItem) {
    return;
  }

  const active = await store.getActiveSnapshotState();
  if (isCancelled()) {
    return;
  }

  if (!active) {
    statusBarItem.hide();
    await vscode.commands.executeCommand(
      "setContext",
      "commitPlanner.hasActiveSnapshot",
      false
    );
    return;
  }

  await vscode.commands.executeCommand(
    "setContext",
    "commitPlanner.hasActiveSnapshot",
    true
  );

  const snapshot = await store.getSnapshot(active.snapshotId);
  if (isCancelled()) {
    return;
  }

  const label = snapshot ? snapshotDisplayName(snapshot) : active.snapshotId;
  statusBarItem.text = `$(git-commit) Active: ${label}`;
  statusBarItem.tooltip =
    "A planned commit snapshot is active. Click to deactivate and restore your previous working state.";
  statusBarItem.command = "commitPlanner.deactivateSnapshot";
  statusBarItem.show();
}

async function checkRecoveryOnStartup(): Promise<void> {
  if (isCancelled() || !store) {
    return;
  }

  const active = await store.getActiveSnapshotState();
  if (!active || isCancelled()) {
    return;
  }

  const snapshot = await store.getSnapshot(active.snapshotId);
  if (isCancelled()) {
    return;
  }

  const name = snapshot ? snapshotDisplayName(snapshot) : active.snapshotId;

  const choice = await vscode.window.showWarningMessage(
    `A planned commit snapshot is active ("${name}"). Deactivate and restore your previous working state?`,
    { modal: true },
    "Deactivate",
    "Keep Active"
  );

  if (isCancelled()) {
    return;
  }

  if (choice === "Deactivate") {
    await deactivateSnapshot();
  } else {
    await updateStatusBar();
  }
}

async function createSnapshot(): Promise<void> {
  const root = await ensureWorkspaceAndGit();
  if (!root || !store) {
    return;
  }

  const entries = await getGitStatus(root);
  if (entries.length === 0) {
    vscode.window.showInformationMessage("No modified files found in the working tree.");
    return;
  }

  const items = entries.map((entry) => ({
    label: entry.path,
    description: formatGitStatusLabel(entry.gitStatus),
    detail: entry.exists ? "File exists on disk" : "File deleted on disk",
    picked: true,
    entry,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: "Select files to include in this planned commit",
    title: "Create Planned Commit",
  });

  if (!selected || selected.length === 0) {
    return;
  }

  const name = await vscode.window.showInputBox({
    placeHolder: "Optional name (e.g. feature/auth refactor)",
    prompt: "Enter an optional name for this planned commit",
    title: "Planned Commit Name",
  });

  if (name === undefined) {
    return;
  }

  const groupInputs = await promptOrganizeIntoGroups(selected.map((s) => s.entry));
  if (groupInputs === undefined) {
    return;
  }

  try {
    const snapshot = await store.createSnapshot(
      selected.map((s) => s.entry),
      name,
      groupInputs
    );
    await refreshAll();
    vscode.window.showInformationMessage(
      `Planned commit saved: ${snapshotDisplayName(snapshot)} (${snapshot.files.length} file(s)).`
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to create planned commit: ${formatError(error)}`);
  }
}

async function listSnapshots(): Promise<void> {
  if (!store) {
    return;
  }

  const snapshots = await store.listSnapshots();
  if (snapshots.length === 0) {
    vscode.window.showInformationMessage("No planned commits saved yet.");
    return;
  }

  const items = snapshots.map((snapshot) => ({
    label: snapshotDisplayName(snapshot),
    description: `${snapshotCreatedAtLabel(snapshot)} — ${snapshot.files.length} file(s) — ${snapshot.branch || "unknown branch"}`,
    detail: formatDateTime(snapshot.createdAt),
    snapshot,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a planned commit",
    title: "Commit Planner",
  });

  if (picked) {
    await vscode.commands.executeCommand("commitPlanner.snapshots.focus");
  }
}

async function resolveSnapshotItem(
  item?: SnapshotTreeItem
): Promise<Snapshot | undefined> {
  if (!store) {
    return undefined;
  }

  if (item?.snapshot) {
    return item.snapshot;
  }

  const snapshots = await store.listSnapshots();
  if (snapshots.length === 0) {
    vscode.window.showInformationMessage("No planned commits available.");
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    snapshots.map((snapshot) => ({
      label: snapshotDisplayName(snapshot),
      description: `${snapshotCreatedAtLabel(snapshot)} — ${snapshot.files.length} file(s)`,
      detail: formatDateTime(snapshot.createdAt),
      snapshot,
    })),
    { placeHolder: "Select a planned commit" }
  );

  return picked?.snapshot;
}

async function activateSnapshot(item?: SnapshotTreeItem): Promise<void> {
  const root = await ensureWorkspaceAndGit();
  if (!root || !store) {
    return;
  }

  const snapshot = await resolveSnapshotItem(item);
  if (!snapshot) {
    return;
  }

  try {
    const result = await store.activateSnapshot(snapshot.id);
    await refreshAll();
    vscode.window.showInformationMessage(
      `Planned commit activated: ${snapshotDisplayName(snapshot)} (${result.restored} restored, ${result.deleted} deleted). ` +
        "Do not modify, create, or delete snapshot files while active — changes are lost on deactivate. " +
        "Use Deactivate to recover your previous working state."
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to activate planned commit: ${formatError(error)}`);
  }
}

async function deactivateSnapshot(): Promise<void> {
  if (!store) {
    return;
  }

  try {
    await store.deactivateActiveSnapshot();
    await refreshAll();
    vscode.window.showInformationMessage("Planned commit deactivated. Previous working state restored.");
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to deactivate planned commit: ${formatError(error)}`);
  }
}

async function deleteSnapshot(item?: SnapshotTreeItem): Promise<void> {
  if (!store) {
    return;
  }

  const snapshot = await resolveSnapshotItem(item);
  if (!snapshot) {
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `Delete planned commit "${snapshotDisplayName(snapshot)}"? This cannot be undone.`,
    { modal: true },
    "Delete"
  );

  if (choice !== "Delete") {
    return;
  }

  try {
    await store.deleteSnapshot(snapshot.id);
    await refreshAll();
    vscode.window.showInformationMessage(
      `Planned commit deleted: ${snapshotDisplayName(snapshot)}.`
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to delete planned commit: ${formatError(error)}`);
  }
}

async function renameSnapshot(item?: SnapshotTreeItem): Promise<void> {
  if (!store) {
    return;
  }

  const snapshot = await resolveSnapshotItem(item);
  if (!snapshot) {
    return;
  }

  const newName = await vscode.window.showInputBox({
    value: snapshot.name ?? "",
    prompt: "Enter a new name for this planned commit",
    placeHolder: "Planned commit name",
  });

  if (newName === undefined) {
    return;
  }

  try {
    await store.renameSnapshot(snapshot.id, newName);
    await refreshAll();
    vscode.window.showInformationMessage("Planned commit renamed.");
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to rename planned commit: ${formatError(error)}`);
  }
}

async function resolveSnapshotFileItem(
  item?: SnapshotTreeItem
): Promise<{ snapshot: Snapshot; file: SnapshotFile } | undefined> {
  if (!store) {
    return undefined;
  }

  if (item?.snapshot && item.snapshotFile) {
    return { snapshot: item.snapshot, file: item.snapshotFile };
  }

  const snapshots = await store.listSnapshots();
  const fileItems: {
    label: string;
    description: string;
    snapshot: Snapshot;
    file: SnapshotFile;
  }[] = [];

  for (const snapshot of snapshots) {
    for (const file of snapshot.files) {
      fileItems.push({
        label: file.path,
        description: snapshotDisplayName(snapshot),
        snapshot,
        file,
      });
    }
  }

  if (fileItems.length === 0) {
    vscode.window.showInformationMessage("No snapshot files available.");
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(fileItems, {
    placeHolder: "Select a snapshot file",
  });

  return picked ? { snapshot: picked.snapshot, file: picked.file } : undefined;
}

async function compareFileWithSnapshot(item?: SnapshotTreeItem): Promise<void> {
  if (!store) {
    return;
  }

  const resolved = await resolveSnapshotFileItem(item);
  if (!resolved) {
    return;
  }

  const { snapshot, file } = resolved;

  if (file.state === "deleted") {
    vscode.window.showWarningMessage(
      "This file was deleted in the snapshot. There is no file content to compare."
    );
    return;
  }

  const snapshotPath = store.getSnapshotFileAbsolutePath(snapshot.id, file);
  if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    vscode.window.showErrorMessage("Snapshot file content not found.");
    return;
  }

  const workspaceRoot = requireWorkspaceRoot();
  const currentPath = workspaceFilePath(workspaceRoot, file.path);
  const snapshotUri = vscode.Uri.file(snapshotPath);
  const currentUri = vscode.Uri.file(currentPath);
  const title = `${path.basename(file.path)} (Snapshot ↔ Current)`;

  await vscode.commands.executeCommand("vscode.diff", snapshotUri, currentUri, title);
}

async function addGroup(item?: SnapshotTreeItem): Promise<void> {
  if (!store) {
    return;
  }

  const snapshot = await resolveSnapshotItem(item);
  if (!snapshot) {
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: "Group name (used as commit message when staging in Source Control)",
    placeHolder: "e.g. feat: refactor API layer",
    validateInput: (value) =>
      value.trim().length === 0 ? "Group name is required" : undefined,
  });

  if (!name) {
    return;
  }

  try {
    await store.addGroup(snapshot.id, name);
    await refreshAll();
    vscode.window.showInformationMessage(`Group "${name.trim()}" added.`);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to add group: ${formatError(error)}`);
  }
}

async function renameGroup(item?: SnapshotTreeItem): Promise<void> {
  if (!store) {
    return;
  }

  const resolved = await resolveGroupItem(item);
  if (!resolved) {
    return;
  }

  const { snapshot, group } = resolved;

  const newName = await vscode.window.showInputBox({
    value: group.name,
    prompt: "Enter a new name for the group",
    validateInput: (value) =>
      value.trim().length === 0 ? "Group name is required" : undefined,
  });

  if (!newName) {
    return;
  }

  try {
    await store.renameGroup(snapshot.id, group.id, newName);
    await refreshAll();
    vscode.window.showInformationMessage("Group renamed.");
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to rename group: ${formatError(error)}`);
  }
}

async function deleteGroup(item?: SnapshotTreeItem): Promise<void> {
  if (!store) {
    return;
  }

  const resolved = await resolveGroupItem(item);
  if (!resolved) {
    return;
  }

  const { snapshot, group } = resolved;

  const choice = await vscode.window.showWarningMessage(
    `Delete group "${group.name}"? Files will become ungrouped.`,
    { modal: true },
    "Delete"
  );

  if (choice !== "Delete") {
    return;
  }

  try {
    await store.deleteGroup(snapshot.id, group.id);
    await refreshAll();
    vscode.window.showInformationMessage(`Group "${group.name}" deleted.`);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to delete group: ${formatError(error)}`);
  }
}

async function assignFileToGroup(item?: SnapshotTreeItem): Promise<void> {
  if (!store) {
    return;
  }

  const resolved = await resolveSnapshotFileItem(item);
  if (!resolved) {
    return;
  }

  const { snapshot, file } = resolved;
  const groupId = await pickTargetGroup(snapshot, file.groupId);
  if (groupId === undefined) {
    return;
  }

  try {
    await store.assignFileToGroup(
      snapshot.id,
      file.path,
      groupId === UNGROUPED_NODE_ID ? undefined : groupId
    );
    await refreshAll();
    vscode.window.showInformationMessage("File moved to group.");
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to assign file: ${formatError(error)}`);
  }
}

async function addFilesToGroup(item?: SnapshotTreeItem): Promise<void> {
  if (!store) {
    return;
  }

  const resolved = await resolveGroupItem(item);
  if (!resolved) {
    return;
  }

  const { snapshot, group } = resolved;
  const candidates = snapshot.files.filter((f) => f.groupId !== group.id);

  if (candidates.length === 0) {
    vscode.window.showInformationMessage("All files are already in this group.");
    return;
  }

  const picked = await vscode.window.showQuickPick(
    candidates.map((file) => ({
      label: file.path,
      description: file.groupId ? "From another group" : "Ungrouped",
      file,
    })),
    {
      canPickMany: true,
      placeHolder: "Select files to add to this group",
      title: group.name,
    }
  );

  if (!picked || picked.length === 0) {
    return;
  }

  try {
    await store.assignFilesToGroup(
      snapshot.id,
      picked.map((p) => p.file.path),
      group.id
    );
    await refreshAll();
    vscode.window.showInformationMessage(`${picked.length} file(s) added to "${group.name}".`);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to add files to group: ${formatError(error)}`);
  }
}

async function resolveGroupItem(
  item?: SnapshotTreeItem
): Promise<{ snapshot: Snapshot; group: { id: string; name: string } } | undefined> {
  if (item?.snapshot && item.snapshotGroup && !item.isUngroupedNode) {
    return { snapshot: item.snapshot, group: item.snapshotGroup };
  }

  if (!store) {
    return undefined;
  }

  const snapshots = await store.listSnapshots();
  const groupItems: {
    label: string;
    description: string;
    snapshot: Snapshot;
    group: { id: string; name: string };
  }[] = [];

  for (const snapshot of snapshots) {
    for (const group of snapshot.groups ?? []) {
      const fileCount = snapshot.files.filter((f) => f.groupId === group.id).length;
      groupItems.push({
        label: group.name,
        description: `${fileCount} file(s) — ${snapshotDisplayName(snapshot)}`,
        snapshot,
        group,
      });
    }
  }

  if (groupItems.length === 0) {
    vscode.window.showInformationMessage("No groups available. Add a group first.");
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(groupItems, {
    placeHolder: "Select a group",
  });

  return picked ? { snapshot: picked.snapshot, group: picked.group } : undefined;
}

async function pickTargetGroup(
  snapshot: Snapshot,
  currentGroupId?: string
): Promise<string | undefined> {
  const groups = snapshot.groups ?? [];
  if (groups.length === 0) {
    vscode.window.showInformationMessage("No groups in this snapshot. Add a group first.");
    return undefined;
  }

  const items = [
    ...groups.map((group) => ({
      label: group.name,
      description: group.id === currentGroupId ? "Current group" : undefined,
      groupId: group.id,
    })),
    {
      label: "Ungrouped",
      description: !currentGroupId ? "Current" : undefined,
      groupId: UNGROUPED_NODE_ID,
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Move file to group",
  });

  return picked?.groupId;
}

interface StageTarget {
  snapshot: Snapshot;
  commitMessage: string;
  filePaths: string[];
  label: string;
}

function resolveStageTargetFromItem(item: SnapshotTreeItem): StageTarget | undefined {
  const snapshot = item.snapshot;
  if (!snapshot) {
    return undefined;
  }

  if (item.isActiveSnapshot && item.itemType === "snapshot") {
    if (snapshotUsesGroups(snapshot)) {
      vscode.window.showInformationMessage(
        "Use Stage Group for Commit on a group or the Ungrouped node."
      );
      return undefined;
    }

    const filePaths = snapshot.files.map((file) => file.path);
    if (filePaths.length === 0) {
      vscode.window.showInformationMessage("This planned commit has no files.");
      return undefined;
    }

    return {
      snapshot,
      commitMessage: "",
      filePaths,
      label: snapshotDisplayName(snapshot),
    };
  }

  if (item.isUngroupedNode) {
    const filePaths = snapshot.files.filter((file) => !file.groupId).map((file) => file.path);
    if (filePaths.length === 0) {
      vscode.window.showInformationMessage("No ungrouped files.");
      return undefined;
    }

    return {
      snapshot,
      commitMessage: "",
      filePaths,
      label: "Ungrouped",
    };
  }

  if (item.snapshotGroup) {
    const group = item.snapshotGroup;
    const filePaths = snapshot.files
      .filter((file) => file.groupId === group.id)
      .map((file) => file.path);

    if (filePaths.length === 0) {
      vscode.window.showInformationMessage(`Group "${group.name}" has no files.`);
      return undefined;
    }

    return {
      snapshot,
      commitMessage: group.name,
      filePaths,
      label: group.name,
    };
  }

  return undefined;
}

async function resolveStageTarget(
  item?: SnapshotTreeItem
): Promise<StageTarget | undefined> {
  if (item?.snapshot) {
    return resolveStageTargetFromItem(item);
  }

  const resolved = await resolveGroupItem(item);
  if (!resolved) {
    return undefined;
  }

  const { snapshot, group } = resolved;
  const filePaths = snapshot.files
    .filter((file) => file.groupId === group.id)
    .map((file) => file.path);

  if (filePaths.length === 0) {
    vscode.window.showInformationMessage(`Group "${group.name}" has no files.`);
    return undefined;
  }

  return {
    snapshot,
    commitMessage: group.name,
    filePaths,
    label: group.name,
  };
}

async function stageGroupForCommitCommand(item?: SnapshotTreeItem): Promise<void> {
  const root = await ensureWorkspaceAndGit();
  if (!root || !store) {
    return;
  }

  const target = await resolveStageTarget(item);
  if (!target) {
    return;
  }

  const { snapshot, commitMessage, filePaths, label } = target;

  const active = await store.getActiveSnapshotState();
  if (active?.snapshotId !== snapshot.id) {
    const snapshotName = snapshotDisplayName(snapshot);
    if (active) {
      const other = await store.getSnapshot(active.snapshotId);
      const otherName = other ? snapshotDisplayName(other) : active.snapshotId;
      vscode.window.showErrorMessage(
        `Cannot stage: "${snapshotName}" is not active ("${otherName}" is active). Activate this planned commit first.`
      );
    } else {
      vscode.window.showErrorMessage(
        `Cannot stage: "${snapshotName}" is not active. Activate it first to commit the saved snapshot versions.`
      );
    }
    return;
  }

  try {
    const result = await stageGroupForCommit(root, commitMessage, filePaths);
    const skippedNote =
      result.skipped.length > 0
        ? ` ${result.skipped.length} file(s) had no changes and were skipped.`
        : "";
    const messageNote = commitMessage
      ? `Message set to "${commitMessage}".`
      : "Commit message left empty.";
    vscode.window.showInformationMessage(
      `Staged ${result.staged.length} file(s) for "${label}". ${messageNote}${skippedNote} Review and commit in Source Control.`
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to stage: ${formatError(error)}`);
  }
}

async function openSnapshotFile(item?: SnapshotTreeItem): Promise<void> {
  if (!store) {
    return;
  }

  const resolved = await resolveSnapshotFileItem(item);
  if (!resolved) {
    return;
  }

  const { snapshot, file } = resolved;

  if (file.state === "deleted") {
    vscode.window.showWarningMessage(
      "This file was deleted in the snapshot. Nothing to open."
    );
    return;
  }

  const snapshotPath = store.getSnapshotFileAbsolutePath(snapshot.id, file);
  if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    vscode.window.showErrorMessage("Snapshot file content not found.");
    return;
  }

  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(snapshotPath));
  await vscode.window.showTextDocument(doc, { preview: true });
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
