# Commit Planner

A VS Code extension that lets you save **planned commits** as snapshots of selected working tree files. Activate a snapshot to swap those files into your workspace temporarily, organize them into **colored commit groups**, stage each group in Source Control, and deactivate to restore your previous working state.

You always commit and push manually.

## What it does

- Reads changed files from `git status --porcelain`
- Lets you pick which files to save (modified, added, deleted, untracked, etc.)
- Highlights files during selection: never saved before, or changed since the most recent planned commit that included them
- Files from saved planned commits that no longer appear in `git status` are still offered for selection (e.g. after reverting a file to match HEAD while an older planned commit still holds a different version)
- Color-coded dots in the file picker: green = never in a planned commit, orange = changed since a past planned commit, blue = in a past planned commit but clean vs Git
- While configuring a planned commit, open or diff files from the picker without losing your place in the wizard
- **Open File** and **Compare with Last Snapshot** toolbar buttons on every snapshot setup step (file selection, name, groups, and group assignment)
- Stores exact file copies in internal storage (outside the repo by default)
- Provides a **Commit Planner** side panel with colored **commit groups**
- **Search Files** in the panel toolbar — filter planned commits by file name or path across all snapshots
- **Activate** a snapshot — backs up the current version of each snapshot file, then applies the saved copies (or deletions)
- **Deactivate** — restores the backed-up files so you can return to your previous work
- **Stage Group for Commit** — stages a group's files in Git and fills the SCM commit message with the group name (only while that snapshot is active)

## What it does NOT do

- No automatic `git commit`
- No `git push`
- No commit-hash restore or optional file recovery — only the files you explicitly selected are saved and swapped

The extension may run `git add` only when you explicitly choose **Stage Group for Commit** (or stage Ungrouped / all files on flat snapshots).

## Recommended workflow

1. **Create a planned commit** from your current working tree changes and organize files into groups (group name = commit message)
2. Keep working on other things (your newer versions stay on disk while the snapshot is inactive)
3. When ready to commit the planned version, **activate** the snapshot
4. For each group, use **Stage Group for Commit**; for ungrouped files or flat snapshots, use **Stage for Commit** (empty commit message)
5. Review staged changes in **Source Control**, **commit manually**, then **push** when ready
6. **Deactivate** the snapshot to restore your newer working state on the same files
7. Repeat for other saved planned commits whenever you want

You can maintain several snapshots at once, each representing a different planned commit.

## How activation works

When you activate a snapshot:

1. For each file in the snapshot, the extension backs up the current workspace file (or records that it was missing)
2. Snapshot files are applied — copies are written to disk, or files are deleted if the snapshot recorded a deletion
3. Files **not** in the snapshot are left unchanged
4. Activation is allowed only on the **same Git branch** and **same workspace folder** where the snapshot was created

When you deactivate:

- Every backed-up file is restored to how it was before activation
- Files that did not exist before activation are removed again

## While a snapshot is active

**Do not modify, create, or delete files that belong to the active snapshot** (the paths you included when you created it).

The extension only backs up the state **immediately before activation**. Any manual edits while the snapshot is active are **not preserved** — deactivate restores that pre-activation state and your changes are lost.

Recommended flow: activate → stage → commit → push → deactivate to get your newer work back.

## Staging rules

- **Stage Group for Commit** is blocked unless that planned commit is **active**
- **Groups** — SCM commit message is set to the group name
- **Ungrouped** (when groups exist) — stages ungrouped files with an **empty** commit message
- **Flat snapshots** (no groups) — use **Stage for Commit** on the active snapshot node; stages all snapshot files with an **empty** commit message

## Commands

| Command | ID |
|---------|-----|
| Create Planned Commit | `commitPlanner.createSnapshot` |
| List Planned Commits | `commitPlanner.listSnapshots` |
| Activate | `commitPlanner.activateSnapshot` |
| Deactivate | `commitPlanner.deactivateSnapshot` |
| Stage Group for Commit | `commitPlanner.stageGroupForCommit` |
| Delete | `commitPlanner.deleteSnapshot` |
| Rename | `commitPlanner.renameSnapshot` |
| Compare File With Snapshot | `commitPlanner.compareFileWithSnapshot` |
| Open Snapshot File | `commitPlanner.openSnapshotFile` |
| Add Group | `commitPlanner.addGroup` |
| Rename Group | `commitPlanner.renameGroup` |
| Undo Group | `commitPlanner.undoGroup` |
| Delete Group and Files | `commitPlanner.deleteGroupAndFiles` |
| Remove from Planned Commit | `commitPlanner.removeFileFromSnapshot` |
| Move to Group | `commitPlanner.assignFileToGroup` |
| Add Files to Group | `commitPlanner.addFilesToGroup` |
| Search Files | `commitPlanner.searchSnapshotFiles` |
| Clear File Search | `commitPlanner.clearSnapshotFileSearch` |

## Searching files in snapshots

Use the **Search Files** button (magnifying glass) in the Commit Planner panel toolbar to filter by file name or path. The filter matches against the full path and the file name (case-insensitive). Only planned commits and groups that contain matching files are shown, and matching nodes expand automatically. Clear the filter with the **Clear File Search** button or by submitting an empty search. While a filter is active, the panel shows a status message with the current query.

## Commit groups

Within each planned commit you can organize files into **commit groups**:

- **Group name** = commit message used in Source Control when staging
- Each group has a distinct **color in the Commit Planner panel only** (not in the file Explorer)
- **Stage Group for Commit** (inline button on a group): runs `git add` on the group's changed files, sets the SCM input to the group name, and focuses Source Control
- **Undo Group** — removes the group and moves its files to Ungrouped (files stay in the planned commit)
- **Delete Group and Files** — removes the group and its files from the planned commit (blocked while active)
- **Remove from Planned Commit** on a file — removes that file from the snapshot (blocked while active)
- **Ungrouped** node: stages ungrouped files with an empty commit message
- Only files with current working-tree changes are staged; unchanged paths are skipped

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `commitPlanner.storageLocation` | `workspaceStorage` | `workspaceStorage` (VS Code storage, outside repo) or `insideWorkspace` (`.commit-planner/`) |
| `commitPlanner.blockActivationWithStagedChanges` | `true` | Block activation when staged changes exist |

## Language

The extension UI (commands, messages, tree labels, confirmations) is available in **English** and **Spanish**. It follows your VS Code display language (`Configure Display Language` → `es` for Spanish). Commit group names and file paths you enter are not translated.

## Status bar

When a snapshot is active, the status bar shows:

```
Active: <name or date>
```

Click it to deactivate and restore your previous working state.

## Storage layout

Default location: VS Code workspace storage (`context.storageUri`).

```
snapshots/
  snapshots.json
  <snapshot-id>/
    metadata.json
    files/
      <normalized-path>        # saved file copies
runtime/
  active.json
  <snapshot-id>/
    files/
      <normalized-path>        # pre-activation backup
```

## Development

```bash
npm run compile      # build extension
npm run compile:test # build tests
npm test             # compile + run integration tests
```

## Limitations (MVP)

- **Single workspace folder** — only the first folder in a multi-root workspace is supported
- **Same branch required** — cannot activate a snapshot on a different branch than the one it was created on
- **Renames** — treated as delete + add
- **Active snapshot on close** — if VS Code closes with an active snapshot, you will be prompted to deactivate on reopen
- **Requires built-in Git extension** for staging groups
- **Deleted files** — snapshot records deletion; activation removes the file from the workspace
- **Untracked files** — supported (`??` status)
- **Unmerged conflicts (`U`)** — not explicitly handled yet
