#!/usr/bin/env bash
# Builds and signs the Clockwize WidgetKit extension and its reload helper.
#
#   desktop/widget/build.sh <outDir>
#
# Leaves <outDir>/ClockwizeWidget.appex and <outDir>/clockwize-widget-reload,
# both signed (hardened runtime). The last line printed is TEAM_ID=<id>; when
# the feed secret was generated here, WIDGET_SECRET=<hex> is printed right before it.
# Exits 0 with "skipped: ..." when Xcode, xcodegen or a signing identity is
# missing (e.g. on CI), so callers can treat the widget as optional.
#
# The widget reads its state from the app's local HTTP feed. Its URL and shared
# secret are baked into the extension's Info.plist (ClockwizeFeedURL / ClockwizeFeedSecret):
#   CLOCKWIZE_WIDGET_PORT      feed port on 127.0.0.1 (default 47321).
#   CLOCKWIZE_WIDGET_SECRET    bearer secret ([A-Za-z0-9._~+/=-]). If empty, a random
#                              32-byte hex secret is generated and printed.
#
# Optional environment:
#   CLOCKWIZE_SIGN_IDENTITY    codesign identity (name or SHA-1). Default: the first
#                              "Developer ID Application" identity, else "Apple Development".
#   CLOCKWIZE_TEAM_ID          team id reported on the last line. Default: derived from the identity.
#   CLOCKWIZE_HOST_BUNDLE_ID   bundle id of the app that embeds the widget (default
#                              com.yairix.clockwize). Baked into the reload helper:
#                              WidgetKit only reloads widgets of the caller's own app.
#   CLOCKWIZE_WIDGET_BUNDLE_ID extension bundle id (default <host id>.widget).
#   CLOCKWIZE_VERSION          CFBundleShortVersionString (default: desktop/package.json version).
#   CLOCKWIZE_BUILD_NUMBER     CFBundleVersion (default: same as the version).
#   CLOCKWIZE_ARCHS            architectures (default "arm64 x86_64").
#   CLOCKWIZE_SIGN_TIMESTAMP   set to "none" to sign without a secure timestamp (offline builds).
#
# Everything is built under $TMPDIR (the repo lives in iCloud Drive, whose
# extended attributes break codesign); nothing is written inside the repo.
set -euo pipefail

skip() {
  echo "skipped: $*"
  exit 0
}

fail() {
  echo "error: $*" >&2
  exit 1
}

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "usage: $0 <outDir>" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_ARG="$1"

LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
HOST_BUNDLE_ID="${CLOCKWIZE_HOST_BUNDLE_ID:-com.yairix.clockwize}"
WIDGET_BUNDLE_ID="${CLOCKWIZE_WIDGET_BUNDLE_ID:-$HOST_BUNDLE_ID.widget}"
RELOAD_ID="com.yairix.clockwize.widget-reload"
ARCHS_SETTING="${CLOCKWIZE_ARCHS:-arm64 x86_64}"
LIMIT=300

# ---------------------------------------------------------------- helpers

# Runs "$@" with a time limit. Exit status 124 (timeout) or 142 (perl alarm)
# means the limit was hit.
with_timeout() {
  local seconds=$1
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$seconds" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$seconds" "$@"
  else
    perl -e 'alarm shift; exec @ARGV or exit 127' "$seconds" "$@"
  fi
}

timed_out() { [[ $1 -eq 124 || $1 -eq 142 ]]; }

# codesign with a time limit. A hang almost always means macOS is showing a
# Keychain "Allow" dialog for the signing key - only the user can answer it.
sign() {
  local status=0
  with_timeout "$LIMIT" codesign "$@" || status=$?
  if timed_out "$status"; then
    fail "codesign timed out after ${LIMIT}s - it is probably waiting for a Keychain 'Allow' dialog. Click 'Always Allow' and run build.sh again."
  fi
  return "$status"
}

sign_with_timestamp() {
  if [[ "${CLOCKWIZE_SIGN_TIMESTAMP:-}" == "none" ]]; then
    sign --timestamp=none "$@"
    return
  fi
  if ! sign --timestamp "$@"; then
    echo "warning: signing with a secure timestamp failed (offline?) - retrying without one; the result can't be notarized." >&2
    sign --timestamp=none "$@"
  fi
}

# Team id from the certificate's OU (Apple Development certificates carry a
# personal id, not the team id, in the parentheses of their name).
team_from_certificate() {
  local identity=$1 pem
  if [[ "$identity" =~ ^[0-9A-Fa-f]{40}$ ]]; then
    local hash
    hash="$(tr '[:lower:]' '[:upper:]' <<<"$identity")"
    pem="$(security find-certificate -a -Z -p 2>/dev/null | awk -v h="$hash" '
      /^SHA-1 hash:/ { keep = ($3 == h); next }
      keep { print }
      /END CERTIFICATE/ { keep = 0 }')"
  else
    pem="$(security find-certificate -c "$identity" -p 2>/dev/null || true)"
  fi
  [[ -n "$pem" ]] || return 0
  openssl x509 -noout -subject -nameopt multiline 2>/dev/null <<<"$pem" |
    sed -nE 's/^ *organizationalUnitName *= *([A-Z0-9]{10}) *$/\1/p' | head -1
}

# ---------------------------------------------------------------- prerequisites

[[ "$WIDGET_BUNDLE_ID" == "$HOST_BUNDLE_ID".* ]] ||
  fail "the widget bundle id ($WIDGET_BUNDLE_ID) must start with the host app's bundle id ($HOST_BUNDLE_ID)."

[[ "$(uname -s)" == "Darwin" ]] || skip "not running on macOS"
xcodebuild -version >/dev/null 2>&1 || skip "Xcode (xcodebuild) is not installed"

XCODEGEN="$(command -v xcodegen || true)"
for candidate in /opt/homebrew/bin/xcodegen /usr/local/bin/xcodegen; do
  [[ -z "$XCODEGEN" && -x "$candidate" ]] && XCODEGEN="$candidate"
done
[[ -n "$XCODEGEN" ]] || skip "xcodegen is not installed (brew install xcodegen)"

IDENTITY="${CLOCKWIZE_SIGN_IDENTITY:-}"
IDENTITY_NAME="$IDENTITY"
if [[ -z "$IDENTITY" ]]; then
  identities="$(with_timeout 60 security find-identity -v -p codesigning 2>/dev/null || true)"
  line="$(grep '"Developer ID Application:' <<<"$identities" | head -1 || true)"
  [[ -n "$line" ]] || line="$(grep '"Apple Development:' <<<"$identities" | head -1 || true)"
  [[ -n "$line" ]] || skip "no code signing identity (Developer ID Application / Apple Development) in the keychain"
  IDENTITY="$(awk '{print $2}' <<<"$line")"
  IDENTITY_NAME="$(sed -E 's/^[^"]*"(.*)".*$/\1/' <<<"$line")"
fi

TEAM_ID="${CLOCKWIZE_TEAM_ID:-}"
if [[ -z "$TEAM_ID" && "$IDENTITY_NAME" == "Developer ID Application:"* ]]; then
  TEAM_ID="$(sed -nE 's/.*\(([A-Z0-9]{10})\)$/\1/p' <<<"$IDENTITY_NAME")"
fi
[[ -n "$TEAM_ID" ]] || TEAM_ID="$(team_from_certificate "$IDENTITY")"
[[ "$TEAM_ID" =~ ^[A-Z0-9]{10}$ ]] || fail "could not determine the team id for the signing identity - set CLOCKWIZE_TEAM_ID"

VERSION="${CLOCKWIZE_VERSION:-}"
if [[ -z "$VERSION" ]]; then
  VERSION="$(plutil -extract version raw -o - "$SCRIPT_DIR/../package.json" 2>/dev/null || echo "1.0.0")"
fi
BUILD_NUMBER="${CLOCKWIZE_BUILD_NUMBER:-$VERSION}"

WIDGET_PORT="${CLOCKWIZE_WIDGET_PORT:-47321}"
[[ "$WIDGET_PORT" =~ ^[0-9]+$ ]] && (( WIDGET_PORT >= 1 && WIDGET_PORT <= 65535 )) ||
  fail "CLOCKWIZE_WIDGET_PORT must be a port number (1-65535), got '$WIDGET_PORT'"
FEED_URL="http://127.0.0.1:$WIDGET_PORT"

WIDGET_SECRET="${CLOCKWIZE_WIDGET_SECRET:-}"
SECRET_GENERATED=0
if [[ -z "$WIDGET_SECRET" ]]; then
  WIDGET_SECRET="$(openssl rand -hex 32 2>/dev/null || true)"
  [[ -n "$WIDGET_SECRET" ]] || WIDGET_SECRET="$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')"
  SECRET_GENERATED=1
fi
# Keep it to characters that survive Info.plist build-setting expansion and HTTP headers.
[[ "$WIDGET_SECRET" =~ ^[A-Za-z0-9._~+/=-]+$ ]] ||
  fail "CLOCKWIZE_WIDGET_SECRET may only contain letters, digits and . _ ~ + / = -"

KIND="${IDENTITY_NAME%%:*}"
[[ "$KIND" == "$IDENTITY_NAME" ]] && KIND="custom identity"
echo "Clockwize widget: version $VERSION, team $TEAM_ID, signing with $KIND"
[[ "$KIND" == "Apple Development" ]] && echo "warning: Apple Development signature - fine for local testing, not for distribution." >&2

# ---------------------------------------------------------------- build

TMP_ROOT="${TMPDIR:-/tmp}"
WORK="${TMP_ROOT%/}/clockwize-widget-build"
SRC="$WORK/src"
DERIVED="$WORK/DerivedData"
STAGE="$WORK/stage"
PRODUCTS="$DERIVED/Build/Products/Release"
LOG="$WORK/xcodebuild.log"

rm -rf "$SRC" "$STAGE" "$DERIVED/Build/Products"
mkdir -p "$SRC" "$STAGE"
rsync -a --exclude '*.xcodeproj' --exclude '.DS_Store' "$SCRIPT_DIR/" "$SRC/"
xattr -cr "$SRC"

(cd "$SRC" && "$XCODEGEN" generate --quiet --spec project.yml) || fail "xcodegen failed"

status=0
with_timeout "$LIMIT" xcodebuild \
  -project "$SRC/ClockwizeWidget.xcodeproj" \
  -scheme ClockwizeWidget \
  -configuration Release \
  -derivedDataPath "$DERIVED" \
  -destination 'generic/platform=macOS' \
  ARCHS="$ARCHS_SETTING" \
  ONLY_ACTIVE_ARCH=NO \
  CODE_SIGNING_ALLOWED=NO \
  CLOCKWIZE_WIDGET_PORT="$WIDGET_PORT" \
  CLOCKWIZE_WIDGET_SECRET="$WIDGET_SECRET" \
  CLOCKWIZE_WIDGET_BUNDLE_ID="$WIDGET_BUNDLE_ID" \
  CLOCKWIZE_HOST_BUNDLE_ID="$HOST_BUNDLE_ID" \
  MARKETING_VERSION="$VERSION" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  build >"$LOG" 2>&1 || status=$?

if [[ $status -ne 0 ]]; then
  grep -E "error:" "$LOG" | sort -u | head -40 >&2 || true
  timed_out "$status" && fail "xcodebuild timed out after ${LIMIT}s (log: $LOG)"
  fail "xcodebuild failed (log: $LOG)"
fi
grep -E "\.swift:[0-9]+:[0-9]+: warning:" "$LOG" | sort -u >&2 || true

[[ -d "$PRODUCTS/ClockwizeWidget.appex" ]] || fail "ClockwizeWidget.appex missing from $PRODUCTS"
[[ -f "$PRODUCTS/clockwize-widget-reload" ]] || fail "clockwize-widget-reload missing from $PRODUCTS"
[[ -e "$PRODUCTS/ClockwizeWidget.appex/Contents/Resources/Metadata.appintents" ]] ||
  echo "warning: Metadata.appintents is missing - widget buttons and controls will not work" >&2

BUILT_PLIST="$PRODUCTS/ClockwizeWidget.appex/Contents/Info.plist"
[[ "$(plutil -extract ClockwizeFeedURL raw -o - "$BUILT_PLIST" 2>/dev/null)" == "$FEED_URL" ]] ||
  fail "ClockwizeFeedURL in the built Info.plist is not $FEED_URL"
[[ "$(plutil -extract ClockwizeFeedSecret raw -o - "$BUILT_PLIST" 2>/dev/null)" == "$WIDGET_SECRET" ]] ||
  fail "ClockwizeFeedSecret in the built Info.plist does not match the secret"

# Copy out, then remove the unsigned products: an unsigned copy that
# LaunchServices knows about makes pkd reject the extension ("plug-ins must be
# sandboxed") and hides the signed one.
ditto "$PRODUCTS/ClockwizeWidget.appex" "$STAGE/ClockwizeWidget.appex"
ditto "$PRODUCTS/clockwize-widget-reload" "$STAGE/clockwize-widget-reload"
"$LSREGISTER" -u "$PRODUCTS/ClockwizeWidget.appex" >/dev/null 2>&1 || true
rm -rf "$DERIVED/Build/Products"

# ---------------------------------------------------------------- sign

ENTITLEMENTS="$WORK/ClockwizeWidget.entitlements"
cp "$SRC/ClockwizeWidget.entitlements.template" "$ENTITLEMENTS"
plutil -lint -s "$ENTITLEMENTS" || fail "the entitlements file is not a valid plist"

xattr -cr "$STAGE"
sign_with_timestamp --force --sign "$IDENTITY" --options runtime \
  --identifier "$RELOAD_ID" "$STAGE/clockwize-widget-reload" || fail "signing clockwize-widget-reload failed"
sign_with_timestamp --force --sign "$IDENTITY" --options runtime \
  --entitlements "$ENTITLEMENTS" "$STAGE/ClockwizeWidget.appex" || fail "signing ClockwizeWidget.appex failed"

for item in "$STAGE/clockwize-widget-reload" "$STAGE/ClockwizeWidget.appex"; do
  with_timeout "$LIMIT" codesign --verify --strict "$item" || fail "signature check failed for $(basename "$item")"
done

# ---------------------------------------------------------------- output

mkdir -p "$OUT_ARG"
OUT_DIR="$(cd "$OUT_ARG" && pwd)"
rm -rf "$OUT_DIR/ClockwizeWidget.appex" "$OUT_DIR/clockwize-widget-reload"
ditto "$STAGE/ClockwizeWidget.appex" "$OUT_DIR/ClockwizeWidget.appex"
ditto "$STAGE/clockwize-widget-reload" "$OUT_DIR/clockwize-widget-reload"
rm -rf "$STAGE"

echo "built: $OUT_DIR/ClockwizeWidget.appex ($WIDGET_BUNDLE_ID, $(lipo -archs "$OUT_DIR/ClockwizeWidget.appex/Contents/MacOS/ClockwizeWidget"))"
echo "built: $OUT_DIR/clockwize-widget-reload (reloads widgets of $HOST_BUNDLE_ID, $(lipo -archs "$OUT_DIR/clockwize-widget-reload"))"
echo "feed: $FEED_URL (GET /widget-state, POST /widget-action)"
[[ $SECRET_GENERATED -eq 1 ]] && echo "WIDGET_SECRET=$WIDGET_SECRET"
echo "TEAM_ID=$TEAM_ID"
