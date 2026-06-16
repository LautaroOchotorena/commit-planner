import * as path from "path";
import * as vscode from "vscode";
import { pathExists } from "./ioUtils";
import { SnapshotStore } from "./snapshotStore";
import { FileSelectionHint, Snapshot, SnapshotFile } from "./types";
import { workspaceFilePath } from "./utils";

export async function openDiffWithSnapshotFile(
  store: SnapshotStore,
  workspaceRoot: string,
  snapshot: Snapshot,
  file: SnapshotFile
): Promise<void> {
  if (file.state === "deleted") {
    vscode.window.showWarningMessage(
      "This file was deleted in the snapshot. There is no file content to compare."
    );
    return;
  }

  const snapshotPath = store.getSnapshotFileAbsolutePath(snapshot.id, file);
  if (!snapshotPath || !(await pathExists(snapshotPath))) {
    vscode.window.showErrorMessage("Snapshot file content not found.");
    return;
  }

  const currentPath = workspaceFilePath(workspaceRoot, file.path);
  const snapshotUri = vscode.Uri.file(snapshotPath);
  const currentUri = vscode.Uri.file(currentPath);
  const title = `${path.basename(file.path)} (Snapshot ↔ Current)`;

  await vscode.commands.executeCommand("vscode.diff", snapshotUri, currentUri, title);
}

export async function openDiffWithMostRecentSnapshot(
  store: SnapshotStore,
  workspaceRoot: string,
  relativePath: string,
  hint: FileSelectionHint | undefined
): Promise<void> {
  if (!hint?.snapshotId) {
    vscode.window.showInformationMessage(
      "This file has not appeared in any previous planned commit."
    );
    return;
  }

  const file = await store.findSnapshotFile(hint.snapshotId, relativePath);
  if (!file) {
    vscode.window.showErrorMessage("Snapshot file not found.");
    return;
  }

  const snapshot = await store.getSnapshot(hint.snapshotId);
  if (!snapshot) {
    vscode.window.showErrorMessage("Snapshot not found.");
    return;
  }

  await openDiffWithSnapshotFile(store, workspaceRoot, snapshot, file);
}
