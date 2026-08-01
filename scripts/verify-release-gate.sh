#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: verify-release-gate.sh --health-url URL --expected-sha SHA --database ABSOLUTE_PATH

Checks the release health JSON and SHA, then runs SQLite integrity_check and
foreign_key_check against the explicitly supplied database in read-only mode.
EOF
}

fail() {
  printf 'release gate failed: %s\n' "$1" >&2
  exit 1
}

health_url=''
expected_sha=''
database_path=''

while (( $# > 0 )); do
  case "$1" in
    --health-url)
      (( $# >= 2 )) || fail '--health-url requires a value'
      [[ -z "$health_url" ]] || fail '--health-url may only be provided once'
      health_url="$2"
      shift 2
      ;;
    --expected-sha)
      (( $# >= 2 )) || fail '--expected-sha requires a value'
      [[ -z "$expected_sha" ]] || fail '--expected-sha may only be provided once'
      expected_sha="$2"
      shift 2
      ;;
    --database)
      (( $# >= 2 )) || fail '--database requires a value'
      [[ -z "$database_path" ]] || fail '--database may only be provided once'
      database_path="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage
      fail "unknown argument: $1"
      ;;
  esac
done

[[ -n "$health_url" ]] || { usage; fail '--health-url is required'; }
[[ -n "$expected_sha" ]] || { usage; fail '--expected-sha is required'; }
[[ -n "$database_path" ]] || { usage; fail '--database is required'; }

case "$health_url" in
  http://*|https://*) ;;
  *) fail '--health-url must use HTTP or HTTPS' ;;
esac
[[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] || fail '--expected-sha must be a full lowercase Git SHA'
[[ "$database_path" == /* ]] || fail '--database must be an absolute path'
[[ -f "$database_path" && -r "$database_path" ]] || fail 'the explicit database is not a readable file'

command -v curl >/dev/null 2>&1 || fail 'curl is required'
command -v node >/dev/null 2>&1 || fail 'node is required'
command -v sqlite3 >/dev/null 2>&1 || fail 'sqlite3 is required'

if ! health_json="$(curl --fail --silent --show-error --max-time 15 "$health_url")"; then
  fail 'health request failed'
fi

if ! HEALTH_JSON="$health_json" EXPECTED_RELEASE_SHA="$expected_sha" node <<'NODE'
let body;
try {
  body = JSON.parse(process.env.HEALTH_JSON || '');
} catch (_error) {
  console.error('release gate failed: health response is not valid JSON');
  process.exit(1);
}
if (!body || body.ok !== true || body.database !== 'ok') {
  console.error('release gate failed: health JSON does not report an available database');
  process.exit(1);
}
if (body.releaseSha !== process.env.EXPECTED_RELEASE_SHA) {
  console.error('release gate failed: release SHA mismatch');
  process.exit(1);
}
NODE
then
  exit 1
fi

if ! integrity_output="$(sqlite3 -readonly "$database_path" 'PRAGMA integrity_check;')"; then
  fail 'SQLite integrity_check could not run'
fi
[[ "$integrity_output" == 'ok' ]] || fail 'SQLite integrity_check did not return ok'

if ! foreign_key_output="$(sqlite3 -readonly "$database_path" 'PRAGMA foreign_key_check;')"; then
  fail 'SQLite foreign_key_check could not run'
fi
[[ -z "$foreign_key_output" ]] || fail 'SQLite foreign_key_check returned violations'

printf 'release gate passed: %s\n' "$expected_sha"
