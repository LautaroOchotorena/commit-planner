import * as vscode from "vscode";
import { formatGitStatusLabel } from "./git";
import { getGroupThemeColor, getUngroupedThemeColor } from "./groupColors";
import { t } from "./nls";
import { SnapshotStore } from "./snapshotStore";
import { Snapshot, SnapshotFile, SnapshotGroup } from "./types";
import { formatDateTime, snapshotCreatedAtLabel, snapshotDisplayName, snapshotUsesGroups } from "./utils";

export const UNGROUPED_NODE_ID = "__ungrouped__";

export type SnapshotTreeItemType = "snapshot" | "snapshotGroup" | "snapshotFile";

export class SnapshotTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType: SnapshotTreeItemType,
    public readonly snapshot?: Snapshot,
    public readonly snapshotGroup?: SnapshotGroup,
    public readonly snapshotFile?: SnapshotFile,
    public readonly isUngroupedNode?: boolean,
    public readonly isActiveSnapshot?: boolean
  ) {
    super(label, collapsibleState);
    if (itemType === "snapshot" && isActiveSnapshot) {
      this.contextValue = "activeSnapshot";
    } else {
      this.contextValue =
        itemType === "snapshotGroup" && isUngroupedNode ? "ungroupedGroup" : itemType;
    }

    if (itemType === "snapshot" && snapshot) {
      this.id = `snapshot:${snapshot.id}`;
      this.tooltip = this.buildSnapshotTooltip(snapshot);
      const groupCount = snapshot.groups?.length ?? 0;
      const createdLabel = snapshotCreatedAtLabel(snapshot);
      const fileSummary =
        groupCount > 0
          ? t("{0} file(s), {1} group(s)", snapshot.files.length, groupCount)
          : t("{0} file(s)", snapshot.files.length);
      const baseDescription = `${createdLabel} — ${fileSummary}`;
      this.description = isActiveSnapshot ? `${baseDescription}${t(" — Active")}` : baseDescription;
      this.iconPath = isActiveSnapshot
        ? new vscode.ThemeIcon("check", new vscode.ThemeColor("charts.yellow"))
        : new vscode.ThemeIcon("history");
    }

    if (itemType === "snapshotGroup" && snapshot) {
      const group = snapshotGroup;
      const isUngrouped = isUngroupedNode === true;
      const groupId = isUngrouped ? UNGROUPED_NODE_ID : group?.id ?? UNGROUPED_NODE_ID;
      this.id = `snapshot:${snapshot.id}:group:${groupId}`;

      if (isUngrouped) {
        this.tooltip = t("Files not assigned to any group");
        this.iconPath = new vscode.ThemeIcon("folder", getUngroupedThemeColor());
      } else if (group) {
        this.tooltip = `${group.name}\n${t("Created: {0}", formatDateTime(group.createdAt))}`;
        this.iconPath = new vscode.ThemeIcon("git-commit", getGroupThemeColor(group.colorIndex));
      }
    }

    if (itemType === "snapshotFile" && snapshotFile && snapshot) {
      this.id = `snapshot:${snapshot.id}:file:${snapshotFile.path}`;
      this.tooltip = `${snapshotFile.path} (${snapshotFile.gitStatus})`;
      this.description = formatGitStatusLabel(snapshotFile.gitStatus);

      const group = snapshotFile.groupId
        ? snapshot.groups?.find((g) => g.id === snapshotFile.groupId)
        : undefined;
      const color = group
        ? getGroupThemeColor(group.colorIndex)
        : snapshotUsesGroups(snapshot)
          ? getUngroupedThemeColor()
          : undefined;

      const iconId = snapshotFile.state === "deleted" ? "diff-removed" : "file";
      this.iconPath = color
        ? new vscode.ThemeIcon(iconId, color)
        : new vscode.ThemeIcon(iconId);
    }
  }

  private buildSnapshotTooltip(snapshot: Snapshot): string {
    const lines = [
      snapshotDisplayName(snapshot),
      t("Created: {0}", formatDateTime(snapshot.createdAt)),
      t("Branch: {0}", snapshot.branch || t("(unknown)")),
      t("Files: {0}", snapshot.files.length),
    ];
    if (snapshot.groups && snapshot.groups.length > 0) {
      lines.push(t("Groups: {0}", snapshot.groups.length));
    }
    return lines.join("\n");
  }
}

export class SnapshotTreeProvider
  implements vscode.TreeDataProvider<SnapshotTreeItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    SnapshotTreeItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly store: SnapshotStore) {}

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SnapshotTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SnapshotTreeItem): Promise<SnapshotTreeItem[]> {
    if (!element) {
      const snapshots = await this.store.listSnapshots();
      if (snapshots.length === 0) {
        const empty = new SnapshotTreeItem(
          t("No planned commits yet"),
          vscode.TreeItemCollapsibleState.None,
          "snapshotFile"
        );
        empty.contextValue = "empty";
        return [empty];
      }

      const active = await this.store.getActiveSnapshotState();

      return snapshots.map(
        (snapshot) =>
          new SnapshotTreeItem(
            snapshotDisplayName(snapshot),
            vscode.TreeItemCollapsibleState.Collapsed,
            "snapshot",
            snapshot,
            undefined,
            undefined,
            false,
            active?.snapshotId === snapshot.id
          )
      );
    }

    if (element.itemType === "snapshot" && element.snapshot) {
      return this.getSnapshotChildren(element.snapshot);
    }

    if (element.itemType === "snapshotGroup" && element.snapshot) {
      return this.getGroupChildren(element.snapshot, element.snapshotGroup, element.isUngroupedNode);
    }

    return [];
  }

  private getSnapshotChildren(snapshot: Snapshot): SnapshotTreeItem[] {
    if (!snapshotUsesGroups(snapshot)) {
      return snapshot.files.map((file) => this.createFileItem(snapshot, file));
    }

    const items: SnapshotTreeItem[] = [];

    for (const group of snapshot.groups ?? []) {
      const fileCount = snapshot.files.filter((f) => f.groupId === group.id).length;
      items.push(
        new SnapshotTreeItem(
          group.name,
          vscode.TreeItemCollapsibleState.Collapsed,
          "snapshotGroup",
          snapshot,
          group,
          undefined,
          false
        )
      );
      const groupItem = items[items.length - 1];
      groupItem.description = t("{0} file(s)", fileCount);
    }

    const ungrouped = snapshot.files.filter((f) => !f.groupId);
    if (ungrouped.length > 0) {
      const ungroupedItem = new SnapshotTreeItem(
        t("Ungrouped"),
        vscode.TreeItemCollapsibleState.Collapsed,
        "snapshotGroup",
        snapshot,
        undefined,
        undefined,
        true
      );
      ungroupedItem.description = t("{0} file(s)", ungrouped.length);
      items.push(ungroupedItem);
    }

    return items;
  }

  private getGroupChildren(
    snapshot: Snapshot,
    group?: SnapshotGroup,
    isUngroupedNode?: boolean
  ): SnapshotTreeItem[] {
    const files = isUngroupedNode
      ? snapshot.files.filter((f) => !f.groupId)
      : snapshot.files.filter((f) => f.groupId === group?.id);

    return files.map((file) => this.createFileItem(snapshot, file));
  }

  private createFileItem(snapshot: Snapshot, file: SnapshotFile): SnapshotTreeItem {
    return new SnapshotTreeItem(
      file.path,
      vscode.TreeItemCollapsibleState.None,
      "snapshotFile",
      snapshot,
      undefined,
      file
    );
  }
}
