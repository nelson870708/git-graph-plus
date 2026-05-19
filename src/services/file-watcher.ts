import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Resolves the real gitdir for `repoPath`. For a regular repo this is just
 * `repoPath/.git`. For a worktree-linked checkout the `.git` entry is a file
 * containing `gitdir: <abs-or-rel-path>` pointing at `<main-gitdir>/worktrees/<name>`,
 * which is where per-worktree refs (HEAD, index, MERGE_HEAD, ...) actually live.
 *
 * Returns the per-worktree gitdir plus the commondir (where shared refs live).
 * Falls back to `<repoPath>/.git` for both on any error so behavior matches
 * pre-worktree code paths.
 */
function resolveGitDirs(repoPath: string): { gitDir: string; commonDir: string } {
  const dotGit = path.join(repoPath, '.git');
  let gitDir = dotGit;
  try {
    const stat = fs.statSync(dotGit);
    if (stat.isFile()) {
      const content = fs.readFileSync(dotGit, 'utf-8').trim();
      const m = content.match(/^gitdir:\s*(.+)$/);
      if (m) {
        const target = m[1].trim();
        gitDir = path.isAbsolute(target) ? target : path.resolve(repoPath, target);
      }
    }
  } catch {
    return { gitDir: dotGit, commonDir: dotGit };
  }
  // For a linked worktree, gitDir is <main>/worktrees/<name> and a `commondir`
  // file holds the path to the main gitdir (where refs/packed-refs/config live).
  let commonDir = gitDir;
  try {
    const commonFile = path.join(gitDir, 'commondir');
    if (fs.existsSync(commonFile)) {
      const target = fs.readFileSync(commonFile, 'utf-8').trim();
      commonDir = path.isAbsolute(target) ? target : path.resolve(gitDir, target);
    }
  } catch {
    // ignore — commonDir already defaulted to gitDir
  }
  return { gitDir, commonDir };
}

export class FileWatcher implements vscode.Disposable {
  private watchers: vscode.FileSystemWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 500;
  private refreshing = false;
  private disposed = false;
  public enabled = true;
  private gitDir: string;
  private commonDir: string;

  constructor(
    private repoPath: string,
    private onChange: (what: string) => void
  ) {
    const resolved = resolveGitDirs(repoPath);
    this.gitDir = resolved.gitDir;
    this.commonDir = resolved.commonDir;

    // Per-worktree paths (gitDir):
    //   HEAD, index, MERGE_HEAD, REBASE_HEAD live in the per-worktree gitdir
    //   for linked worktrees, and in `.git` for regular repos (gitDir==commonDir).
    this.addWatcher(new vscode.RelativePattern(this.gitDir, 'HEAD'));
    this.addWatcher(new vscode.RelativePattern(this.gitDir, 'index'));
    this.addWatcher(new vscode.RelativePattern(this.gitDir, 'MERGE_HEAD'));
    this.addWatcher(new vscode.RelativePattern(this.gitDir, 'REBASE_HEAD'));

    // Shared paths (commonDir):
    //   refs/, packed-refs, config, worktrees/ are shared across all worktrees
    //   so we watch them at the main gitdir.
    this.addWatcher(new vscode.RelativePattern(this.commonDir, 'refs/**'));
    this.addWatcher(new vscode.RelativePattern(this.commonDir, 'refs/stash'));
    this.addWatcher(new vscode.RelativePattern(this.commonDir, 'packed-refs'));
    this.addWatcher(new vscode.RelativePattern(this.commonDir, 'config'));
    this.addWatcher(new vscode.RelativePattern(this.commonDir, 'worktrees/**'));

    // Watch working tree for file changes (exclude heavy dirs via specific patterns)
    // Using {src,lib,app,...}/** would be too restrictive, so we watch ** but filter
    this.addWatcher(new vscode.RelativePattern(repoPath, '**'), true);
  }

  // Directories to ignore for working tree changes (Set for O(1) lookup)
  private static readonly IGNORE_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', 'out', '.next',
    '.nuxt', '__pycache__', '.venv', 'vendor', 'target',
    '.gradle', '.idea', '.vs', 'coverage', '.nyc_output',
  ]);

  private addWatcher(pattern: vscode.RelativePattern, workingTree = false): void {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const handler = (uri: vscode.Uri) => {
      if (workingTree) {
        // Skip .git and common heavy directories
        const normalizedPath = uri.fsPath.split(path.sep);
        if (normalizedPath.some(seg => FileWatcher.IGNORE_DIRS.has(seg))) {
          return;
        }
      }
      this.scheduleRefresh(workingTree ? 'status' : this.classifyChange(uri));
    };

    watcher.onDidChange(handler);
    watcher.onDidCreate(handler);
    watcher.onDidDelete(handler);
    this.watchers.push(watcher);
  }

  private classifyChange(uri: vscode.Uri): string {
    // Probe against both gitDir (per-worktree) and commonDir (shared) so the
    // classification works regardless of whether the change was to HEAD/index
    // (gitDir) or refs/config (commonDir).
    const fromGitDir = path.relative(this.gitDir, uri.fsPath);
    const fromCommonDir = path.relative(this.commonDir, uri.fsPath);
    // Pick the relative path that does NOT start with `..` — that's the dir
    // the file actually belongs to.
    const relativePath = !fromGitDir.startsWith('..') ? fromGitDir : fromCommonDir;

    if (relativePath === 'HEAD' || relativePath.startsWith('refs') || relativePath === 'packed-refs' || relativePath.startsWith('worktrees')) {
      return 'refs';
    }
    if (relativePath === 'index') {
      return 'status';
    }
    if (relativePath === 'MERGE_HEAD' || relativePath === 'REBASE_HEAD') {
      return 'operation';
    }
    if (relativePath === 'config') {
      return 'refs';
    }
    return 'unknown';
  }

  private pendingChanges = new Set<string>();
  private pendingWhileRefreshing = false;

  private scheduleRefresh(what: string): void {
    // Guard against post-dispose calls or disabled state
    if (this.disposed || !this.enabled) {
      return;
    }

    // If currently in the refresh cooldown, flag for re-trigger instead of dropping
    if (this.refreshing) {
      this.pendingWhileRefreshing = true;
      this.pendingChanges.add(what);
      return;
    }

    this.pendingChanges.add(what);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.refreshing = true;
      // Pick the most significant change type
      const changeType = this.pendingChanges.has('refs') ? 'refs'
        : this.pendingChanges.has('operation') ? 'operation'
        : this.pendingChanges.has('status') ? 'status'
        : 'unknown';
      this.pendingChanges.clear();

      try {
        this.onChange(changeType);
      } finally {
        // Prevent re-triggering for 1 second after refresh
        this.cooldownTimer = setTimeout(() => {
          this.cooldownTimer = null;
          this.refreshing = false;
          if (this.disposed) return;
          // Re-trigger if changes came in during refresh cooldown
          if (this.pendingWhileRefreshing) {
            this.pendingWhileRefreshing = false;
            if (this.pendingChanges.size > 0) {
              this.scheduleRefresh('unknown');
            }
          }
        }, 1000);
      }
    }, this.DEBOUNCE_MS);
  }

  /** Absorb watcher events for `durationMs` ms. Call this immediately after the
   *  extension performs its own git operation + explicit refresh, so the
   *  filesystem changes caused by that operation don't trigger a redundant
   *  second refresh. Any events arriving during the window are coalesced into
   *  a single re-trigger after it expires (same path as pendingWhileRefreshing). */
  public suppress(durationMs = 1000): void {
    if (this.disposed) { return; }
    this.refreshing = true;
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
    }
    this.cooldownTimer = setTimeout(() => {
      this.cooldownTimer = null;
      this.refreshing = false;
      if (this.disposed) { return; }
      if (this.pendingWhileRefreshing) {
        this.pendingWhileRefreshing = false;
        if (this.pendingChanges.size > 0) {
          this.scheduleRefresh('unknown');
        }
      }
    }, durationMs);
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
    }
    this.watchers.forEach(w => w.dispose());
  }
}
