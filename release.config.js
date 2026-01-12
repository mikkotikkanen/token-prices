/**
 * Semantic Release Configuration
 *
 * Uses conventional commits to determine version bumps:
 * - fix: patch (1.0.x)
 * - feat: minor (1.x.0)
 * - BREAKING CHANGE: major (x.0.0)
 */
export default {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    [
      '@semantic-release/npm',
      {
        npmPublish: true,
        pkgRoot: '.',
      },
    ],
    '@semantic-release/github',
  ],
};
