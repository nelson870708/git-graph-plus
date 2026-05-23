import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// GitContentProvider serves `git show <ref>:<path>` content to VS Code's diff
// editor. It's normally exercised manually; here we mock vscode (only needs
// EventEmitter) and child_process (to script git's output) so the query
// parsing, validation, and exit-code handling are locked in.
vi.mock('vscode', () => ({
  EventEmitter: class { event = () => ({ dispose() {} }); fire() {} },
}));

import * as childProcess from 'child_process';
vi.mock('child_process', () => ({ spawn: vi.fn() }));

import { GitContentProvider } from '../git-content-provider';

interface Resp { stdout?: string; stderr?: string; code?: number; errorMessage?: string; }

function fakeStream() {
  return new EventEmitter();
}

const spawnMock = vi.mocked(childProcess.spawn);
let response: Resp;
let spawnArgs: string[][];

beforeEach(() => {
  spawnArgs = [];
  response = { code: 0 };
  spawnMock.mockImplementation((_bin: string, args: readonly string[]) => {
    spawnArgs.push([...args]);
    const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    proc.stdout = fakeStream();
    proc.stderr = fakeStream();
    queueMicrotask(() => {
      if (response.errorMessage) { proc.emit('error', new Error(response.errorMessage)); return; }
      if (response.stdout) proc.stdout.emit('data', Buffer.from(response.stdout));
      if (response.stderr) proc.stderr.emit('data', Buffer.from(response.stderr));
      proc.emit('close', response.code ?? 0);
    });
    return proc as unknown as ReturnType<typeof childProcess.spawn>;
  });
});

afterEach(() => vi.clearAllMocks());

function uri(query: string) {
  return { query } as never;
}

describe('GitContentProvider.provideTextDocumentContent', () => {
  const provider = new GitContentProvider();

  it('returns an error comment for an unparseable query (no git spawned)', async () => {
    const out = await provider.provideTextDocumentContent(uri('not-json'));
    expect(out).toBe('// Error: Invalid URI query');
    expect(spawnArgs).toHaveLength(0);
  });

  it('returns an error comment when ref/path/repoPath are missing', async () => {
    const out = await provider.provideTextDocumentContent(uri(JSON.stringify({ ref: 'HEAD' })));
    expect(out).toBe('// Error: Missing ref, path, or repoPath');
    expect(spawnArgs).toHaveLength(0);
  });

  it('resolves git show stdout on success', async () => {
    response = { stdout: 'file contents here\n', code: 0 };
    const out = await provider.provideTextDocumentContent(
      uri(JSON.stringify({ ref: 'HEAD', path: 'a.ts', repoPath: '/repo' })),
    );
    expect(out).toBe('file contents here\n');
    expect(spawnArgs[0]).toEqual(['show', 'HEAD:a.ts']);
  });

  it('returns a friendly comment when the file does not exist at the ref', async () => {
    response = { stderr: "fatal: path 'a.ts' does not exist in 'HEAD'", code: 128 };
    const out = await provider.provideTextDocumentContent(
      uri(JSON.stringify({ ref: 'HEAD', path: 'a.ts', repoPath: '/repo' })),
    );
    expect(out).toBe('// File does not exist at HEAD: a.ts');
  });

  it('reports an unexpected non-zero exit verbatim', async () => {
    response = { stderr: 'some other failure', code: 3 };
    const out = await provider.provideTextDocumentContent(
      uri(JSON.stringify({ ref: 'HEAD', path: 'a.ts', repoPath: '/repo' })),
    );
    expect(out).toContain('git show HEAD:a.ts failed (exit 3)');
    expect(out).toContain('some other failure');
  });

  it('reports a spawn error', async () => {
    response = { errorMessage: 'ENOENT' };
    const out = await provider.provideTextDocumentContent(
      uri(JSON.stringify({ ref: 'HEAD', path: 'a.ts', repoPath: '/repo' })),
    );
    expect(out).toBe('// git show HEAD:a.ts failed: ENOENT');
  });
});
