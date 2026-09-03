#!/usr/bin/env bash
set -uo pipefail

# Read-only release-candidate preflight. It never pushes, merges, deploys,
# restarts services, or opens the production database.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
CENTRAL_REPO="${TRADEPULSE_CENTRAL_REPO:-$ROOT/../repo}"
PRODUCTION_ROOT="${TRADEPULSE_PRODUCTION_ROOT:-/Users/ylf/Desktop/projects/tradepulse-production}"
REPORT_PATH=""
SKIP_TESTS=0

usage() {
  cat <<'EOF'
Usage: scripts/release-preflight.sh [options]

Options:
  --candidate-sha SHA  Require this full SHA to be the current HEAD.
  --report FILE        Also write the result to this absolute file.
  --skip-tests         Skip npm test and node --test (never a GO result).
  -h, --help           Show this help.

Environment:
  TRADEPULSE_CENTRAL_REPO     Central clone containing origin/main.
  TRADEPULSE_PRODUCTION_ROOT  Read-only production root.
EOF
}

fail_usage() {
  printf 'release preflight usage error: %s\n' "$1" >&2
  usage >&2
  exit 2
}

candidate_sha=""
while (( $# > 0 )); do
  case "$1" in
    --candidate-sha)
      (( $# >= 2 )) || fail_usage '--candidate-sha requires a value'
      candidate_sha="$2"
      shift 2
      ;;
    --report)
      (( $# >= 2 )) || fail_usage '--report requires a value'
      REPORT_PATH="$2"
      shift 2
      ;;
    --skip-tests)
      SKIP_TESTS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail_usage "unknown option: $1"
      ;;
  esac
done

if [[ -n "$REPORT_PATH" ]]; then
  [[ "$REPORT_PATH" == /* ]] || fail_usage '--report must be absolute'
  mkdir -p "$(dirname "$REPORT_PATH")" || exit 1
  exec > >(tee "$REPORT_PATH") 2>&1
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/tradepulse-release-preflight.XXXXXX")" || exit 1
trap 'rm -rf -- "$tmp_dir"' EXIT
passes=()
warnings=()
blockers=()

pass_check() { passes+=("$1"); printf '[PASS] %s\n' "$1"; }
warn_check() { warnings+=("$1"); printf '[WARN] %s\n' "$1"; }
block_check() { blockers+=("$1"); printf '[BLOCK] %s\n' "$1"; }

run_check() {
  local label="$1"
  local log="$tmp_dir/$2.log"
  shift 2
  if "$@" >"$log" 2>&1; then
    pass_check "$label"
    return 0
  fi
  block_check "$label"
  sed -n '1,80p' "$log"
  return 1
}

printf 'TradePulse release-candidate preflight (read-only)\n'
printf 'after root: %s\n' "$ROOT"
printf 'central repo: %s\n' "$CENTRAL_REPO"
printf 'production metadata: %s\n' "$PRODUCTION_ROOT"

head_sha="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"
remote_sha="$(git -C "$CENTRAL_REPO" rev-parse origin/main 2>/dev/null || true)"
release_sha_file="$PRODUCTION_ROOT/current/.release-sha"
state_file="$PRODUCTION_ROOT/state/state.json"
production_release_sha=""
production_state_sha=""
if [[ -f "$release_sha_file" ]]; then
  production_release_sha="$(tr -d '[:space:]' < "$release_sha_file")"
fi
if [[ -f "$state_file" ]]; then
  production_state_sha="$(node -e 'const fs=require("fs"); const p=process.argv[1]; try { const j=JSON.parse(fs.readFileSync(p,"utf8")); process.stdout.write(String(j.lastSuccessfulSha || "")); } catch (_) {}' "$state_file" 2>/dev/null || true)"
fi
if [[ -z "$candidate_sha" ]]; then
  candidate_sha="$head_sha"
fi

printf 'candidate SHA: %s\n' "${candidate_sha:-<unavailable>}"
printf 'after HEAD: %s\n' "${head_sha:-<unavailable>}"
printf 'remote origin/main: %s\n' "${remote_sha:-<unavailable>}"
printf 'production current/.release-sha: %s\n' "${production_release_sha:-<unavailable>}"
printf 'production state.lastSuccessfulSha: %s\n' "${production_state_sha:-<unavailable>}"

full_sha_re='^[0-9a-f]{40}$'
if [[ "$head_sha" =~ $full_sha_re ]]; then
  pass_check 'after HEAD is a full commit SHA'
else
  block_check 'after HEAD cannot be resolved to a full commit SHA'
fi
if [[ "$candidate_sha" =~ $full_sha_re ]]; then
  pass_check 'release candidate is identified by a full commit SHA'
else
  block_check 'release candidate SHA is missing or not a full 40-character SHA'
fi
if [[ "$candidate_sha" == "$head_sha" && -n "$head_sha" ]]; then
  pass_check 'release candidate SHA matches after HEAD'
else
  block_check 'release candidate SHA does not match after HEAD'
fi

if [[ "$remote_sha" =~ $full_sha_re && "$production_release_sha" =~ $full_sha_re && "$production_state_sha" =~ $full_sha_re && "$remote_sha" == "$production_release_sha" && "$remote_sha" == "$production_state_sha" ]]; then
  pass_check 'remote main and production metadata share one baseline SHA'
else
  block_check 'remote main and production metadata are missing or divergent'
fi

if [[ "$remote_sha" =~ $full_sha_re && "$candidate_sha" =~ $full_sha_re ]] && git -C "$ROOT" merge-base --is-ancestor "$remote_sha" "$candidate_sha" >/dev/null 2>&1; then
  pass_check 'release candidate contains the remote main baseline'
else
  block_check 'release candidate does not contain the remote main baseline'
fi
if [[ "$candidate_sha" == "$remote_sha" && -n "$remote_sha" ]]; then
  pass_check 'release candidate is published at remote origin/main'
else
  block_check 'release candidate is not yet published at remote origin/main (push/merge requires explicit authorization)'
fi

dirty_non_tool=""
while IFS= read -r status_line; do
  [[ -z "$status_line" ]] && continue
  case "$status_line" in
    '?? .impeccable'|'?? .impeccable/'*) ;;
    *) dirty_non_tool+="$status_line\n" ;;
  esac
done < <(git -C "$ROOT" status --porcelain=v1 --untracked-files=all 2>/dev/null || true)
if [[ -z "$dirty_non_tool" ]]; then
  pass_check 'after worktree is clean (apart from pre-existing .impeccable artifacts)'
else
  block_check 'after worktree has uncommitted changes'
  printf '%b' "$dirty_non_tool"
fi

changed_file="$tmp_dir/changed-files.txt"
if [[ "$remote_sha" =~ $full_sha_re && "$candidate_sha" =~ $full_sha_re ]] && git -C "$ROOT" diff --name-only "$remote_sha...$candidate_sha" > "$changed_file" 2>/dev/null; then
  pass_check 'release candidate change set can be enumerated against remote main'
else
  block_check 'release candidate change set cannot be enumerated against remote main'
  : > "$changed_file"
fi

forbidden_file="$tmp_dir/forbidden-files.txt"
: > "$forbidden_file"
while IFS= read -r changed_path; do
  case "$changed_path" in
    lib/ai_stations/*|*crm_ai_*|*CRM_AI_*|.env|.env.*|data/*|recon-runs/*|contact-recon-runs/*)
      printf '%s\n' "$changed_path" >> "$forbidden_file"
      ;;
  esac
done < "$changed_file"
if [[ ! -s "$forbidden_file" ]]; then
  pass_check 'candidate change set respects AI, production-data, and secret-file freeze boundaries'
else
  block_check 'candidate change set touches a frozen AI, production-data, or secret path'
  sed -n '1,80p' "$forbidden_file"
fi

package_change_count="$(grep -Ec '^(package\.json|package-lock\.json)$' "$changed_file" 2>/dev/null || true)"
if [[ "$package_change_count" == "0" ]]; then
  pass_check 'candidate does not change package manifests'
else
  warn_check 'candidate changes package manifests; dependency audit evidence is required'
fi

if [[ "$remote_sha" =~ $full_sha_re && "$candidate_sha" =~ $full_sha_re ]]; then
  committed_diff_log="$tmp_dir/committed-diff.log"
  if git -C "$ROOT" diff --check "$remote_sha...$candidate_sha" > "$committed_diff_log" 2>&1; then
    pass_check 'committed candidate diff has no whitespace errors'
  else
    warn_check 'committed candidate range contains historical whitespace findings; working-tree diff remains the release gate'
    sed -n '1,80p' "$committed_diff_log"
  fi
else
  warn_check 'committed candidate diff whitespace check skipped because SHAs are unavailable'
fi
run_check 'working-tree diff has no whitespace errors' working-tree-diff.log git -C "$ROOT" diff --check
run_check 'governance authority check' governance.log npm --prefix "$ROOT" run check:governance-authority
run_check 'AI boundary check' ai-boundary.log npm --prefix "$ROOT" run check:ai-boundary

syntax_log="$tmp_dir/javascript-syntax.log"
: > "$syntax_log"
syntax_failures=0
while IFS= read -r changed_path; do
  case "$changed_path" in
    *.js)
      [[ -f "$ROOT/$changed_path" ]] || continue
      if ! node --check "$ROOT/$changed_path" >> "$syntax_log" 2>&1; then
        syntax_failures=$((syntax_failures + 1))
      fi
      ;;
  esac
done < "$changed_file"
if (( syntax_failures == 0 )); then
  pass_check 'changed JavaScript files pass node --check'
else
  block_check 'one or more changed JavaScript files fail node --check'
  sed -n '1,80p' "$syntax_log"
fi

if (( SKIP_TESTS == 1 )); then
  block_check 'full test suites were explicitly skipped; a skipped preflight can never be GO'
else
  run_check 'npm test (core/non-AI suite)' core-tests.log npm --prefix "$ROOT" test
  run_check 'node --test (repository suite)' repository-tests.log bash -c 'cd "$1" && node --test' _ "$ROOT"
fi

audit_log="$tmp_dir/npm-audit.json"
if npm --prefix "$ROOT" audit --omit=dev --json > "$audit_log" 2>&1; then
  audit_exit=0
else
  audit_exit=$?
fi
audit_counts="$(node -e 'const fs=require("fs"); const p=process.argv[1]; try { const j=JSON.parse(fs.readFileSync(p,"utf8")); const v=(j.metadata&&j.metadata.vulnerabilities)||{}; process.stdout.write([v.info||0,v.low||0,v.moderate||0,v.high||0,v.critical||0].join(" ")); } catch (_) {}' "$audit_log" 2>/dev/null || true)"
if [[ "$audit_counts" =~ ^[0-9]+\ [0-9]+\ [0-9]+\ [0-9]+\ [0-9]+$ ]]; then
  read -r audit_info audit_low audit_moderate audit_high audit_critical <<< "$audit_counts"
  if (( audit_high + audit_critical > 0 )); then
    block_check "npm audit reports $audit_high high and $audit_critical critical production vulnerabilities"
  elif (( audit_moderate > 0 )); then
    warn_check "npm audit reports $audit_moderate moderate, $audit_low low, and $audit_info informational production vulnerabilities"
  else
    pass_check "npm audit reports no moderate-or-higher production vulnerabilities"
  fi
else
  block_check "npm audit output could not be parsed (exit $audit_exit)"
  sed -n '1,80p' "$audit_log"
fi

printf '\nPreflight summary: %d pass, %d warning, %d blocker\n' "${#passes[@]}" "${#warnings[@]}" "${#blockers[@]}"
if (( ${#warnings[@]} > 0 )); then
  printf 'Warnings:\n'
  printf '  - %s\n' "${warnings[@]}"
fi
if (( ${#blockers[@]} > 0 )); then
  printf 'Blockers:\n'
  printf '  - %s\n' "${blockers[@]}"
  printf 'RESULT: NO-GO\n'
  exit 1
fi
printf 'RESULT: GO\n'
