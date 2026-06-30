import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { getGitStatus, isGitRepository } from "./git";
import { stageGroupForCommit } from "./gitScm";
import { computeFileSelectionHints, buildFileSelectionEntries } from "./fileSelectionHints";
import { promptSelectGitFiles } from "./fileSelectionQuickPick";
import { promptOrganizeIntoGroups } from "./grouping";
import { openDiffWithSnapshotFile } from "./snapshotCompare";
import { promptReviewableInputBox } from "./snapshotWizardReview";
import { SnapshotStore } from "./snapshotStore";
import {
  buildDeleteGroupAndFilesConfirmationMessage,
  buildRemoveFileConfirmationMessage,
  summarizeFilesForRemoval,
} from "./snapshotRemoval";
import {
  SnapshotTreeItem,
  SnapshotTreeProvider,
  UNGROUPED_NODE_ID,
} from "./snapshotTreeProvider";
import { Snapshot, SnapshotFile } from "./types";
import { t } from "./nls";
import {
  formatDateTime,
  getWorkspaceRoot,
  requireWorkspaceRoot,
  snapshotCreatedAtLabel,
  snapshotDisplayName,
  snapshotUsesGroups,
} from "./utils";

let store: SnapshotStore | undefined;
let treeProvider: SnapshotTreeProvider | undefined;
let snapshotsTreeView: vscode.TreeView<SnapshotTreeItem> | undefined;
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
  snapshotsTreeView = treeView;
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
    vscode.commands.registerCommand("commitPlanner.searchSnapshotFiles", () =>
      searchSnapshotFiles()
    ),
    vscode.commands.registerCommand("commitPlanner.clearSnapshotFileSearch", () =>
      clearSnapshotFileSearch()
    ),
    vscode.commands.registerCommand(
      "commitPlanner.addGroup",
      (item?: SnapshotTreeItem) => addGroup(item)
    ),
    vscode.commands.registerCommand(
      "commitPlanner.renameGroup",
      (item?: SnapshotTreeItem) => renameGroup(item)
    ),
    vscode.commands.registerCommand(
      "commitPlanner.undoGroup",
      (item?: SnapshotTreeItem) => undoGroup(item)
    ),
    vscode.commands.registerCommand(
      "commitPlanner.deleteGroupAndFiles",
      (item?: SnapshotTreeItem) => deleteGroupAndFiles(item)
    ),
    vscode.commands.registerCommand(
      "commitPlanner.removeFileFromSnapshot",
      (item?: SnapshotTreeItem) => removeFileFromSnapshot(item)
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
      snapshotsTreeView = undefined;
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
    vscode.window.showErrorMessage(t("Commit Planner requires an open workspace folder."));
    return undefined;
  }

  if (!(await isGitRepository(root))) {
    vscode.window.showErrorMessage(t("The workspace folder is not a Git repository."));
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
  updateSnapshotsTreeMessage();
  if (isCancelled()) {
    return;
  }
  await updateStatusBar();
}

function updateSnapshotsTreeMessage(): void {
  if (!snapshotsTreeView || !treeProvider) {
    return;
  }

  const query = treeProvider.getFileSearchQuery();
  snapshotsTreeView.message = query
    ? t("Filtering files: {0}", query)
    : undefined;
}

async function updateSnapshotFileSearchContext(): Promise<void> {
  await vscode.commands.executeCommand(
    "setContext",
    "commitPlanner.snapshotFileSearchActive",
    treeProvider?.isFilteringFiles() ?? false
  );
}

async function searchSnapshotFiles(): Promise<void> {
  if (!treeProvider) {
    return;
  }

  const query = await vscode.window.showInputBox({
    placeHolder: t("Filter by file name or path"),
    prompt: t("Type to filter files across all planned commits"),
    value: treeProvider.getFileSearchQuery() ?? "",
  });

  if (query === undefined) {
    return;
  }

  treeProvider.setFileSearchQuery(query);
  await updateSnapshotFileSearchContext();
  treeProvider.refresh();
  updateSnapshotsTreeMessage();
}

async function clearSnapshotFileSearch(): Promise<void> {
  if (!treeProvider) {
    return;
  }

  treeProvider.setFileSearchQuery(undefined);
  await updateSnapshotFileSearchContext();
  treeProvider.refresh();
  updateSnapshotsTreeMessage();
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
  statusBarItem.text = `$(git-commit) ${t("Active: {0}", label)}`;
  statusBarItem.tooltip = t(
    "A planned commit snapshot is active. Click to deactivate and restore your previous working state."
  );
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

  const deactivateLabel = t("Deactivate");
  const keepActiveLabel = t("Keep Active");

  const choice = await vscode.window.showWarningMessage(
    t(
      'A planned commit snapshot is active ("{0}"). Deactivate and restore your previous working state?',
      name
    ),
    { modal: true },
    deactivateLabel,
    keepActiveLabel
  );

  if (isCancelled()) {
    return;
  }

  if (choice === deactivateLabel) {
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

  const gitEntries = await getGitStatus(root);
  const entries = await buildFileSelectionEntries(store, root, gitEntries);
  if (entries.length === 0) {
    vscode.window.showInformationMessage(
      t("No modified files found in the working tree and no files from saved planned commits.")
    );
    return;
  }

  const hints = await computeFileSelectionHints(store, root, entries);

  const selected = await promptSelectGitFiles({
    entries,
    hints,
    store,
    workspaceRoot: root,
    title: t("Create Planned Commit"),
    placeHolder: t("Select files to include in this planned commit"),
    defaultPickAll: true,
  });

  if (!selected || selected.length === 0) {
    return;
  }

  const name = await promptReviewableInputBox({
    ctx: { entries: selected, hints, store, workspaceRoot: root },
    placeHolder: t("Optional name (e.g. feature/auth refactor)"),
    prompt: t("Enter an optional name for this planned commit"),
    title: t("Planned Commit Name"),
  });

  if (name === undefined) {
    return;
  }

  const groupInputs = await promptOrganizeIntoGroups(selected, store, root, hints);
  if (groupInputs === undefined) {
    return;
  }

  try {
    const snapshot = await store.createSnapshot(
      selected,
      name,
      groupInputs
    );
    await refreshAll();
    vscode.window.showInformationMessage(
      t("Planned commit saved: {0} ({1} file(s)).", snapshotDisplayName(snapshot), snapshot.files.length)
    );
  } catch (error) {
    vscode.window.showErrorMessage(t("Failed to create planned commit: {0}", formatError(error)));
  }
}

async function listSnapshots(): Promise<void> {
  if (!store) {
    return;
  }

  const snapshots = await store.listSnapshots();
  if (snapshots.length === 0) {
    vscode.window.showInformationMessage(t("No planned commits saved yet."));
    return;
  }

  const items = snapshots.map((snapshot) => ({
    label: snapshotDisplayName(snapshot),
    description: `${snapshotCreatedAtLabel(snapshot)} — ${t("{0} file(s)", snapshot.files.length)} — ${snapshot.branch || t("unknown branch")}`,
    detail: formatDateTime(snapshot.createdAt),
    snapshot,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: t("Select a planned commit"),
    title: t("Commit Planner"),
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
    vscode.window.showInformationMessage(t("No planned commits available."));
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    snapshots.map((snapshot) => ({
      label: snapshotDisplayName(snapshot),
      description: `${snapshotCreatedAtLabel(snapshot)} — ${t("{0} file(s)", snapshot.files.length)}`,
      detail: formatDateTime(snapshot.createdAt),
      snapshot,
    })),
    { placeHolder: t("Select a planned commit") }
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
      t(
        "Planned commit activated: {0} ({1} restored, {2} deleted). Do not modify, create, or delete snapshot files while active — changes are lost on deactivate. Use Deactivate to recover your previous working state.",
        snapshotDisplayName(snapshot),
        result.restored,
        result.deleted
      )
    );
  } catch (error) {
    vscode.window.showErrorMessage(t("Failed to activate planned commit: {0}", formatError(error)));
  }
}

async function deactivateSnapshot(): Promise<void> {
  if (!store) {
    return;
  }

  try {
    await store.deactivateActiveSnapshot();
    await refreshAll();
    vscode.window.showInformationMessage(
      t("Planned commit deactivated. Previous working state restored.")
    );
  } catch (error) {
    vscode.window.showErrorMessage(t("Failed to deactivate planned commit: {0}", formatError(error)));
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

  const deleteLabel = t("Delete");

  const choice = await vscode.window.showWarningMessage(
    t('Delete planned commit "{0}"? This cannot be undone.', snapshotDisplayName(snapshot)),
    { modal: true },
    deleteLabel
  );

  if (choice !== deleteLabel) {
    return;
  }

  try {
    await store.deleteSnapshot(snapshot.id);
    await refreshAll();
    vscode.window.showInformationMessage(
      t("Planned commit deleted: {0}.", snapshotDisplayName(snapshot))
    );
  } catch (error) {
    vscode.window.showErrorMessage(t("Failed to delete planned commit: {0}", formatError(error)));
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
    prompt: t("Enter a new name for this planned commit"),
    placeHolder: t("Planned commit name"),
  });

  if (newName === undefined) {
    return;
  }

  try {
    await store.renameSnapshot(snapshot.id, newName);
    await refreshAll();
    vscode.window.showInformationMessage(t("Planned commit renamed."));
  } catch (error) {
    vscode.window.showErrorMessage(t("Failed to rename planned commit: {0}", formatError(error)));
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
    vscode.window.showInformationMessage(t("No snapshot files available."));
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(fileItems, {
    placeHolder: t("Select a snapshot file"),
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
  const workspaceRoot = requireWorkspaceRoot();
  await openDiffWithSnapshotFile(store, workspaceRoot, snapshot, file);
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
    prompt: t("Group name (used as commit message when staging in Source Control)"),
    placeHolder: t("e.g. feat: refactor API layer"),
    validateInput: (value) =>
      value.trim().length === 0 ? t("Group name is required") : undefined,
  });

  if (!name) {
    return;
  }

  try {
    await store.addGroup(snapshot.id, name);
    await refreshAll();
    vscode.window.showInformationMessage(t('Group "{0}" added.', name.trim()));
  } catch (error) {
    vscode.window.showErrorMessage(t("Failed to add group: {0}", formatError(error)));
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
    prompt: t("Enter a new name for the group"),
    validateInput: (value) =>
      value.trim().length === 0 ? t("Group name is required") : undefined,
  });

  if (!newName) {
    return;
  }

  try {
    await store.renameGroup(snapshot.id, group.id, newName);
    await refreshAll();
    vscode.window.showInformationMessage(t("Group renamed."));
  } catch (error) {
    vscode.window.showErrorMessage(t("Failed to rename group: {0}", formatError(error)));
  }
}

async function undoGroup(item?: SnapshotTreeItem): Promise<void> {
  if (!store) {
    return;
  }

  const resolved = await resolveGroupItem(item);
  if (!resolved) {
    return;
  }

  const { snapshot, group } = resolved;

  try {
    await store.undoGroup(snapshot.id, group.id);
    await refreshAll();
    vscode.window.showInformationMessage(
      t('Group "{0}" removed. Files are now ungrouped.', group.name)
    );
  } catch (error) {
    vscode.window.showErrorMessage(t("Failed to undo group: {0}", formatError(error)));
  }
}

async function deleteGroupAndFiles(item?: SnapshotTreeItem): Promise<void> {
  if (!store) {
    return;
  }

  const resolved = await resolveGroupItem(item);
  if (!resolved) {
    return;
  }

  const { snapshot, group } = resolved;

  if (!(await ensureSnapshotNotActiveForModification(snapshot.id))) {
    return;
  }

  const groupFiles = snapshot.files.filter((f) => f.groupId === group.id);
  const summary = summarizeFilesForRemoval(groupFiles);
  const snapshotWillBeDeleted = groupFiles.length === snapshot.files.length;

  const deleteGroupAndFilesLabel = t("Delete Group and Files");

  const choice = await vscode.window.showWarningMessage(
    buildDeleteGroupAndFilesConfirmationMessage(
      group.name,
      summary,
      snapshotWillBeDeleted
    ),
    { modal: true },
    deleteGroupAndFilesLabel
  );

  if (choice !== deleteGroupAndFilesLabel) {
    return;
  }

  try {
    const result = await store.deleteGroupAndFiles(snapshot.id, group.id);
    await refreshAll();
    if (result.snapshotDeleted) {
      vscode.window.showInformationMessage(
        t(
          'Group "{0}" and its files were removed. The planned commit was deleted because it had no files left.',
          group.name
        )
      );
    } else {
      vscode.window.showInformationMessage(
        t('Group "{0}" and {1} file(s) removed from the planned commit.', group.name, summary.total)
      );
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      t("Failed to delete group and files: {0}", formatError(error))
    );
  }
}

async function removeFileFromSnapshot(item?: SnapshotTreeItem): Promise<void> {
  if (!store) {
    return;
  }

  const resolved = await resolveSnapshotFileItem(item);
  if (!resolved) {
    return;
  }

  const { snapshot, file } = resolved;

  if (!(await ensureSnapshotNotActiveForModification(snapshot.id))) {
    return;
  }

  const snapshotWillBeDeleted = snapshot.files.length === 1;

  const removeLabel = t("Remove");

  const choice = await vscode.window.showWarningMessage(
    buildRemoveFileConfirmationMessage(file, snapshotWillBeDeleted),
    { modal: true },
    removeLabel
  );

  if (choice !== removeLabel) {
    return;
  }

  try {
    const result = await store.removeFileFromSnapshot(snapshot.id, file.path);
    await refreshAll();
    if (result.snapshotDeleted) {
      vscode.window.showInformationMessage(
        t(
          '"{0}" was removed. The planned commit was deleted because it had no files left.',
          file.path
        )
      );
    } else {
      vscode.window.showInformationMessage(
        t('"{0}" removed from the planned commit.', file.path)
      );
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      t("Failed to remove file from planned commit: {0}", formatError(error))
    );
  }
}

async function ensureSnapshotNotActiveForModification(
  snapshotId: string
): Promise<boolean> {
  if (!store) {
    return false;
  }

  const active = await store.getActiveSnapshotState();
  if (active?.snapshotId === snapshotId) {
    vscode.window.showErrorMessage(
      t("Cannot modify the active planned commit. Deactivate it first.")
    );
    return false;
  }

  return true;
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
    vscode.window.showInformationMessage(t("File moved to group."));
  } catch (error) {
    vscode.window.showErrorMessage(t("Failed to assign file: {0}", formatError(error)));
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
    vscode.window.showInformationMessage(t("All files are already in this group."));
    return;
  }

  const picked = await vscode.window.showQuickPick(
    candidates.map((file) => ({
      label: file.path,
      description: file.groupId ? t("From another group") : t("Ungrouped"),
      file,
    })),
    {
      canPickMany: true,
      placeHolder: t("Select files to add to this group"),
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
    vscode.window.showInformationMessage(
      t('{0} file(s) added to "{1}".', picked.length, group.name)
    );
  } catch (error) {
    vscode.window.showErrorMessage(t("Failed to add files to group: {0}", formatError(error)));
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
        description: t("{0} file(s) — {1}", fileCount, snapshotDisplayName(snapshot)),
        snapshot,
        group,
      });
    }
  }

  if (groupItems.length === 0) {
    vscode.window.showInformationMessage(t("No groups available. Add a group first."));
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(groupItems, {
    placeHolder: t("Select a group"),
  });

  return picked ? { snapshot: picked.snapshot, group: picked.group } : undefined;
}

async function pickTargetGroup(
  snapshot: Snapshot,
  currentGroupId?: string
): Promise<string | undefined> {
  const groups = snapshot.groups ?? [];
  if (groups.length === 0) {
    vscode.window.showInformationMessage(t("No groups in this snapshot. Add a group first."));
    return undefined;
  }

  const items = [
    ...groups.map((group) => ({
      label: group.name,
      description: group.id === currentGroupId ? t("Current group") : undefined,
      groupId: group.id,
    })),
    {
      label: t("Ungrouped"),
      description: !currentGroupId ? t("Current") : undefined,
      groupId: UNGROUPED_NODE_ID,
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: t("Move file to group"),
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
        t("Use Stage Group for Commit on a group or the Ungrouped node.")
      );
      return undefined;
    }

    const filePaths = snapshot.files.map((file) => file.path);
    if (filePaths.length === 0) {
      vscode.window.showInformationMessage(t("This planned commit has no files."));
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
      vscode.window.showInformationMessage(t("No ungrouped files."));
      return undefined;
    }

    return {
      snapshot,
      commitMessage: "",
      filePaths,
      label: t("Ungrouped"),
    };
  }

  if (item.snapshotGroup) {
    const group = item.snapshotGroup;
    const filePaths = snapshot.files
      .filter((file) => file.groupId === group.id)
      .map((file) => file.path);

    if (filePaths.length === 0) {
      vscode.window.showInformationMessage(t('Group "{0}" has no files.', group.name));
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
    vscode.window.showInformationMessage(t('Group "{0}" has no files.', group.name));
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
        t(
          'Cannot stage: "{0}" is not active ("{1}" is active). Activate this planned commit first.',
          snapshotName,
          otherName
        )
      );
    } else {
      vscode.window.showErrorMessage(
        t(
          'Cannot stage: "{0}" is not active. Activate it first to commit the saved snapshot versions.',
          snapshotName
        )
      );
    }
    return;
  }

  try {
    const result = await stageGroupForCommit(root, commitMessage, filePaths);
    const skippedNote =
      result.skipped.length > 0
        ? t(" {0} file(s) had no changes and were skipped.", result.skipped.length)
        : "";
    const messageNote = commitMessage
      ? t('Message set to "{0}".', commitMessage)
      : t("Commit message left empty.");
    vscode.window.showInformationMessage(
      t(
        'Staged {0} file(s) for "{1}". {2}{3} Review and commit in Source Control.',
        result.staged.length,
        label,
        messageNote,
        skippedNote
      )
    );
  } catch (error) {
    vscode.window.showErrorMessage(t("Failed to stage: {0}", formatError(error)));
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
      t("This file was deleted in the snapshot. Nothing to open.")
    );
    return;
  }

  const snapshotPath = store.getSnapshotFileAbsolutePath(snapshot.id, file);
  if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    vscode.window.showErrorMessage(t("Snapshot file content not found."));
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
