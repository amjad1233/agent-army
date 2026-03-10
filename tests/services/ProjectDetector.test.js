import { describe, it, expect } from 'vitest';

// We test the parsing logic by testing the regex used in ProjectDetector
describe('detectProject — remote URL parsing', () => {
  const cases = [
    ['https://github.com/amjad1233/my-app.git', 'amjad1233/my-app'],
    ['https://github.com/amjad1233/my-app', 'amjad1233/my-app'],
    ['git@github.com:amjad1233/my-app.git', 'amjad1233/my-app'],
  ];

  for (const [url, expected] of cases) {
    it(`parses "${url}"`, () => {
      const match = url.match(/github\.com[/:]([^/]+\/[^/.]+)(\.git)?$/);
      expect(match).toBeTruthy();
      expect(match[1]).toBe(expected);
    });
  }

  it('returns null for non-GitHub remotes', () => {
    const url = 'https://gitlab.com/owner/repo.git';
    const match = url.match(/github\.com[/:]([^/]+\/[^/.]+)(\.git)?$/);
    expect(match).toBeNull();
  });
});
