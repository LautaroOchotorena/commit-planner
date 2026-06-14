import * as vscode from "vscode";
import { formatGitStatusLabel } from "./git";
import { CreateSnapshotGroupInput, GitStatusEntry } from "./types";

export async function promptOrganizeIntoGroups(
  entries: GitStatusEntry[]
): Promise<CreateSnapshotGroupInput[] | undefined> {
  const choice = await vscode.window.showQuickPick(
    [
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
    {
      placeHolder: "Organize files into planned commit groups?",
      title: "Planned Commit Groups",
    }
  );

  if (!choice) {
    return undefined;
  }

  if (!choice.value) {
    return [];
  }

  return promptBuildGroups(entries);
}

export async function promptBuildGroups(
  entries: GitStatusEntry[]
): Promise<CreateSnapshotGroupInput[] | undefined> {
  const remaining = new Map(entries.map((e) => [e.path, e]));
  const groups: CreateSnapshotGroupInput[] = [];

  while (remaining.size > 0) {
    const groupName = await vscode.window.showInputBox({
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

    const fileItems = [...remaining.values()].map((entry) => ({
      label: entry.path,
      description: formatGitStatusLabel(entry.gitStatus),
      entry,
    }));

    const picked = await vscode.window.showQuickPick(fileItems, {
      canPickMany: true,
      placeHolder: "Select files for this group",
      title: groupName.trim(),
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
      filePaths: picked.map((p) => p.entry.path),
    });

    for (const item of picked) {
      remaining.delete(item.entry.path);
    }

    if (remaining.size > 0) {
      const next = await vscode.window.showQuickPick(
        [
          { label: "Add another group", value: "more" as const },
          { label: "Done (leave remaining ungrouped)", value: "done" as const },
        ],
        { placeHolder: `${remaining.size} file(s) still unassigned` }
      );
      if (!next || next.value === "done") {
        break;
      }
    }
  }

  return groups;
}
