import * as vscode from "vscode";
import { FileSelectionHint, FileSelectionMark } from "./types";

interface HintDotColors {
  light: string;
  dark: string;
}

/** QuickPick ignores ThemeIcon colors; use SVG dots for mark colors. */
const HINT_DOT_COLORS: Record<FileSelectionMark, HintDotColors> = {
  never_snapshotted: {
    light: "#388a34",
    dark: "#89d185",
  },
  modified_since_snapshot: {
    light: "#bf8803",
    dark: "#cca700",
  },
  in_past_snapshot: {
    light: "#0078d4",
    dark: "#3794ff",
  },
};

function coloredDotUri(color: string): vscode.Uri {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
    `<circle cx="8" cy="8" r="5" fill="${color}"/></svg>`;
  return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

export function getFileSelectionHintIconPath(
  hint: FileSelectionHint | undefined
): { light: vscode.Uri; dark: vscode.Uri } | undefined {
  const mark = hint?.mark;
  if (!mark) {
    return undefined;
  }

  const colors = HINT_DOT_COLORS[mark];
  return {
    light: coloredDotUri(colors.light),
    dark: coloredDotUri(colors.dark),
  };
}
