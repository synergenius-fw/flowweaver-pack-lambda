#!/usr/bin/env tsx
/**
 * Release script.
 *
 * Usage:
 *   npm run release patch       # 0.2.0 → 0.2.1
 *   npm run release minor       # 0.2.0 → 0.3.0
 *   npm run release major       # 0.2.0 → 1.0.0
 *   npm run release 0.5.0       # explicit version
 *
 * What it does:
 *   1. Bumps version in package.json and flowweaver.manifest.json
 *   2. Builds the project
 *   3. Creates a release branch, commits, pushes
 *   4. Creates and merges a PR (squash)
 *   5. Tags the merge commit and creates a GitHub release
 *   6. Publishes to npm
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const manifestPath = path.join(rootDir, 'flowweaver.manifest.json');

function run(cmd: string, opts?: { cwd?: string; stdio?: 'inherit' | 'pipe' }): string {
  const result = execSync(cmd, {
    cwd: opts?.cwd ?? rootDir,
    stdio: opts?.stdio ?? 'pipe',
    encoding: 'utf-8',
  });
  return (result ?? '').trim();
}

function fail(msg: string): never {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
}

function info(msg: string): void {
  console.log(`\x1b[36m→ ${msg}\x1b[0m`);
}

function success(msg: string): void {
  console.log(`\x1b[32m✓ ${msg}\x1b[0m`);
}

function bumpVersion(current: string, bump: string): string {
  if (/^\d+\.\d+\.\d+/.test(bump)) return bump;

  const [major, minor, patch] = current.split('.').map(Number);
  switch (bump) {
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'major':
      return `${major + 1}.0.0`;
    default:
      fail(`Invalid bump type: "${bump}". Use patch, minor, major, or an explicit version.`);
  }
}

function generateReleaseNotes(lastTag: string): string {
  let commits: string;
  try {
    commits = run(`git log ${lastTag}..HEAD --oneline --no-merges`);
  } catch {
    commits = run('git log --oneline --no-merges -20');
  }

  if (!commits.trim()) return 'Maintenance release.';

  const lines = commits
    .split('\n')
    .map((line) => {
      const msg = line.replace(/^[a-f0-9]+ /, '');
      return `- ${msg}`;
    });

  return `### Changes\n\n${lines.join('\n')}`;
}

function preflight(): void {
  const branch = run('git rev-parse --abbrev-ref HEAD');
  if (branch !== 'main') {
    fail(`Must be on main branch (currently on "${branch}")`);
  }

  const dirty = run('git diff --name-only');
  if (dirty) {
    fail(`Working tree has uncommitted changes:\n${dirty}\nCommit or stash them first.`);
  }

  run('git fetch origin main');
  const behind = run('git rev-list HEAD..origin/main --count');
  if (behind !== '0') {
    fail(`Local main is ${behind} commit(s) behind origin. Run "git pull" first.`);
  }

  try {
    run('gh --version');
  } catch {
    fail('GitHub CLI (gh) is required but not found. Install it: https://cli.github.com');
  }
}

// ── Main ─────────────────────────────────────────────────────────────

const bump = process.argv[2];
if (!bump) {
  console.log('Usage: npm run release <patch|minor|major|x.y.z>');
  process.exit(0);
}

preflight();

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const currentVersion = pkg.version;
const newVersion = bumpVersion(currentVersion, bump);
const tag = `v${newVersion}`;
const releaseBranch = `release/${tag}`;

info(`Bumping ${currentVersion} → ${newVersion}`);

try {
  run(`git rev-parse ${tag}`);
  fail(`Tag ${tag} already exists`);
} catch {
  // Good
}

// 1. Bump version in package.json
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// 2. Bump version in flowweaver.manifest.json
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  manifest.version = newVersion;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
success(`Updated versions to ${newVersion}`);

// 3. Build
info('Building...');
run('npm run build', { stdio: 'inherit' });
success('Build complete');

// 4. Create release branch, commit, push
run(`git checkout -b ${releaseBranch}`);
run('git add package.json flowweaver.manifest.json');
run(`git commit -m "Release ${tag}"`);
run(`git push -u origin ${releaseBranch}`);
success(`Pushed ${releaseBranch}`);

// 5. Create and merge PR
const prUrl = run(
  `gh pr create --title "Release ${tag}" --body "Bump version to ${newVersion}" --base main --head ${releaseBranch}`
);
info(`PR created: ${prUrl}`);

// Enable auto-merge (waits for CI to pass before merging)
info('Enabling auto-merge (waiting for CI)...');
run(`gh pr merge ${releaseBranch} --squash --subject "Release ${tag}" --body "Bump version to ${newVersion}" --auto`);

// Poll until the PR is merged
info('Waiting for CI to pass and PR to merge...');
for (let i = 0; i < 60; i++) {
  const state = run(`gh pr view ${releaseBranch} --json state --jq .state`);
  if (state === 'MERGED') break;
  if (i === 59) fail('Timed out waiting for PR to merge (5 minutes). Check CI status.');
  execSync('sleep 5');
}

success('PR merged');

// 6. Pull the merge commit
run('git checkout main');
run('git pull origin main');

// 7. Create GitHub release
const lastTag = run('git describe --tags --abbrev=0 HEAD~1 2>/dev/null || echo ""');
const notes = generateReleaseNotes(lastTag || '');

const notesFile = path.join(rootDir, '.release-notes.tmp');
fs.writeFileSync(notesFile, notes);
try {
  run(`gh release create ${tag} --target main --title "${tag}" --notes-file ${notesFile}`);
} finally {
  fs.unlinkSync(notesFile);
}
success(`Release ${tag} published on GitHub (npm publish handled by CI)`);

// Cleanup
try {
  run(`git branch -d ${releaseBranch}`);
  run(`git push origin --delete ${releaseBranch}`);
} catch {
  // Non-critical
}
