import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { GitService } from '../git-service';

// predictConflicts / predictRebaseConflicts drive `git merge-tree` through a
// raw spawn (mergeTreeCheck). The happy paths run against real git in the
// integration suite; here we mock spawn to exercise the fallbacks that real
// git on the CI box won't reproduce: old git (<2.40) rejecting --merge-base,
// transient errors, and empty replay ranges.
import * as childProcess from 'child_process';
vi.mock('child_process', () => ({ spawn: vi.fn() }));

interface SpawnResponse { stdout?: string; stderr?: string; code: number; }

function fakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

const spawnMock = vi.mocked(childProcess.spawn);
// Per-spawn scripted responses, consumed in call order.
let responses: SpawnResponse[] = [];
let spawnArgs: string[][] = [];

beforeEach(() => {
  responses = [];
  spawnArgs = [];
  spawnMock.mockImplementation((_bin: string, args: readonly string[]) => {
    spawnArgs.push([...args]);
    const proc = fakeProc();
    const resp = responses.shift() ?? { code: 0 };
    // Emit asynchronously, the way a real child would, after the caller has
    // attached its data/close listeners.
    queueMicrotask(() => {
      if (resp.stdout) proc.stdout.emit('data', Buffer.from(resp.stdout));
      if (resp.stderr) proc.stderr.emit('data', Buffer.from(resp.stderr));
      proc.emit('close', resp.code);
    });
    return proc as unknown as ReturnType<typeof childProcess.spawn>;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('predictConflicts fallbacks', () => {
  it('falls back to the no-merge-base form when git rejects --merge-base (old git)', async () => {
    const service = new GitService('/tmp/repo');
    responses = [
      // First call carries --merge-base and is rejected by old git.
      { stderr: 'error: unknown option `merge-base=...`', code: 129 },
      // Fallback call (no --merge-base) succeeds with no conflict.
      { code: 0 },
    ];
    const result = await service.predictConflicts('ours', 'theirs', 'base');
    expect(result).toEqual({ hasConflict: false, files: [] });
    // Two spawns: the rejected --merge-base attempt, then the fallback.
    expect(spawnArgs).toHaveLength(2);
    expect(spawnArgs[0].join(' ')).toContain('--merge-base=base');
    expect(spawnArgs[1].join(' ')).not.toContain('--merge-base');
  });

  it('reports conflicting files parsed from CONFLICT lines', async () => {
    const service = new GitService('/tmp/repo');
    responses = [
      { stdout: 'CONFLICT (content): Merge conflict in src/a.ts\nCONFLICT (content): Merge conflict in src/b.ts\n', code: 1 },
    ];
    const result = await service.predictConflicts('ours', 'theirs', 'base');
    expect(result.hasConflict).toBe(true);
    expect(result.files).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('returns no-conflict when both the primary and fallback checks error out', async () => {
    const service = new GitService('/tmp/repo');
    responses = [
      // Primary (with --merge-base): a real error, not an unknown-option.
      { stderr: 'fatal: not a valid object name', code: 128 },
      // Fallback (no --merge-base): also errors.
      { stderr: 'fatal: not a valid object name', code: 128 },
    ];
    const result = await service.predictConflicts('ours', 'theirs', 'base');
    expect(result).toEqual({ hasConflict: false, files: [] });
    expect(spawnArgs).toHaveLength(2);
  });
});

describe('predictRebaseConflicts fallbacks', () => {
  it('returns no-conflict for an empty replay range (branch fully merged)', async () => {
    const service = new GitService('/tmp/repo');
    // merge-base resolves, the rev-list of commits to replay is empty.
    (service as never as { exec: (a: string[]) => Promise<string> }).exec = vi.fn(async (args: string[]) => {
      if (args[0] === 'merge-base') return 'basehash\n';
      if (args[0] === 'log') return '\n';
      return '';
    });
    const result = await service.predictRebaseConflicts('branch', 'onto');
    expect(result).toEqual({ hasConflict: false, files: [] });
    // No merge-tree spawn needed when there's nothing to replay.
    expect(spawnArgs).toHaveLength(0);
  });

  it('falls back to a single merge-tree check when no merge base exists', async () => {
    const service = new GitService('/tmp/repo');
    (service as never as { exec: (a: string[]) => Promise<string> }).exec = vi.fn(async (args: string[]) => {
      if (args[0] === 'merge-base') throw new Error('no merge base');
      return '';
    });
    responses = [{ code: 0 }]; // the single fallback merge-tree: clean
    const result = await service.predictRebaseConflicts('branch', 'onto');
    expect(result).toEqual({ hasConflict: false, files: [] });
    expect(spawnArgs).toHaveLength(1);
  });
});
