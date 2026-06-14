import * as vscode from "vscode";

export const GROUP_COLOR_IDS = [
  "charts.blue",
  "charts.green",
  "charts.orange",
  "charts.red",
  "charts.purple",
  "charts.yellow",
  "charts.pink",
] as const;

export const UNGROUPED_COLOR_ID = "descriptionForeground";

export function getGroupThemeColor(colorIndex: number): vscode.ThemeColor {
  return new vscode.ThemeColor(GROUP_COLOR_IDS[colorIndex % GROUP_COLOR_IDS.length]);
}

export function getUngroupedThemeColor(): vscode.ThemeColor {
  return new vscode.ThemeColor(UNGROUPED_COLOR_ID);
}

export function nextGroupColorIndex(existingGroupCount: number): number {
  return existingGroupCount % GROUP_COLOR_IDS.length;
}
