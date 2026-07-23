# Deploy Root Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `tradepulse-production` the single default production root without removing explicit path overrides.

**Architecture:** `DEPLOY_ROOT` is resolved once by each CLI entry point. Default subpaths are derived from that root and the same root is persisted in the auto-deploy LaunchAgent environment.

**Tech Stack:** Node.js 22, zsh, macOS LaunchAgents, Node test runner.

## Global Constraints

- Production code comes only from the latest GitHub `origin/main` SHA.
- Development checkouts are never production runtime or shared-data paths.
- Cloudflare configuration remains untouched.
- SQLite is backed up automatically and restored only manually.

---

### Task 1: Root-derived deployment paths

**Files:**
- Modify: `scripts/deploy-from-github.sh`
- Modify: `scripts/deploy-state.js`
- Test: `test/deploy_from_github.test.js`
- Test: `test/deploy_state.test.js`

**Interfaces:**
- Consumes: optional `DEPLOY_ROOT` and existing fine-grained path overrides.
- Produces: `current`, `releases`, `shared`, and `state` beneath the production root.

- [x] Add tests that run with only `DEPLOY_ROOT` and assert every generated path is below it.
- [x] Run the focused tests and confirm they fail on old defaults.
- [x] Derive all defaults from `DEPLOY_ROOT`, preserving explicit overrides.
- [x] Run the focused tests and confirm they pass.

### Task 2: Installer and LaunchAgent propagation

**Files:**
- Modify: `lib/macos_launch_agents.js`
- Modify: `scripts/install-auto-deploy.js`
- Modify: `scripts/install-daily-services.js`
- Test: `test/macos_launch_agents.test.js`

**Interfaces:**
- Consumes: canonical absolute production root.
- Produces: code and deploy LaunchAgents rooted at `<DEPLOY_ROOT>/current`, with the deploy service receiving `DEPLOY_ROOT`.

- [x] Add failing tests for installer defaults and `DEPLOY_ROOT` in the deploy plist.
- [x] Resolve the root in installers and pass it to the renderer.
- [x] Run installer and renderer tests until green.
- [x] Run `npm test`, syntax checks, and `git diff --check`.
