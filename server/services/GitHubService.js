// GitHubService — wraps `gh` CLI for issues, PRs, and project board data

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Run a `gh` CLI command and return parsed JSON output.
 */
async function gh(...args) {
  const { stdout } = await execFileAsync('gh', args, {
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

/**
 * Fetch open issues for a repo.
 * Returns array of { number, title, labels, state, assignees, createdAt }.
 */
export async function getIssues(repo, { label, limit = 50 } = {}) {
  const args = [
    'issue', 'list',
    '--repo', repo,
    '--state', 'open',
    '--limit', String(limit),
    '--json', 'number,title,labels,state,assignees,createdAt',
  ];
  if (label) {
    args.push('--label', label);
  }
  const raw = await gh(...args);
  if (!raw) return [];
  return JSON.parse(raw);
}

/**
 * Fetch open PRs for a repo.
 * Returns array of { number, title, state, headRefName, author, reviewDecision, createdAt, url, isDraft }.
 */
export async function getPrs(repo, { limit = 30 } = {}) {
  const args = [
    'pr', 'list',
    '--repo', repo,
    '--state', 'open',
    '--limit', String(limit),
    '--json', 'number,title,state,headRefName,author,reviewDecision,createdAt,url,isDraft',
  ];
  const raw = await gh(...args);
  if (!raw) return [];
  return JSON.parse(raw);
}

/**
 * Fetch a single issue by number.
 */
export async function getIssue(repo, number) {
  const raw = await gh(
    'issue', 'view', String(number),
    '--repo', repo,
    '--json', 'number,title,body,labels,state,assignees,createdAt',
  );
  if (!raw) return null;
  return JSON.parse(raw);
}

/**
 * Fetch a single PR by number.
 */
export async function getPr(repo, number) {
  const raw = await gh(
    'pr', 'view', String(number),
    '--repo', repo,
    '--json', 'number,title,state,headRefName,author,reviewDecision,createdAt,url,isDraft,body,additions,deletions,changedFiles',
  );
  if (!raw) return null;
  return JSON.parse(raw);
}
