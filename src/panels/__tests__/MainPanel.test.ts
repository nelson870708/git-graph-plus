import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// MainPanel hosts the webview and routes ~80 message types to GitService. We
// can't run a real WebviewPanel, but with a vscode mock (panel + webview) and a
// controllable GitService we can capture the onDidReceiveMessage handler and
// assert the routing, refresh, sequence-guard, and error-handling behaviour.
const H = vi.hoisted(() => {
  const git: Record<string, ReturnType<typeof vi.fn>> = {
    log: vi.fn(async () => []),
    branches: vi.fn(async () => []),
    tags: vi.fn(async () => []),
    remotes: vi.fn(async () => []),
    stashList: vi.fn(async () => []),
    worktreeList: vi.fn(async () => []),
    merge: vi.fn(async () => {}),
    fastForwardRef: vi.fn(async () => {}),
    stashPop: vi.fn(async () => {}),
    showCommitDiff: vi.fn(async () => []),
    showCommitFiles: vi.fn(async () => []),
    getConflictFiles: vi.fn(async () => []),
    getOperationState: vi.fn(async () => ({ type: null })),
    getRemoteUrl: vi.fn(async () => ''),
    stashSave: vi.fn(async () => {}),
    checkout: vi.fn(async () => {}),
    pull: vi.fn(async () => {}),
    clean: vi.fn(async () => {}),
    setWarningHandler: vi.fn(),
    setAuthRetryHandler: vi.fn(),
    setExtraEnv: vi.fn(),
  };
  return {
    git,
    messageHandler: null as null | ((m: unknown) => unknown),
    panel: null as null | { webview: { postMessage: ReturnType<typeof vi.fn> } },
    repos: [] as Array<{ path: string; name: string; type: string }>,
  };
});

vi.mock('vscode', () => {
  const makePanel = () => {
    const webview = {
      html: '',
      cspSource: 'vscode-webview:',
      asWebviewUri: (u: unknown) => u,
      postMessage: vi.fn(),
      onDidReceiveMessage: (cb: (m: unknown) => unknown) => { H.messageHandler = cb; return { dispose() {} }; },
    };
    const panel = {
      webview,
      onDidDispose: () => ({ dispose() {} }),
      reveal: vi.fn(),
      dispose: vi.fn(),
      iconPath: undefined as unknown,
      viewColumn: 1,
    };
    H.panel = panel;
    return panel;
  };
  return {
    window: {
      createWebviewPanel: vi.fn(makePanel),
      activeTextEditor: undefined,
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(async () => undefined),
      showSaveDialog: vi.fn(async () => undefined),
    },
    workspace: {
      getConfiguration: () => ({ get: (_k: string, d?: unknown) => d }),
      getWorkspaceFolder: () => ({ uri: { fsPath: '/repo' } }),
      workspaceFolders: [{ uri: { fsPath: '/repo' } }],
      onDidChangeConfiguration: () => ({ dispose() {} }),
      fs: { writeFile: vi.fn(async () => {}) },
    },
    commands: { executeCommand: vi.fn() },
    l10n: { t: (k: string) => k },
    env: { language: 'en', clipboard: { writeText: vi.fn() } },
    Uri: {
      joinPath: () => ({}),
      file: (p: string) => ({ fsPath: p }),
      parse: () => ({ with: () => ({}) }),
    },
    ViewColumn: { One: 1 },
  };
});

vi.mock('../../git/git-service', async (orig) => {
  const actual = await orig<typeof import('../../git/git-service')>();
  return { ...actual, GitService: vi.fn(() => H.git) };
});
vi.mock('../../services/file-watcher', () => ({ FileWatcher: class { enabled = true; suppress() {} dispose() {} } }));
vi.mock('../../services/repo-discovery', () => ({ RepoDiscoveryService: { discoverRepos: vi.fn(async () => H.repos), clearCache: vi.fn() } }));
vi.mock('../../git/vscode-git-bridge', () => ({ triggerVSCodeGitAuth: vi.fn(async () => false) }));

import { MainPanel } from '../MainPanel';
import { GitError } from '../../git/git-service';

const extUri = { fsPath: '/ext' } as unknown as import('vscode').Uri;

function posted() {
  return (H.panel!.webview.postMessage.mock.calls.map(c => c[0])) as Array<{ type: string; payload?: Record<string, unknown> }>;
}
function postedOfType(type: string) {
  return posted().filter(m => m.type === type);
}
async function dispatch(msg: unknown) {
  await H.messageHandler!(msg);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset default git behaviour after clearAllMocks wiped implementations.
  for (const k of Object.keys(H.git)) H.git[k].mockReset();
  H.git.log.mockResolvedValue([]);
  H.git.branches.mockResolvedValue([]);
  H.git.tags.mockResolvedValue([]);
  H.git.remotes.mockResolvedValue([]);
  H.git.stashList.mockResolvedValue([]);
  H.git.worktreeList.mockResolvedValue([]);
  H.git.getOperationState.mockResolvedValue({ type: null });
  H.git.getConflictFiles.mockResolvedValue([]);
  H.git.getRemoteUrl.mockResolvedValue('');
  H.git.showCommitDiff.mockResolvedValue([]);
  H.repos = [{ path: '/repo', name: 'repo', type: 'root' }];
  (MainPanel as unknown as { currentPanel: unknown }).currentPanel = undefined;
  MainPanel.createOrShow(extUri, '/repo');
});

afterEach(() => {
  (MainPanel.currentPanel as unknown as { dispose?: () => void } | undefined)?.dispose?.();
  (MainPanel as unknown as { currentPanel: unknown }).currentPanel = undefined;
});

const commit = (hash: string) => ({
  hash, abbreviatedHash: hash.slice(0, 7), subject: 's', body: '', parents: [], refs: [],
  author: { name: '', email: '', date: '' }, committer: { name: '', email: '', date: '' },
});

describe('MainPanel construction', () => {
  it('creates a webview panel, sets its html, and posts the locale', () => {
    expect(H.panel).not.toBeNull();
    expect(H.panel!.webview).toBeDefined();
    expect(postedOfType('setLocale').length).toBeGreaterThan(0);
  });
});

describe('MainPanel message routing', () => {
  it('getLog fetches log + branches and posts logData', async () => {
    H.git.log.mockResolvedValue([commit('aaaaaaa1'), commit('bbbbbbb2')]);
    await dispatch({ type: 'getLog', payload: {} });
    expect(H.git.log).toHaveBeenCalled();
    expect(H.git.branches).toHaveBeenCalled();
    const data = postedOfType('logData').at(-1)!;
    expect((data.payload!.commits as unknown[]).length).toBe(2);
    expect(data.payload!.hasMore).toBe(false);
  });

  it('getLog reports hasMore and trims to the requested limit', async () => {
    // Requesting limit 1 fetches limit+1; returning 2 means "there is more".
    H.git.log.mockResolvedValue([commit('a1'), commit('b2')]);
    await dispatch({ type: 'getLog', payload: { limit: 1 } });
    const data = postedOfType('logData').at(-1)!;
    expect(data.payload!.hasMore).toBe(true);
    expect((data.payload!.commits as unknown[]).length).toBe(1);
  });

  it('getBranches posts branchData with all the sidebar collections', async () => {
    await dispatch({ type: 'getBranches' });
    const data = postedOfType('branchData').at(-1)!;
    expect(data.payload).toHaveProperty('branches');
    expect(data.payload).toHaveProperty('tags');
    expect(data.payload).toHaveProperty('worktrees');
  });

  it('getCommitDiff posts the file list for the commit', async () => {
    H.git.showCommitFiles.mockResolvedValue([{ path: 'a.ts', status: 'M' }]);
    await dispatch({ type: 'getCommitDiff', payload: { hash: 'h1' } });
    expect(H.git.showCommitFiles).toHaveBeenCalledWith('h1');
    const data = postedOfType('commitDiffData').at(-1)!;
    expect(data.payload!.hash).toBe('h1');
  });

  it('merge calls GitService.merge then refreshes the whole view', async () => {
    await dispatch({ type: 'merge', payload: { branch: 'feature' } });
    expect(H.git.merge).toHaveBeenCalledWith('feature', expect.anything());
    expect(postedOfType('operationComplete').length).toBeGreaterThan(0);
    expect(postedOfType('fullRefresh').length).toBeGreaterThan(0);
  });

  it('checkout with stash stashes before checking out', async () => {
    await dispatch({ type: 'checkout', payload: { ref: 'main', stash: true } });
    expect(H.git.stashSave).toHaveBeenCalled();
    expect(H.git.checkout).toHaveBeenCalledWith('main', expect.anything());
  });

  it('rejects switchRepo to a path outside the discovered repo list', async () => {
    await new Promise(r => setTimeout(r, 0)); // let sendRepoList populate cachedRepos
    await dispatch({ type: 'switchRepo', payload: { path: '/somewhere/else' } });
    expect(postedOfType('error').length).toBeGreaterThan(0);
  });
});

describe('MainPanel error handling', () => {
  it('posts notGitRepo when git reports "not a git repository"', async () => {
    H.git.log.mockRejectedValue(new GitError('fatal: not a git repository', 128, ['log']));
    await dispatch({ type: 'getLog', payload: {} });
    expect(postedOfType('notGitRepo').length).toBeGreaterThan(0);
  });

  it('surfaces a plain error when a mutation fails without a conflict', async () => {
    H.git.merge.mockRejectedValue(new GitError('fatal: some failure', 1, ['merge']));
    H.git.getConflictFiles.mockResolvedValue([]);
    await dispatch({ type: 'merge', payload: { branch: 'x' } });
    expect(postedOfType('error').length).toBeGreaterThan(0);
  });

  it('posts conflictData when a failing mutation leaves conflicted files', async () => {
    H.git.merge.mockRejectedValue(new GitError('CONFLICT', 1, ['merge']));
    H.git.getConflictFiles.mockResolvedValue(['a.ts']);
    H.git.getOperationState.mockResolvedValue({ type: 'merge' });
    await dispatch({ type: 'merge', payload: { branch: 'x' } });
    const data = postedOfType('conflictData').at(-1)!;
    expect(data.payload!.operation).toBe('merge');
    expect((data.payload!.files as unknown[]).length).toBe(1);
  });
});

// These cover the non-trivial orchestration the simpler route+post+refresh
// cases don't: stash/pop recovery, no-op detection, and the stale-response
// sequence guard. The rest of the ~80 message cases mirror `merge` and aren't
// worth duplicating.
describe('MainPanel orchestration logic', () => {
  it('fastForward (checkout path) stashes, checks out, ff-merges, then pops', async () => {
    await dispatch({ type: 'fastForward', payload: { local: 'main', remote: 'origin/main', stash: true } });
    expect(H.git.stashSave).toHaveBeenCalled();
    expect(H.git.checkout).toHaveBeenCalledWith('main', {});
    expect(H.git.merge).toHaveBeenCalledWith('origin/main', { ffOnly: true });
    expect(H.git.stashPop).toHaveBeenCalledWith(0);
    expect(postedOfType('operationComplete').length).toBeGreaterThan(0);
  });

  it('fastForward surfaces an error when the post-merge stash pop fails', async () => {
    H.git.stashPop.mockRejectedValueOnce(new Error('pop conflict'));
    await dispatch({ type: 'fastForward', payload: { local: 'main', remote: 'origin/main', stash: true } });
    const err = postedOfType('error').at(-1)!;
    expect(err.payload!.message).toBe('stashPopAfterFastForwardFailed');
  });

  it('pull with stash pops afterwards and surfaces a failed pop', async () => {
    H.git.pull = vi.fn(async () => '');
    H.git.stashPop.mockRejectedValueOnce(new Error('pop conflict'));
    await dispatch({ type: 'pull', payload: { stash: true } });
    expect(H.git.stashSave).toHaveBeenCalled();
    expect(H.git.pull).toHaveBeenCalled();
    expect(postedOfType('error').at(-1)!.payload!.message).toBe('stashPopAfterPullFailed');
  });

  it('stashSave reports "no changes" when the stash count does not grow', async () => {
    H.git.stashList.mockResolvedValueOnce([]).mockResolvedValueOnce([]); // before == after
    await dispatch({ type: 'stashSave', payload: {} });
    expect(postedOfType('error').at(-1)!.payload!.message).toBe('noChangesToStash');
  });

  it('stashSave confirms success when a new stash entry appears', async () => {
    H.git.stashList
      .mockResolvedValueOnce([])                    // before
      .mockResolvedValueOnce([{ index: 0 }] as never); // after
    await dispatch({ type: 'stashSave', payload: { message: 'wip' } });
    expect(H.git.stashSave).toHaveBeenCalled();
    expect(postedOfType('operationComplete').some(m => m.payload!.operation === 'stashSave')).toBe(true);
  });

  it('drops a stale file-diff response so a slower earlier request cannot clobber a newer one', async () => {
    let resolveFirst!: (v: unknown) => void;
    H.git.showCommitDiff
      .mockImplementationOnce(() => new Promise(r => { resolveFirst = r as (v: unknown) => void; }))
      .mockResolvedValueOnce([{ file: 'b.ts', hunks: [] }] as never);

    const p1 = dispatch({ type: 'getFileDiff', payload: { hash: 'h', file: 'a.ts' } });
    const p2 = dispatch({ type: 'getFileDiff', payload: { hash: 'h', file: 'b.ts' } });
    await p2; // newest request resolves and is delivered
    resolveFirst([{ file: 'a.ts', hunks: [] }]); // older request resolves late
    await p1;

    const diffs = postedOfType('fileDiffData');
    expect(diffs).toHaveLength(1);
    expect(diffs[0].payload!.file).toBe('b.ts');
  });
});
