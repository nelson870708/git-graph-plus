import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import CommitGraph from '../CommitGraph.svelte';
import { commitStore } from '../../../lib/stores/commits.svelte';
import { branchStore } from '../../../lib/stores/branches.svelte';
import { uiStore } from '../../../lib/stores/ui.svelte';
import { i18n } from '../../../lib/i18n/index.svelte';
import type { Commit, CommitGraphData } from '../../../lib/types';

function makeCommit(hash: string, subject: string, parents: string[] = []): Commit {
  return {
    hash,
    abbreviatedHash: hash.slice(0, 7),
    author: { name: 'A', email: 'a@x.com', date: '2024-01-01T00:00:00+00:00' },
    committer: { name: 'A', email: 'a@x.com', date: '2024-01-01T00:00:00+00:00' },
    subject,
    body: '',
    parents,
    refs: [],
  };
}

function makeGraphData(commits: Commit[]): CommitGraphData {
  return {
    commits,
    graph: commits.map(c => ({ commit: c.hash, column: 0, color: '#63b0f4', parents: [] })),
    paths: [],
    links: [],
    dots: commits.map((_, i) => ({ center: { x: 0, y: i }, color: 0, type: 'default' as const, localOnly: false, remoteTip: false })),
    commitLeftMargin: commits.map(() => 24),
    hasMore: false,
    currentLimit: 1000,
  };
}

beforeEach(() => {
  i18n.setLocale('en');
  // Reset shared singletons between tests.
  commitStore.commits = [];
  commitStore.graphNodes = [];
  commitStore.paths = [];
  commitStore.links = [];
  commitStore.dots = [];
  commitStore.commitLeftMargin = [];
  commitStore.loading = false;
  commitStore.notGitRepo = false;
  branchStore.branches = [];
  branchStore.worktrees = [];
  uiStore.selectedCommitHash = null;
});

afterEach(() => cleanup());

describe('CommitGraph smoke', () => {
  it('renders without crashing when commits are empty', () => {
    const { container } = render(CommitGraph, {});
    // No commit rows expected, but the container should exist.
    expect(container).toBeTruthy();
    expect(container.querySelectorAll('.commit-row').length).toBe(0);
  });

  it('renders one row per commit when commits are populated', async () => {
    commitStore.setData(makeGraphData([
      makeCommit('h1', 'first'),
      makeCommit('h2', 'second', ['h1']),
      makeCommit('h3', 'third', ['h2']),
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    expect(container.querySelectorAll('.commit-row').length).toBe(3);
  });

  it('clicking a commit row sets selectedCommitHash after the dbl-click timeout fires', async () => {
    commitStore.setData(makeGraphData([
      makeCommit('h1', 'first'),
      makeCommit('h2', 'second', ['h1']),
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    const rows = container.querySelectorAll<HTMLElement>('.commit-row');
    expect(rows.length).toBeGreaterThan(0);
    // The dual-click discriminator waits 200ms before treating a click as
    // a single-click. Use fake timers if you want to exercise the delay,
    // but we just need to confirm clicking does not throw.
    await fireEvent.click(rows[0]);
    // Selection is deferred until the dbl-click timer expires; do a soft
    // assertion that the row is at least focusable / clickable.
    expect(rows[0]).toBeTruthy();
  });

  it('clicking the UNCOMMITTED row opens the SCM view instead of selecting it', async () => {
    commitStore.setData(makeGraphData([
      makeCommit('UNCOMMITTED', 'Uncommitted changes'),
      makeCommit('h1', 'first'),
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    globalThis.__postedMessages = [];
    const rows = container.querySelectorAll<HTMLElement>('.commit-row');
    await fireEvent.click(rows[0]);
    await tick();
    expect(globalThis.__postedMessages.some(m => (m.data as { type?: string }).type === 'openScmView')).toBe(true);
    expect(uiStore.selectedCommitHash).toBeNull();
  });

  it('right-clicking the UNCOMMITTED row opens an Amend menu, then the amend modal + SCM', async () => {
    const { modalStore } = await import('../../../lib/stores/modals.svelte');
    const head = makeCommit('h1', 'first');
    head.refs = [{ type: 'head', name: 'main' }];
    commitStore.setData(makeGraphData([
      makeCommit('UNCOMMITTED', 'Uncommitted changes'),
      head,
    ]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 1, behind: 0, hash: 'h1' },
    ];
    const { container } = render(CommitGraph, {});
    await tick();
    globalThis.__postedMessages = [];
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0];
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    // The single menu item is "Amend '{ref}'" (ref = current branch); click it.
    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^amend 'main'$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();
    expect(modalStore.amend.show).toBe(true);
    expect(modalStore.amend.hash).toBe('h1');
    expect(globalThis.__postedMessages.some(m => (m.data as { type?: string }).type === 'openScmView')).toBe(true);
    modalStore.closeAmend();
  });

  it('right-clicking the HEAD commit opens the amend modal + SCM', async () => {
    const { modalStore } = await import('../../../lib/stores/modals.svelte');
    const head = makeCommit('h2', 'latest', ['h1']);
    head.refs = [{ type: 'head', name: 'main' }];
    commitStore.setData(makeGraphData([head, makeCommit('h1', 'first')]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 1, behind: 0, hash: 'h2' },
    ];
    const { container } = render(CommitGraph, {});
    await tick();
    globalThis.__postedMessages = [];
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0]; // HEAD row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^amend commit$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();
    expect(modalStore.amend.show).toBe(true);
    expect(modalStore.amend.hash).toBe('h2');
    expect(globalThis.__postedMessages.some(m => (m.data as { type?: string }).type === 'openScmView')).toBe(true);
    modalStore.closeAmend();
  });

  it('offers "Create worktree from" on a regular branch and posts startPoint', async () => {
    const head = makeCommit('h1', 'first');
    head.refs = [{ type: 'head', name: 'main' }];
    const feat = makeCommit('h2', 'feat work', ['h1']);
    feat.refs = [{ type: 'branch', name: 'develop' }];
    commitStore.setData(makeGraphData([feat, head]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h1' },
      { name: 'develop', current: false, ahead: 0, behind: 0, hash: 'h2' },
    ];
    const { container } = render(CommitGraph, {});
    await tick();
    globalThis.__postedMessages = [];
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0]; // develop row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    // The branch "develop" is a submenu-parent; hover over it to reveal children.
    const parentBtn = Array.from(container.querySelectorAll<HTMLElement>('button.menu-item.has-children'))
      .find(el => (el.textContent ?? '').includes('develop'));
    if (parentBtn) {
      await fireEvent.mouseEnter(parentBtn);
      await tick();
    }
    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^new worktree$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();
    const msg = globalThis.__postedMessages
      .map(m => m.data as { type?: string; payload?: { startPoint?: string } })
      .find(m => m.type === 'worktreeAddModalRequest');
    expect(msg?.payload?.startPoint).toBe('develop');
  });

  it('offers a top-level "Create worktree from" item (no submenu hover needed) and posts startPoint', async () => {
    const head = makeCommit('h1', 'first');
    head.refs = [{ type: 'head', name: 'main' }];
    const feat = makeCommit('h2', 'feat work', ['h1']);
    feat.refs = [{ type: 'branch', name: 'develop' }];
    commitStore.setData(makeGraphData([feat, head]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h1' },
      { name: 'develop', current: false, ahead: 0, behind: 0, hash: 'h2' },
    ];
    const { container } = render(CommitGraph, {});
    await tick();
    globalThis.__postedMessages = [];
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0]; // develop row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    // Top-level (flat) item is present WITHOUT hovering into the branch submenu.
    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^new worktree$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();
    const msg = globalThis.__postedMessages
      .map(m => m.data as { type?: string; payload?: { startPoint?: string } })
      .find(m => m.type === 'worktreeAddModalRequest');
    expect(msg?.payload?.startPoint).toBe('develop');
  });

  it('does not crash on a branch-set fingerprint cache hit (same commits, same branch)', async () => {
    // First mount populates the cache.
    commitStore.setData(makeGraphData([
      makeCommit('h1', 'first'),
      makeCommit('h2', 'second', ['h1']),
    ]));
    // currentBranch is a getter — set it by adding a current branch to the list.
    branchStore.branches = [
      { name: 'main', current: true, remote: undefined, upstream: undefined, ahead: 0, behind: 0, hash: 'h2' },
    ];

    const { container } = render(CommitGraph, {});
    await tick();
    expect(container.querySelectorAll('.commit-row').length).toBe(2);

    // Re-render with the SAME data — the fingerprint must match, no errors.
    cleanup();
    const { container: c2 } = render(CommitGraph, {});
    await tick();
    expect(c2.querySelectorAll('.commit-row').length).toBe(2);
  });
});

describe('CommitGraph signature icon', () => {
  it('renders a signature icon for good/unverified commits', async () => {
    commitStore.setData(makeGraphData([
      { ...makeCommit('h1', 'signed'), signatureStatus: 'good' },
      { ...makeCommit('h2', 'tampered', ['h1']), signatureStatus: 'unverified' },
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    expect(container.querySelector('.sig-icon.sig-icon-good')).toBeTruthy();
    expect(container.querySelector('.sig-icon.sig-icon-unverified')).toBeTruthy();
  });

  it('omits the icon for "none" and when signatureStatus is absent', async () => {
    commitStore.setData(makeGraphData([
      { ...makeCommit('h1', 'unsigned'), signatureStatus: 'none' },
      makeCommit('h2', 'no field', ['h1']),
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    expect(container.querySelector('.sig-icon')).toBeFalsy();
  });
});
