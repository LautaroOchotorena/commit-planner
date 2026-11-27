import * as vscode from "vscode";
import {
  formatFileSelectionHintDetail,
  sortEntriesForSelection,
} from "./fileSelectionHints";
import {
  getFileSelectionHintIconPath,
  getFileSelectionMarkIconPath,
  getUnchangedSinceSnapshotIconPath,
} from "./fileSelectionHintVisuals";
import {
  FileSelectionRangeDirection,
  rangeDirectionFromActiveMove,
  sliceItemsForRange,
  toggleSetMembership,
} from "./fileSelectionRange";
import { formatGitStatusLabel } from "./git";
import {
  attachReviewButtons,
} from "./snapshotWizardReview";
import { SnapshotStore } from "./snapshotStore";
import { FileSelectionHint, GitStatusEntry } from "./types";
import { t } from "./nls";

export const FILE_SELECTION_PICKER_CONTEXT = "commitPlanner.fileSelectionPicker";
export const SELECT_FILES_ABOVE_COMMAND = "commitPlanner.selectFilesAbove";
export const SELECT_FILES_BELOW_COMMAND = "commitPlanner.selectFilesBelow";

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

interface FileSelectionPickerSession {
  selectRange(direction: FileSelectionRangeDirection): void;
}

let activeFileSelectionPicker: FileSelectionPickerSession | undefined;

function buildQuickPickItems(
  entries: GitStatusEntry[],
  hints: Map<string, FileSelectionHint>
): GitFileQuickPickItem[] {
  return sortEntriesForSelection(entries, hints).map((entry) => {
    const hint = hints.get(entry.path);
    const hintDetail = formatFileSelectionHintDetail(hint);
    const existenceDetail = entry.exists
      ? t("File exists on disk")
      : t("File deleted on disk");

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

function createFileSelectionLegendButtons(): vscode.QuickInputButton[] {
  return [
    {
      iconPath: getFileSelectionMarkIconPath("never_snapshotted"),
      tooltip: t("Never in a planned commit"),
    },
    {
      iconPath: getFileSelectionMarkIconPath("modified_since_snapshot"),
      tooltip: t("Changed since the most recent planned commit"),
    },
    {
      iconPath: getFileSelectionMarkIconPath("in_past_snapshot"),
      tooltip: t("In a past planned commit, not in Git status"),
    },
    {
      iconPath: getUnchangedSinceSnapshotIconPath(),
      tooltip: t("Matches the last planned commit and still in Git status"),
    },
  ];
}

function isAltKeyHeld(quickPick: vscode.QuickPick<GitFileQuickPickItem>): boolean {
  const keyMods = (quickPick as { keyMods?: { alt?: boolean } }).keyMods;
  return Boolean(keyMods?.alt);
}

export function registerFileSelectionCommands(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(SELECT_FILES_ABOVE_COMMAND, () => {
      activeFileSelectionPicker?.selectRange("above");
    }),
    vscode.commands.registerCommand(SELECT_FILES_BELOW_COMMAND, () => {
      activeFileSelectionPicker?.selectRange("below");
    })
  );
}

async function setFileSelectionPickerContext(active: boolean): Promise<void> {
  await vscode.commands.executeCommand(
    "setContext",
    FILE_SELECTION_PICKER_CONTEXT,
    active
  );
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
  quickPick.placeholder = `${placeHolder} — ${t("Alt+↑ toggle above · Alt+↓ toggle below")}`;
  quickPick.canSelectMany = true;
  // Preserve hint-based order instead of re-sorting by label.
  Object.assign(quickPick, { sortByLabel: false });
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  attachReviewButtons(quickPick, reviewCtx, () => quickPick.activeItems[0]?.entry);

  const selectAboveButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon("arrow-up"),
    tooltip: t("Toggle all files above (Alt+↑)"),
  };
  const selectBelowButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon("arrow-down"),
    tooltip: t("Toggle all files below (Alt+↓)"),
  };
  const legendButtons = createFileSelectionLegendButtons();
  quickPick.buttons = [
    ...quickPick.buttons,
    selectAboveButton,
    selectBelowButton,
    ...legendButtons,
  ];

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

  let applyingRange = false;
  let lastActivePath = quickPick.activeItems[0]?.entry.path;

  const applyRangeFromIndex = (
    activeIndex: number,
    direction: FileSelectionRangeDirection
  ): void => {
    const items = [...quickPick.items];
    const rangeItems = sliceItemsForRange(items, activeIndex, direction);
    if (rangeItems.length === 0) {
      return;
    }

    toggleSetMembership(
      pickedPaths,
      rangeItems.map((item) => item.entry.path)
    );

    const anchor = items[activeIndex];
    applyingRange = true;
    try {
      quickPick.selectedItems = items.filter((item) =>
        pickedPaths.has(item.entry.path)
      );
      if (anchor) {
        quickPick.activeItems = [anchor];
        lastActivePath = anchor.entry.path;
      }
    } finally {
      applyingRange = false;
    }
  };

  const session: FileSelectionPickerSession = {
    selectRange(direction) {
      const items = [...quickPick.items];
      const active = quickPick.activeItems[0];
      if (!active) {
        return;
      }

      const activeIndex = items.findIndex(
        (item) => item.entry.path === active.entry.path
      );
      applyRangeFromIndex(activeIndex, direction);
    },
  };

  quickPick.onDidTriggerButton((button) => {
    if (legendButtons.includes(button)) {
      return;
    }
    if (button === selectAboveButton) {
      session.selectRange("above");
      return;
    }
    if (button === selectBelowButton) {
      session.selectRange("below");
    }
  });

  // VS Code may handle Alt+↑/↓ itself (jump by separator). If our keybinding
  // does not win, detect Alt while the focused item moves and still apply the range.
  quickPick.onDidChangeActive((activeItems) => {
    const active = activeItems[0];
    const currentPath = active?.entry.path;
    if (applyingRange || !currentPath || !isAltKeyHeld(quickPick)) {
      lastActivePath = currentPath;
      return;
    }

    const items = [...quickPick.items];
    const previousIndex = lastActivePath
      ? items.findIndex((item) => item.entry.path === lastActivePath)
      : -1;
    const currentIndex = items.findIndex((item) => item.entry.path === currentPath);
    const direction = rangeDirectionFromActiveMove(previousIndex, currentIndex);
    lastActivePath = currentPath;
    if (!direction) {
      return;
    }

    applyRangeFromIndex(previousIndex, direction);
  });

  activeFileSelectionPicker = session;
  await setFileSelectionPickerContext(true);

  return new Promise((resolve) => {
    let settled = false;

    const finish = (value: GitStatusEntry[] | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (activeFileSelectionPicker === session) {
        activeFileSelectionPicker = undefined;
      }
      void setFileSelectionPickerContext(false);
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
