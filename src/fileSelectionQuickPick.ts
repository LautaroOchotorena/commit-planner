import * as vscode from "vscode";
import {
  formatFileSelectionHintDetail,
  sortEntriesForSelection,
} from "./fileSelectionHints";
import {
  getFileSelectionHintIconPath,
} from "./fileSelectionHintVisuals";
import { formatGitStatusLabel } from "./git";
import {
  attachReviewButtons,
} from "./snapshotWizardReview";
import { SnapshotStore } from "./snapshotStore";
import { FileSelectionHint, GitStatusEntry } from "./types";

interface GitFileQuickPickItem extends vscode.QuickPickItem {
  entry: GitStatusEntry;
  hint: FileSelectionHint | undefined;
}

export interface FileSelectionQuickPickOptions {
  entries: GitStatusEntry[];
  hints: Map<string, FileSelectionHint>;
  store: SnapshotStore;
  workspaceRoot: string;
  title: string;
  placeHolder: string;
  defaultPickAll?: boolean;
  initialPicked?: Set<string>;
}

function buildQuickPickItems(
  entries: GitStatusEntry[],
  hints: Map<string, FileSelectionHint>
): GitFileQuickPickItem[] {
  return sortEntriesForSelection(entries, hints).map((entry) => {
    const hint = hints.get(entry.path);
    const hintDetail = formatFileSelectionHintDetail(hint);
    const existenceDetail = entry.exists ? "File exists on disk" : "File deleted on disk";

    return {
      label: entry.path,
      description: formatGitStatusLabel(entry.gitStatus),
      detail: hintDetail ? `${hintDetail} — ${existenceDetail}` : existenceDetail,
      iconPath: getFileSelectionHintIconPath(hint),
      entry,
      hint,
      picked: false,
    };
  });
}

export async function promptSelectGitFiles(
  options: FileSelectionQuickPickOptions
): Promise<GitStatusEntry[] | undefined> {
  const {
    entries,
    hints,
    store,
    workspaceRoot,
    title,
    placeHolder,
    defaultPickAll = false,
    initialPicked,
  } = options;

  if (entries.length === 0) {
    return [];
  }

  const reviewCtx = { entries, hints, store, workspaceRoot };
  const quickPick = vscode.window.createQuickPick<GitFileQuickPickItem>();
  quickPick.title = title;
  quickPick.placeholder = placeHolder;
  quickPick.canSelectMany = true;
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  attachReviewButtons(quickPick, reviewCtx, () => quickPick.activeItems[0]?.entry);

  const pickedPaths = new Set(
    initialPicked ?? (defaultPickAll ? entries.map((entry) => entry.path) : [])
  );

  const renderItems = (): void => {
    const items = buildQuickPickItems(entries, hints);
    for (const item of items) {
      item.picked = pickedPaths.has(item.entry.path);
    }
    quickPick.items = items;
    quickPick.selectedItems = items.filter((item) => item.picked);
  };

  renderItems();

  quickPick.onDidChangeSelection((selected) => {
    pickedPaths.clear();
    for (const item of selected) {
      pickedPaths.add(item.entry.path);
    }
  });

  return new Promise((resolve) => {
    let settled = false;

    const finish = (value: GitStatusEntry[] | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      quickPick.dispose();
      resolve(value);
    };

    quickPick.onDidAccept(() => {
      finish(quickPick.selectedItems.map((item) => item.entry));
    });

    quickPick.onDidHide(() => {
      finish(undefined);
    });

    quickPick.show();
  });
}
