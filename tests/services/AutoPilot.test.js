import { describe, it, expect } from 'vitest';

// Test the issue filtering logic in isolation
describe('AutoPilot — issue filtering', () => {
  const excluded = ['still thinking', 'wip', 'blocked'];

  function filterIssues(issues, activeIssueNumbers, skipKeys) {
    return issues.filter(issue => {
      const labels = issue.labels?.map(l => (typeof l === 'string' ? l : l.name).toLowerCase()) ?? [];
      if (labels.some(l => excluded.includes(l))) return false;
      if (activeIssueNumbers.has(issue.number)) return false;
      if (skipKeys.has(`1-${issue.number}`)) return false;
      return true;
    });
  }

  it('excludes issues with excluded labels', () => {
    const issues = [
      { number: 1, title: 'Do thing', labels: [{ name: 'still thinking' }] },
      { number: 2, title: 'Do other thing', labels: [] }
    ];
    const result = filterIssues(issues, new Set(), new Set());
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(2);
  });

  it('excludes issues already being worked on', () => {
    const issues = [
      { number: 1, title: 'Active', labels: [] },
      { number: 2, title: 'Available', labels: [] }
    ];
    const result = filterIssues(issues, new Set([1]), new Set());
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(2);
  });

  it('excludes issues in the skip list', () => {
    const issues = [
      { number: 1, title: 'Failed twice', labels: [] },
      { number: 2, title: 'Fresh', labels: [] }
    ];
    const result = filterIssues(issues, new Set(), new Set(['1-1']));
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(2);
  });

  it('picks oldest issue (last in array)', () => {
    const issues = [
      { number: 5, title: 'Newest', labels: [] },
      { number: 2, title: 'Oldest', labels: [] }
    ];
    const available = filterIssues(issues, new Set(), new Set());
    const pick = available[available.length - 1];
    expect(pick.number).toBe(2);
  });

  it('returns empty when all issues are filtered', () => {
    const issues = [
      { number: 1, title: 'Blocked', labels: [{ name: 'wip' }] }
    ];
    const result = filterIssues(issues, new Set(), new Set());
    expect(result).toHaveLength(0);
  });
});
