import { existsSync } from 'fs';
import { basename } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Auto-detect GitHub repo and project name from a local path.
 * Returns { name, repo } or throws a descriptive error.
 */
export async function detectProject(localPath) {
  // 1. Path exists
  if (!existsSync(localPath)) {
    const err = new Error(`Path does not exist: ${localPath}`);
    err.status = 400;
    throw err;
  }

  // 2. Is a git repo
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: localPath, timeout: 5000 });
  } catch {
    const err = new Error(`Not a git repository: ${localPath}`);
    err.status = 400;
    throw err;
  }

  // 3. Has a GitHub remote
  let remoteUrl;
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
      cwd: localPath,
      timeout: 5000,
    });
    remoteUrl = stdout.trim();
  } catch {
    const err = new Error('No git remote "origin" found');
    err.status = 400;
    throw err;
  }

  // 4. Parse owner/repo from remote URL
  // Handles: https://github.com/owner/repo.git  AND  git@github.com:owner/repo.git
  const httpsMatch = remoteUrl.match(/github\.com[/:]([^/]+\/[^/.]+)(\.git)?$/);
  if (!httpsMatch) {
    const err = new Error(`Remote URL does not look like a GitHub repo: ${remoteUrl}`);
    err.status = 400;
    throw err;
  }
  const repo = httpsMatch[1];

  // 5. Derive name from directory basename
  const name = basename(localPath);

  return { name, repo };
}
