// GitHubService — Phase 2 stub
// Will wrap Octokit / gh CLI for project board, issues, PRs

export function getIssues(repo) {
  // TODO: implement with gh CLI or Octokit
  return [];
}

export function getPrs(repo) {
  // TODO: implement with gh CLI or Octokit
  return [];
}

export function getProjectBoard(projectId) {
  // TODO: implement GraphQL query for project board
  return { columns: [], items: [] };
}
