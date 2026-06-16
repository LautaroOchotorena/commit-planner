import * as vscode from "vscode";
import { promptSelectGitFiles } from "./fileSelectionQuickPick";
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
    title: "Planned Commit Groups",
    placeHolder: "Organize files into planned commit groups?",
    items: [
      {
        label: "Yes, create groups",
        description: "Each group name becomes the commit message when staging in Source Control",
        value: true as const,
      },
      {
        label: "No, flat list",
        description: "Show all files without groups",
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
      prompt: `${remaining.size} file(s) remaining — commit message for this group`,
      placeHolder: "e.g. fix: redirect after login",
      title: "New Group",
      validateInput: (value) =>
        value.trim().length === 0 ? "Group name is required" : undefined,
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
      placeHolder: "Select files for this group",
    });

    if (!picked || picked.length === 0) {
      const skip = await vscode.window.showWarningMessage(
        "No files selected for this group.",
        "Try Again",
        "Cancel Grouping"
      );
      if (skip === "Cancel Grouping") {
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
        placeHolder: `${remaining.size} file(s) still unassigned`,
        items: [
          { label: "Add another group", value: "more" as const },
          { label: "Done (leave remaining ungrouped)", value: "done" as const },
        ],
      });
      if (!next || next.value === "done") {
        break;
      }
    }
  }

  return groups;
}
