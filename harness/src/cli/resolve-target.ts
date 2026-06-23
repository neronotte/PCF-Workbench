// Auto-detect CLI target type from a filesystem path. Used by both
// `pcfworkbench start` and `pcfworkbench loop` to support the no-flag UX
// described in issue #36.
//
// Rules:
//   1. If `<input>/ControlManifest.Input.xml` exists → single-control mode.
//   2. Else if `<input>` contains any subdirectory with its own
//      `ControlManifest.Input.xml` → workspace (gallery) mode.
//   3. Else → throw with a clear, actionable message listing what was found.
//
// Pure, no global state, no env mutation. The CLI is responsible for
// translating the result into env vars (`PCF_CONTROL_PATH` / `PCF_WORKSPACE_ROOT`)
// and printing the inferred path back to the user.

import fs from 'node:fs';
import path from 'node:path';

export interface ControlTarget {
  kind: 'control';
  /** Absolute path to the directory containing ControlManifest.Input.xml. */
  path: string;
}

export interface WorkspaceTarget {
  kind: 'workspace';
  /** Absolute path to the directory of controls (gallery mode). */
  path: string;
  /** Names of immediate subdirs that contain a manifest. Useful for logging. */
  controls: string[];
}

export type ResolveResult = ControlTarget | WorkspaceTarget;

export class ResolveTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResolveTargetError';
  }
}

const SKIP_DIRS = new Set(['node_modules', 'out', 'obj', 'bin', 'generated']);

/**
 * Resolve a CLI path argument to either a single-control or workspace target.
 * Throws ResolveTargetError with a human-readable explanation on failure.
 */
export function resolvePcfTarget(input: string): ResolveResult {
  const abs = path.resolve(input);

  if (!fs.existsSync(abs)) {
    throw new ResolveTargetError(`Path does not exist: ${abs}`);
  }
  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) {
    throw new ResolveTargetError(`Path is not a directory: ${abs}`);
  }

  // Rule 1 — direct manifest = control mode.
  if (fs.existsSync(path.join(abs, 'ControlManifest.Input.xml'))) {
    return { kind: 'control', path: abs };
  }

  // Rule 2 — recurse a few levels looking for sub-control manifests. PCF
  // projects scaffolded with `pac pcf init` have the manifest at
  // <project>/<ControlName>/ControlManifest.Input.xml, so a "workspace of
  // PCF projects" puts manifests two levels deep. We mirror the existing
  // gallery scanner's depth budget (5) but stop at the first level that has
  // any hits so we don't drown in noise.
  const controls = findControlsUpToDepth(abs, 3);

  if (controls.length > 0) {
    return { kind: 'workspace', path: abs, controls };
  }

  // Rule 3 — give up with a useful message.
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    // Already validated isDirectory above; ignore read failures here.
  }
  const sample = entries
    .filter((e) => !e.name.startsWith('.'))
    .slice(0, 10)
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  const contentsHint = sample.length
    ? `\n  Contents: ${sample.join(', ')}${entries.length > 10 ? ', ...' : ''}`
    : '\n  (directory is empty)';
  throw new ResolveTargetError(
    `No PCF control found at: ${abs}\n` +
      `  Expected either:\n` +
      `    - a ControlManifest.Input.xml in this directory (single-control mode), or\n` +
      `    - one or more subdirectories each containing ControlManifest.Input.xml (workspace mode).${contentsHint}`,
  );
}

/**
 * Recursively look for ControlManifest.Input.xml up to `maxDepth` levels
 * below `root` (root itself is depth 0 and not checked here — Rule 1 above
 * already handled it). Returns the immediate subdirectory names of `root`
 * that contain at least one manifest in their subtree.
 */
function findControlsUpToDepth(root: string, maxDepth: number): string[] {
  const hits = new Set<string>();

  function walk(dir: string, depth: number, topLevelName: string | null): void {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const childDir = path.join(dir, entry.name);
        const name = topLevelName ?? entry.name;
        // Cheap manifest check on this subdir before recursing further.
        if (fs.existsSync(path.join(childDir, 'ControlManifest.Input.xml'))) {
          hits.add(name);
          continue; // No need to descend into a known control dir.
        }
        walk(childDir, depth + 1, name);
      }
    }
  }
  walk(root, 1, null);
  return [...hits].sort();
}
