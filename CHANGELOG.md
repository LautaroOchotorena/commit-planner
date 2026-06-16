# Changelog

All notable changes to the **Commit Planner** extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-06-14

### Added

- File selection marks when creating a planned commit:
  - **Never in a planned commit** — files that have not appeared in any saved snapshot
  - **Changed since …** — files included in a past snapshot whose current content differs from the most recent snapshot that contained them
- Marked files are sorted to the top of the file picker for easier review
- Color-coded icons: green (never in a planned commit), orange (changed since a past planned commit), blue (in a past planned commit, not in Git status)
- Files from saved planned commits that no longer appear in `git status` are included in the selection list
- Persistent file picker during snapshot setup with **Open File** and **Compare with Last Snapshot** toolbar buttons; the picker stays open while you read files (`ignoreFocusOut`)
- Same review buttons on all snapshot setup steps: planned commit name, group organization choice, group name input, and add-another-group prompt

## [0.1.0] - 2026-06-13

Initial release.

### Added

- Create planned commits from Git working tree changes (`git status --porcelain`)
- Multi-select QuickPick to choose modified, added, deleted, and untracked files
- Physical file copies stored in internal snapshot storage
- **Commit Planner** panel in the Explorer with tree view of snapshots and files
- **Activate** — swap snapshot files into the workspace with runtime backup of replaced files
- **Deactivate** — restore the pre-activation working state from the runtime backup
- Status bar indicator when a snapshot is active (click to deactivate)
- Recovery prompt on startup if a snapshot was left active
- Commit-like **groups** within snapshots, with distinct colors in the panel
- Group management: add, rename, delete, move files between groups
- **Stage Group for Commit** — stages group files via Git extension and sets SCM commit message to the group name (only while that planned commit is active)
- **Stage Ungrouped** — stages ungrouped files with an empty SCM commit message
- **Stage for Commit** on active flat snapshots (no groups) — all snapshot files, empty commit message
- Compare current file with snapshot version (diff)
- Open snapshot file in read-only editor
- Workspace validation on activate — planned commit must belong to the open workspace folder
- Activation blocked on a different Git branch than the one where the snapshot was created
- README section **While a snapshot is active** — do not edit snapshot files while active
- Activation success message reminds not to modify snapshot files while active
- Settings: storage location, block activation with staged changes
- Workspace storage outside the repo by default (`context.storageUri`)
- Depends on built-in `vscode.git` extension for staging
- Integration tests for snapshot apply/backup/restore behavior

### Notes

- Does not run `git commit` or `git push` automatically
- Only user-selected files are saved and swapped
- MVP supports a single workspace folder
- Git renames are treated as delete + add

[0.1.1]: https://github.com/LautaroOchotorena/commit-planner/releases/tag/v0.1.1
[0.1.0]: https://github.com/LautaroOchotorena/commit-planner/releases/tag/v0.1.0
