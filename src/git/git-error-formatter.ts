/** Fragments git emits when a remote operation fails for credential reasons.
 *  Used to decide whether to surface the credential-help UI. SSH-key failures
 *  (`Permission denied (publickey)`, `Host key verification failed`) are
 *  included because the UI still has useful SSH guidance for them. */
const AUTH_FAILURE_RE = /terminal prompts disabled|Authentication failed|could not read Username|could not read Password|Permission denied.*publickey|Host key verification failed|Could not read from remote/;

export function isAuthFailure(stderr: string): boolean {
  return AUTH_FAILURE_RE.test(stderr);
}

/** Classify a remote URL's transport so the UI can show the right hint
 *  (SSH key vs HTTPS credential helper). */
export function transportFromRemoteUrl(url: string): 'ssh' | 'https' | 'unknown' {
  if (url.startsWith('git@') || url.startsWith('ssh://')) return 'ssh';
  if (url.startsWith('https://') || url.startsWith('http://')) return 'https';
  return 'unknown';
}

export function formatGitError(stderr: string): string {
  const rawLines = stderr.trim().split('\n');
  if (rawLines.length === 0) return stderr.trim();

  // Remote server errors are most specific (e.g. GitHub rule violations)
  const remoteError = rawLines.find(l => /^remote:\s*(error|fatal):/i.test(l));
  if (remoteError) {
    return remoteError.replace(/^remote:\s*(error|fatal):\s*/i, '').trim();
  }

  // Find first error/fatal/warning line
  const firstErrorIdx = rawLines.findIndex(l => /^(error|fatal|warning):/i.test(l));
  if (firstErrorIdx === -1) {
    const fallback = rawLines.find(l => l.trim() && !/^hint:/i.test(l));
    return (fallback ?? rawLines[0]).trim();
  }

  const mainMessage = rawLines[firstErrorIdx].replace(/^(error|fatal|warning):\s*/i, '').trim();

  // Collect tab-indented file lines immediately following the error
  const files: string[] = [];
  for (let i = firstErrorIdx + 1; i < rawLines.length; i++) {
    if (/^\t|^    /.test(rawLines[i])) {
      files.push(rawLines[i].trim());
    } else {
      break;
    }
  }

  if (files.length === 0) return mainMessage;

  const fileList = files.length <= 3
    ? files.join(', ')
    : `${files.slice(0, 3).join(', ')} (+${files.length - 3} more)`;

  return `${mainMessage}\n${fileList}`;
}
