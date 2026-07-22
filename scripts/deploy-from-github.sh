#!/bin/zsh
set -euo pipefail
umask 077

REMOTE_URL="${DEPLOY_REMOTE_URL:-https://github.com/mewmind-chen/russia-crm-local.git}"
BRANCH="${DEPLOY_BRANCH:-main}"
DEPLOY_BASE="${DEPLOY_BASE:-$HOME/Desktop/projects/russia-crm-deploy}"
GIT_DIR="${DEPLOY_GIT_DIR:-$DEPLOY_BASE/repo.git}"
STATE_DIR="${DEPLOY_STATE_DIR:-$DEPLOY_BASE/state}"
RELEASES_DIR="${DEPLOY_RELEASES_DIR:-$HOME/Desktop/projects/russia-crm-releases}"
CURRENT_LINK="${DEPLOY_CURRENT_LINK:-$HOME/Desktop/projects/russia-crm-current}"
SHARED_ROOT="${DEPLOY_SHARED_ROOT:-$HOME/Desktop/projects/russia-crm-local}"
LOCAL_HEALTH_URL="${DEPLOY_LOCAL_HEALTH_URL:-http://127.0.0.1:3000/healthz}"
PUBLIC_HEALTH_URL="${DEPLOY_PUBLIC_HEALTH_URL:-https://crm.newmindchen.com/healthz}"
NODE_BIN="${DEPLOY_NODE_BIN:-$(command -v node)}"
VALIDATION_BIN="${DEPLOY_VALIDATION_BIN:-}"
BACKUP_BIN="${DEPLOY_BACKUP_BIN:-}"
RESTART_BIN="${DEPLOY_RESTART_BIN:-}"
HEALTHCHECK_BIN="${DEPLOY_HEALTHCHECK_BIN:-}"
SCRIPT_DIR="${0:A:h}"
STATE_HELPER="$SCRIPT_DIR/deploy-state.js"
export DEPLOY_STATE_FILE="$STATE_DIR/state.json"

stage=preflight
lock_dir=""
lock_acquired=0
candidate=""
target_sha=""
switched=0

force=0
if (( $# == 1 )) && [[ "$1" == --force ]]; then
  force=1
elif (( $# != 0 )); then
  print -u2 -- "usage: $0 [--force]"
  exit 2
fi

safe_remove_candidate() {
  local candidate_parent_real
  local releases_real
  [[ -n "$candidate" && -e "$candidate" ]] || return 0
  candidate_parent_real="$(cd "${candidate:h}" 2>/dev/null && pwd -P)" || return 1
  releases_real="$(cd "$RELEASES_DIR" 2>/dev/null && pwd -P)" || return 1
  if [[ "$candidate" != "$RELEASES_DIR"/* || "$candidate_parent_real" != "$releases_real" ]]; then
    print -u2 -- "refusing to remove unsafe candidate path: $candidate"
    return 1
  fi
  rm -rf -- "$candidate"
}

atomic_switch() {
  local target="$1"
  local suffix="$2"
  local current_parent="${CURRENT_LINK:h}"
  local temporary_link="$current_parent/.${CURRENT_LINK:t}.$suffix.$$"
  [[ "$target" == /* && -d "$target" ]] || {
    print -u2 -- "refusing to switch to invalid release target: $target"
    return 1
  }
  [[ ! -e "$CURRENT_LINK" || -L "$CURRENT_LINK" ]] || {
    print -u2 -- "current path exists and is not a symlink: $CURRENT_LINK"
    return 1
  }
  [[ ! -e "$temporary_link" && ! -L "$temporary_link" ]] || {
    print -u2 -- "temporary current link already exists: $temporary_link"
    return 1
  }
  ln -s "$target" "$temporary_link" || return $?
  if ! mv -h "$temporary_link" "$CURRENT_LINK"; then
    [[ "${temporary_link:h}" == "$current_parent" ]] && rm -f -- "$temporary_link"
    return 1
  fi
}

run_rollback_healthcheck() {
  local rollback_sha="$1"
  if [[ -n "$HEALTHCHECK_BIN" ]]; then
    "$HEALTHCHECK_BIN" "$rollback_sha" rollback
    return
  fi

  local response
  response="$(curl -fsS "$LOCAL_HEALTH_URL")" || return $?
  RESPONSE="$response" EXPECTED_SHA="$rollback_sha" "$NODE_BIN" -e '
    const body = JSON.parse(process.env.RESPONSE);
    if (body.ok !== true || body.releaseSha !== process.env.EXPECTED_SHA) process.exit(1);
  '
}

TRAPEXIT() {
  local exit_code=$?
  local failed_stage="$stage"
  local rollback_sha=""
  set +e
  if (( exit_code != 0 )); then
    print -u2 -- "deployment failed at stage $stage"
    safe_remove_candidate
    if (( switched == 1 )) && [[ -n "$previous_release" ]]; then
      if atomic_switch "$previous_release" rollback; then
        switched=0
        run_restarts || print -u2 -- "rollback service restart failed"
        if [[ -f "$previous_release/.release-sha" ]]; then
          rollback_sha="$(< "$previous_release/.release-sha")"
        fi
        run_rollback_healthcheck "$rollback_sha" || print -u2 -- "rollback health check failed"
      else
        print -u2 -- "failed to restore previous release: $previous_release"
      fi
    fi
    if (( ${#target_sha} == 40 )) && [[ "$target_sha" != *[^0-9a-f]* ]]; then
      "$NODE_BIN" "$STATE_HELPER" failure "$target_sha" "$failed_stage"
    fi
  fi
  if (( lock_acquired == 1 )) && [[ -d "$lock_dir" ]]; then
    rmdir "$lock_dir"
  fi
  return $exit_code
}

require_absolute_path() {
  if [[ "$2" != /* ]]; then
    print -u2 -- "$1 must be an absolute path"
    return 1
  fi
}

run_restarts() {
  local label
  local -a labels=(
    com.russia-crm.server
    com.russia-crm.recon-worker
    com.russia-crm.contact-worker-1
    com.russia-crm.contact-worker-2
  )
  for label in "${labels[@]}"; do
    if [[ -n "$RESTART_BIN" ]]; then
      "$RESTART_BIN" "$label" || return $?
    else
      launchctl kickstart -k "gui/$UID/$label" || return $?
    fi
  done
}

run_validation() {
  if [[ -n "$VALIDATION_BIN" ]]; then
    "$VALIDATION_BIN" "$candidate" "$target_sha"
    return
  fi

  (
    cd "$candidate" &&
    npm ci &&
    npm test &&
    "$NODE_BIN" --check server.js &&
    zsh -n scripts/deploy-from-github.sh &&
    python3 -m compileall -q scripts automation/hermes-skills/russia-recon/scripts
  )
}

run_healthcheck() {
  if [[ -n "$HEALTHCHECK_BIN" ]]; then
    "$HEALTHCHECK_BIN" "$target_sha" deploy
    return
  fi

  local response
  local attempts=0
  while (( attempts < 30 )); do
    response="$(curl -fsS "$LOCAL_HEALTH_URL" 2>/dev/null || true)"
    if RESPONSE="$response" EXPECTED_SHA="$target_sha" "$NODE_BIN" -e '
      const body = JSON.parse(process.env.RESPONSE);
      if (body.ok !== true || body.releaseSha !== process.env.EXPECTED_SHA) process.exit(1);
    ' 2>/dev/null; then
      break
    fi
    attempts=$(( attempts + 1 ))
    sleep 1
  done
  if (( attempts == 30 )); then
    print -u2 -- "local health check did not report release $target_sha"
    return 1
  fi

  response="$(curl -fsS "$PUBLIC_HEALTH_URL")"
  RESPONSE="$response" EXPECTED_SHA="$target_sha" "$NODE_BIN" -e '
    const body = JSON.parse(process.env.RESPONSE);
    if (body.ok !== true || body.releaseSha !== process.env.EXPECTED_SHA) process.exit(1);
  '
}

require_absolute_path DEPLOY_GIT_DIR "$GIT_DIR"
require_absolute_path DEPLOY_STATE_DIR "$STATE_DIR"
require_absolute_path DEPLOY_RELEASES_DIR "$RELEASES_DIR"
require_absolute_path DEPLOY_CURRENT_LINK "$CURRENT_LINK"
require_absolute_path DEPLOY_SHARED_ROOT "$SHARED_ROOT"
[[ -x "$NODE_BIN" ]] || { print -u2 -- "Node executable is unavailable: $NODE_BIN"; exit 1; }
[[ "$($NODE_BIN -p 'process.versions.node.split(".")[0]')" == 22 ]] || {
  print -u2 -- "deployment requires Node 22"
  exit 1
}
git check-ref-format --branch "$BRANCH" >/dev/null
[[ -f "$STATE_HELPER" ]] || { print -u2 -- "deployment state helper is unavailable"; exit 1; }
for hook in "$VALIDATION_BIN" "$BACKUP_BIN" "$RESTART_BIN" "$HEALTHCHECK_BIN"; do
  [[ -z "$hook" || -x "$hook" ]] || { print -u2 -- "deployment hook is not executable: $hook"; exit 1; }
done
[[ ! -e "$CURRENT_LINK" || -L "$CURRENT_LINK" ]] || {
  print -u2 -- "current path exists and is not a symlink: $CURRENT_LINK"
  exit 1
}

stage=lock
mkdir -p "$STATE_DIR" "$RELEASES_DIR" "${CURRENT_LINK:h}"
lock_dir="$STATE_DIR/deploy.lock"
mkdir "$lock_dir" || { print -u2 -- "another deployment is running"; exit 1; }
lock_acquired=1

stage=fetch
if [[ ! -d "$GIT_DIR" ]]; then
  git init --bare "$GIT_DIR" >/dev/null
fi
if git --git-dir="$GIT_DIR" remote get-url origin >/dev/null 2>&1; then
  git --git-dir="$GIT_DIR" remote set-url origin "$REMOTE_URL"
else
  git --git-dir="$GIT_DIR" remote add origin "$REMOTE_URL"
fi
git --git-dir="$GIT_DIR" fetch --no-tags origin "+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}"

stage=resolve
target_sha="$(git --git-dir="$GIT_DIR" rev-parse --verify "refs/remotes/origin/$BRANCH^{commit}")"
(( ${#target_sha} == 40 )) && [[ "$target_sha" != *[^0-9a-f]* ]] || {
  print -u2 -- "resolved target is not a full Git SHA"
  exit 1
}
short_sha="${target_sha[1,12]}"
release="$RELEASES_DIR/$short_sha"
candidate="$RELEASES_DIR/.candidate-$short_sha-$$"
last_successful_sha="$("$NODE_BIN" "$STATE_HELPER" get lastSuccessfulSha)"
if [[ "$last_successful_sha" == "$target_sha" ]]; then
  print -r -- "$target_sha is already deployed"
  exit 0
fi
last_failed_sha="$("$NODE_BIN" "$STATE_HELPER" get lastFailedSha)"
if [[ "$last_failed_sha" == "$target_sha" ]] && (( force == 0 )); then
  print -r -- "$target_sha previously failed; use --force to retry"
  exit 0
fi
if [[ -e "$release" || -L "$release" ]]; then
  print -u2 -- "release path already exists: $release"
  exit 1
fi

stage=export
mkdir "$candidate"
git --git-dir="$GIT_DIR" archive "$target_sha" | tar -x -C "$candidate"
print -r -- "$target_sha" > "$candidate/.release-sha"

stage=validate
run_validation || exit $?

stage=backup
backup="$STATE_DIR/backups/crm-before-$short_sha.db"
mkdir -p "${backup:h}"
if [[ -n "$BACKUP_BIN" ]]; then
  "$BACKUP_BIN" "$backup"
else
  sqlite3 "$SHARED_ROOT/data/crm.db" ".backup '$backup'"
fi

stage=link
releases_real="$(cd "$RELEASES_DIR" && pwd -P)"
candidate_parent_real="$(cd "${candidate:h}" && pwd -P)"
[[ "$candidate" == "$RELEASES_DIR"/* && "$candidate_parent_real" == "$releases_real" ]] || {
  print -u2 -- "refusing to modify unsafe candidate path: $candidate"
  exit 1
}
for name in .env data logs reports recon-runs contact-recon-reports; do
  rm -rf -- "$candidate/$name"
  ln -s "$SHARED_ROOT/$name" "$candidate/$name"
done

stage=promote
mv "$candidate" "$release"
candidate=""

stage=switch
previous_release=""
if [[ -L "$CURRENT_LINK" ]]; then
  previous_release="$(cd "$CURRENT_LINK" && pwd -P)"
fi
atomic_switch "$release" deploy || exit $?
switched=1

stage=restart
run_restarts || exit $?

stage=health
run_healthcheck || exit $?

stage=record-success
"$NODE_BIN" "$STATE_HELPER" success "$target_sha" "$release" "$previous_release"
print -r -- "deployed $target_sha"
