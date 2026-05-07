import { describe, it, expect } from 'vitest';
import { formatGitError } from '../git-error-formatter';

describe('formatGitError', () => {
  describe('prefix stripping', () => {
    it('strips fatal: prefix', () => {
      expect(formatGitError("fatal: A branch named 'main' already exists."))
        .toBe("A branch named 'main' already exists.");
    });

    it('strips error: prefix', () => {
      expect(formatGitError("error: failed to push some refs to 'origin'"))
        .toBe("failed to push some refs to 'origin'");
    });

    it('strips warning: prefix', () => {
      expect(formatGitError('warning: LF will be replaced by CRLF in file.ts.'))
        .toBe('LF will be replaced by CRLF in file.ts.');
    });
  });

  describe('hint filtering', () => {
    it('drops hint lines, keeps error line', () => {
      const stderr = [
        "error: failed to push some refs to 'origin'",
        "hint: Updates were rejected because the remote contains work that you do not",
        "hint: have locally. Integrate the remote changes before pushing again.",
      ].join('\n');
      expect(formatGitError(stderr)).toBe("failed to push some refs to 'origin'");
    });
  });

  describe('file list after error', () => {
    it('appends single file on next line', () => {
      const stderr = [
        'error: Your local changes to the following files would be overwritten by checkout:',
        '\tsrc/extension.ts',
        'Please commit your changes or stash them before you switch branches.',
        'Aborting',
      ].join('\n');
      expect(formatGitError(stderr)).toBe(
        'Your local changes to the following files would be overwritten by checkout:\nsrc/extension.ts'
      );
    });

    it('joins multiple files on one line', () => {
      const stderr = [
        'error: Your local changes to the following files would be overwritten by merge:',
        '\tsrc/a.ts',
        '\tsrc/b.ts',
        '\tsrc/c.ts',
        'Please commit your changes or stash them.',
      ].join('\n');
      expect(formatGitError(stderr)).toBe(
        'Your local changes to the following files would be overwritten by merge:\nsrc/a.ts, src/b.ts, src/c.ts'
      );
    });

    it('truncates beyond 3 files with count', () => {
      const stderr = [
        'error: Your local changes to the following files would be overwritten by checkout:',
        '\tsrc/a.ts',
        '\tsrc/b.ts',
        '\tsrc/c.ts',
        '\tsrc/d.ts',
        '\tsrc/e.ts',
        'Aborting',
      ].join('\n');
      expect(formatGitError(stderr)).toBe(
        'Your local changes to the following files would be overwritten by checkout:\nsrc/a.ts, src/b.ts, src/c.ts (+2 more)'
      );
    });
  });

  describe('remote errors', () => {
    it('prefers remote error over generic error line', () => {
      const stderr = [
        'remote: error: GH013: Repository rule violations found for refs/heads/main.',
        'remote: ',
        "error: failed to push some refs to 'origin'",
      ].join('\n');
      expect(formatGitError(stderr))
        .toBe('GH013: Repository rule violations found for refs/heads/main.');
    });

    it('strips remote: fatal: prefix', () => {
      const stderr = [
        'remote: fatal: pack exceeds maximum allowed size',
        "error: failed to push some refs to 'origin'",
      ].join('\n');
      expect(formatGitError(stderr)).toBe('pack exceeds maximum allowed size');
    });
  });

  describe('no recognised prefix', () => {
    it('returns first non-empty line as-is when no prefix matches', () => {
      expect(formatGitError('Could not apply abc1234... some commit message'))
        .toBe('Could not apply abc1234... some commit message');
    });
  });
});
