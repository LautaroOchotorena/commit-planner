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

/** Outline dot for files that match the last planned commit and remain in Git status. */
const UNCHANGED_DOT_COLORS: HintDotColors = {
  light: "#6b6b6b",
  dark: "#c8c8c8",
};

function coloredDotUri(color: string, outline = false): vscode.Uri {
  const circle = outline
    ? `<circle cx="8" cy="8" r="4.25" fill="none" stroke="${color}" stroke-width="1.5"/>`
    : `<circle cx="8" cy="8" r="5" fill="${color}"/>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
    `${circle}</svg>`;
  return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

function iconPathFor(colors: HintDotColors, outline = false): { light: vscode.Uri; dark: vscode.Uri } {
  return {
    light: coloredDotUri(colors.light, outline),
    dark: coloredDotUri(colors.dark, outline),
  };
}

export function getFileSelectionMarkIconPath(
  mark: FileSelectionMark
): { light: vscode.Uri; dark: vscode.Uri } {
  return iconPathFor(HINT_DOT_COLORS[mark]);
}

export function getUnchangedSinceSnapshotIconPath(): { light: vscode.Uri; dark: vscode.Uri } {
  return iconPathFor(UNCHANGED_DOT_COLORS, true);
}

export function getFileSelectionHintIconPath(
  hint: FileSelectionHint | undefined
): { light: vscode.Uri; dark: vscode.Uri } | undefined {
  const mark = hint?.mark;
  if (!mark) {
    return undefined;
  }

  return getFileSelectionMarkIconPath(mark);
}
