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
   - `git add package.json CHANGELOG.md`
   - `git commit -m "chore: release vX.Y.Z"`
   - `git tag vX.Y.Z`

5. **Push to remote**
   - `git push && git push --tags`

6. **Publish to npm**
   - Check if logged in: `npm whoami`
   - If not logged in, run: `npm login --auth-type web`
     - This opens browser for authentication
     - Wait for user to complete auth
   - Publish: `npm publish --access public`

7. **Verify**
   - Confirm package is live: `npm view homebridge-melcloud-passive-house version`

### NPM 2FA Notes

- Use `--auth-type web` for login to trigger browser-based authentication
- If publish fails with 404, user needs to login first
- The browser will open automatically for OTP/2FA

### Error Handling

- If `npm publish` fails with 404: Run `npm login --auth-type web` and retry
- If `npm publish` fails with 403: Check npm permissions
- If `npm publish` fails with E426: 2FA required, use web login
