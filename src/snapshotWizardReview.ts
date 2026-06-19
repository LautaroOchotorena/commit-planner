import * as vscode from "vscode";
import { formatFileSelectionHintDetail } from "./fileSelectionHints";
import {
  getFileSelectionHintIconPath,
} from "./fileSelectionHintVisuals";
import { formatGitStatusLabel } from "./git";
import { t } from "./nls";
import { openDiffWithMostRecentSnapshot } from "./snapshotCompare";
import { SnapshotStore } from "./snapshotStore";
import { FileSelectionHint, GitStatusEntry } from "./types";
import { workspaceFilePath } from "./utils";

export interface SnapshotReviewContext {
  entries: GitStatusEntry[];
  hints: Map<string, FileSelectionHint>;
  store: SnapshotStore;
  workspaceRoot: string;
}

export type ReviewQuickInputButton = vscode.QuickInputButton & {
  reviewAction: "open" | "compare";
};

function createReviewButtons(): ReviewQuickInputButton[] {
  return [
    {
      iconPath: new vscode.ThemeIcon("file"),
      tooltip: t("Open File"),
      reviewAction: "open",
    },
    {
      iconPath: new vscode.ThemeIcon("diff"),
      tooltip: t("Compare with Last Snapshot"),
      reviewAction: "compare",
    },
  ];
}

export async function openWorkspaceFileForReview(
  workspaceRoot: string,
  entry: GitStatusEntry
): Promise<void> {
  if (!entry.exists) {
    vscode.window.showWarningMessage(
      t('"{0}" is deleted on disk. There is no file to open.', entry.path)
    );
    return;
  }

  const filePath = workspaceFilePath(workspaceRoot, entry.path);
  const uri = vscode.Uri.file(filePath);
  await vscode.window.showTextDocument(uri, {
    preview: true,
    preserveFocus: true,
  });
}

interface ReviewEntryQuickPickItem extends vscode.QuickPickItem {
  entry: GitStatusEntry;
}

async function promptPickEntryForReview(
  ctx: SnapshotReviewContext
): Promise<GitStatusEntry | undefined> {
  if (ctx.entries.length === 0) {
    vscode.window.showInformationMessage(t("No files available to review."));
    return undefined;
  }

  if (ctx.entries.length === 1) {
    return ctx.entries[0];
  }

  const items: ReviewEntryQuickPickItem[] = ctx.entries.map((entry) => {
    const hint = ctx.hints.get(entry.path);
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
    };
  });

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: t("Select a file to review"),
    title: t("Review File"),
    ignoreFocusOut: true,
  });

  return picked?.entry;
}

export async function handleReviewButton(
  button: vscode.QuickInputButton,
  ctx: SnapshotReviewContext,
  entry?: GitStatusEntry
): Promise<void> {
  const target = entry ?? (await promptPickEntryForReview(ctx));
  if (!target) {
    return;
  }

  const reviewAction = (button as ReviewQuickInputButton).reviewAction;

  if (reviewAction === "open") {
    await openWorkspaceFileForReview(ctx.workspaceRoot, target);
    return;
  }

  if (reviewAction === "compare") {
    await openDiffWithMostRecentSnapshot(
      ctx.store,
      ctx.workspaceRoot,
      target.path,
      ctx.hints.get(target.path)
    );
  }
}

export function attachReviewButtons(
  quickInput: vscode.QuickPick<vscode.QuickPickItem> | vscode.InputBox,
  ctx: SnapshotReviewContext,
  getActiveEntry?: () => GitStatusEntry | undefined
): void {
  quickInput.ignoreFocusOut = true;
  quickInput.buttons = createReviewButtons();
  quickInput.onDidTriggerButton(async (button) => {
    await handleReviewButton(button, ctx, getActiveEntry?.());
  });
}

export interface ReviewableInputBoxOptions {
  ctx: SnapshotReviewContext;
  title: string;
  prompt: string;
  placeHolder?: string;
  value?: string;
  validateInput?: (value: string) => string | undefined;
}

export async function promptReviewableInputBox(
  options: ReviewableInputBoxOptions
): Promise<string | undefined> {
  const input = vscode.window.createInputBox();
  input.title = options.title;
  input.prompt = options.prompt;
  input.placeholder = options.placeHolder;
  input.value = options.value ?? "";
  attachReviewButtons(input, options.ctx);

  if (options.validateInput) {
    input.onDidChangeValue((value) => {
      input.validationMessage = options.validateInput?.(value);
    });
  }

  return new Promise((resolve) => {
    let settled = false;

    const finish = (value: string | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      input.dispose();
      resolve(value);
    };

    input.onDidAccept(() => {
      if (options.validateInput) {
        const message = options.validateInput(input.value);
        if (message) {
          input.validationMessage = message;
          return;
        }
      }
      finish(input.value);
    });

    input.onDidHide(() => {
      finish(undefined);
    });

    input.show();
  });
}

export interface ReviewableQuickPickOptions<T extends vscode.QuickPickItem> {
  ctx: SnapshotReviewContext;
  title?: string;
  placeHolder?: string;
  items: T[];
  canSelectMany?: boolean;
}

export async function promptReviewableQuickPick<T extends vscode.QuickPickItem>(
  options: ReviewableQuickPickOptions<T>
): Promise<T | undefined> {
  const quickPick = vscode.window.createQuickPick<T>();
  quickPick.title = options.title;
  quickPick.placeholder = options.placeHolder;
  quickPick.canSelectMany = options.canSelectMany ?? false;
  quickPick.items = options.items;
  attachReviewButtons(quickPick, options.ctx);

  return new Promise((resolve) => {
    let settled = false;

    const finish = (value: T | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      quickPick.dispose();
      resolve(value);
    };

    quickPick.onDidAccept(() => {
      finish(quickPick.selectedItems[0]);
    });

    quickPick.onDidHide(() => {
      finish(undefined);
    });

    quickPick.show();
  });
}
