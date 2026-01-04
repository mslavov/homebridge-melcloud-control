---
description: Bump version, update docs, and publish to npm
allowed-tools: Bash, Read, Edit, Write, Grep
argument-hint: [patch|minor|major]
---

# NPM Publish Workflow

Publish the homebridge-melcloud-passive-house plugin to npm.

## Pre-flight Checks

Current version: !`node -p "require('./package.json').version"`
Git status: !`git status --short`

## Instructions

Version bump type: $ARGUMENTS (default: patch)

### Steps

1. **Verify clean working directory**
   - Run `git status` and confirm no uncommitted changes
   - If dirty, ask user to commit or stash first

2. **Bump version in package.json**
   - Use `npm version $ARGUMENTS --no-git-tag-version` to bump version
   - This updates package.json without creating a git tag

3. **Update CHANGELOG.md**
   - Add new version section with today's date (format: DD.MM.YYYY)
   - Include summary of changes since last version
   - Follow existing changelog format

4. **Commit and tag**
   - `git add package.json package-lock.json CHANGELOG.md`
   - Verify with `git status` that all version-related files are staged
   - `git commit -m "chore: release vX.Y.Z"`
   - `git tag vX.Y.Z`

5. **Push to remote (triggers publish)**
   - `git push && git push --tags`
   - The tag push triggers GitHub Actions workflow `.github/workflows/publish.yml`
   - GitHub Actions publishes to npm using trusted publishing (OIDC)

6. **Verify**
   - Check GitHub Actions: https://github.com/mslavov/homebridge-melcloud-passive-house/actions
   - Confirm package is live: `npm view homebridge-melcloud-passive-house version`

### How Publishing Works

Publishing uses **npm trusted publishing** via GitHub Actions:

- No npm tokens required - uses OIDC authentication
- Triggered automatically when a `v*` tag is pushed
- Runs tests before publishing
- Adds provenance attestations for supply chain security
- Workflow file: `.github/workflows/publish.yml`

### First-Time Setup (One-Time)

Before this workflow can publish, configure trusted publishing on npmjs.com:

1. Go to: https://www.npmjs.com/package/homebridge-melcloud-passive-house/access
2. Click "Add Trusted Publisher"
3. Select "GitHub Actions"
4. Configure:
   - Repository owner: `mslavov`
   - Repository name: `homebridge-melcloud-passive-house`
   - Workflow filename: `publish.yml`
   - Environment: (leave empty)

### Error Handling

- If GitHub Actions fails: Check the workflow logs for errors
- If publish fails with 404:
  - Trusted publisher may not be configured (see setup above)
  - npm CLI version may be too old (requires 11.5.1+ for OIDC). The workflow includes `npm install -g npm@latest` to fix this.
- If tests fail: Fix tests before the publish can succeed
- If "Access token expired": This usually means npm version is too old for OIDC
