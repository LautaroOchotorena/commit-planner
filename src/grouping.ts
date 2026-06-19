import * as vscode from "vscode";
import { promptSelectGitFiles } from "./fileSelectionQuickPick";
import { t } from "./nls";
import {
  promptReviewableInputBox,
  promptReviewableQuickPick,
  SnapshotReviewContext,
} from "./snapshotWizardReview";
import { SnapshotStore } from "./snapshotStore";
import { CreateSnapshotGroupInput, FileSelectionHint, GitStatusEntry } from "./types";

function buildReviewContext(
  entries: GitStatusEntry[],
  store: SnapshotStore,
  workspaceRoot: string,
  hints: Map<string, FileSelectionHint>
): SnapshotReviewContext {
  return { entries, hints, store, workspaceRoot };
}

export async function promptOrganizeIntoGroups(
  entries: GitStatusEntry[],
  store: SnapshotStore,
  workspaceRoot: string,
  hints: Map<string, FileSelectionHint>
): Promise<CreateSnapshotGroupInput[] | undefined> {
  const ctx = buildReviewContext(entries, store, workspaceRoot, hints);

  const choice = await promptReviewableQuickPick({
    ctx,
    title: t("Planned Commit Groups"),
    placeHolder: t("Organize files into planned commit groups?"),
    items: [
      {
        label: t("Yes, create groups"),
        description: t(
          "Each group name becomes the commit message when staging in Source Control"
        ),
        value: true as const,
      },
      {
        label: t("No, flat list"),
        description: t("Show all files without groups"),
        value: false as const,
      },
    ],
  });

  if (!choice) {
    return undefined;
  }

  if (!choice.value) {
    return [];
  }

  return promptBuildGroups(entries, store, workspaceRoot, hints);
}

export async function promptBuildGroups(
  entries: GitStatusEntry[],
  store: SnapshotStore,
  workspaceRoot: string,
  hints: Map<string, FileSelectionHint>
): Promise<CreateSnapshotGroupInput[] | undefined> {
  const ctx = buildReviewContext(entries, store, workspaceRoot, hints);
  const remaining = new Map(entries.map((e) => [e.path, e]));
  const groups: CreateSnapshotGroupInput[] = [];

  while (remaining.size > 0) {
    const groupName = await promptReviewableInputBox({
      ctx,
      prompt: t("{0} file(s) remaining — commit message for this group", remaining.size),
      placeHolder: t("e.g. fix: redirect after login"),
      title: t("New Group"),
      validateInput: (value) =>
        value.trim().length === 0 ? t("Group name is required") : undefined,
    });

    if (!groupName) {
      if (groups.length === 0) {
        return undefined;
      }
      break;
    }

    const remainingEntries = [...remaining.values()];
    const picked = await promptSelectGitFiles({
      entries: remainingEntries,
      hints,
      store,
      workspaceRoot,
      title: groupName.trim(),
      placeHolder: t("Select files for this group"),
    });

    if (!picked || picked.length === 0) {
      const tryAgain = t("Try Again");
      const cancelGrouping = t("Cancel Grouping");
      const skip = await vscode.window.showWarningMessage(
        t("No files selected for this group."),
        tryAgain,
        cancelGrouping
      );
      if (skip === cancelGrouping) {
        return groups.length > 0 ? groups : undefined;
      }
      continue;
    }

    groups.push({
      name: groupName.trim(),
      filePaths: picked.map((entry) => entry.path),
    });

    for (const entry of picked) {
      remaining.delete(entry.path);
    }

    if (remaining.size > 0) {
      const next = await promptReviewableQuickPick({
        ctx,
        placeHolder: t("{0} file(s) still unassigned", remaining.size),
        items: [
          { label: t("Add another group"), value: "more" as const },
          { label: t("Done (leave remaining ungrouped)"), value: "done" as const },
        ],
      });
      if (!next || next.value === "done") {
        break;
      }
    }
  }

  return groups;
}
