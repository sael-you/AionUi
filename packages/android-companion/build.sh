#!/usr/bin/env bash
# Build, test and sign the companion APK (TASK-136 A1).
#
#   ./build.sh                    unit tests + lint + signed release → dist/
#   ./build.sh --publish <dir>    the same, then copy the 3 dist files into <dir>
#                                 (core serves <AIONUI data dir>/devices/companion/)
#   ./build.sh --unsigned         debug-signed build for local tests only (never published)
#
# dist/ holds exactly:  aionui-companion.apk · aionui-companion.apk.sha256 (64 hex + \n)
#                       · version.txt (line 1 versionName, line 2 versionCode)
#
# Signing material comes from outside the repo: AIONUI_ANDROID_SIGNING (default
# /root/.clauterm/keys/aionui-companion-signing.properties, made by keystore.sh).
set -euo pipefail
cd "$(dirname "$0")"

PUBLISH_DIR=""
UNSIGNED=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --publish) PUBLISH_DIR="${2:?--publish needs a directory}"; shift 2 ;;
    --unsigned) UNSIGNED=1; shift ;;
    *) echo "build.sh: unknown option $1" >&2; exit 2 ;;
  esac
done
if [[ $UNSIGNED -eq 1 && -n "$PUBLISH_DIR" ]]; then
  echo "build.sh: an unsigned build is never published" >&2
  exit 2
fi

export ANDROID_HOME="${ANDROID_HOME:-/root/.clauterm/android-sdk}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-/root/.clauterm/gradle-home}"
# /tmp is a small tmpfs in this container: keep Gradle/Java scratch elsewhere.
export TMPDIR="${TMPDIR_ANDROID:-/root/.clauterm/android-dl/tmp}"
mkdir -p "$TMPDIR"
export JAVA_TOOL_OPTIONS="-Djava.io.tmpdir=$TMPDIR"

GRADLE=(./gradlew --no-daemon -q)
if [[ $UNSIGNED -eq 1 ]]; then
  "${GRADLE[@]}" :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
  echo "build.sh: debug APK at app/build/outputs/apk/debug/app-debug.apk (not for release)"
  exit 0
fi

export AIONUI_ANDROID_SIGNING="${AIONUI_ANDROID_SIGNING:-/root/.clauterm/keys/aionui-companion-signing.properties}"
if [[ ! -r "$AIONUI_ANDROID_SIGNING" ]]; then
  echo "build.sh: no signing config at $AIONUI_ANDROID_SIGNING (run keystore.sh once)" >&2
  exit 1
fi

"${GRADLE[@]}" :app:testReleaseUnitTest :app:lintRelease :app:assembleRelease

APK=app/build/outputs/apk/release/app-release.apk
APKSIGNER="$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -1)apksigner"
"$APKSIGNER" verify --min-sdk-version 26 "$APK"

rm -rf dist && mkdir -p dist
cp "$APK" dist/aionui-companion.apk
sha256sum dist/aionui-companion.apk | cut -d' ' -f1 > dist/aionui-companion.apk.sha256
VERSION_NAME=$(sed -n 's/^ *versionName = "\(.*\)"/\1/p' app/build.gradle.kts)
VERSION_CODE=$(sed -n 's/^ *versionCode = \([0-9]*\)/\1/p' app/build.gradle.kts)
printf '%s\n%s\n' "$VERSION_NAME" "$VERSION_CODE" > dist/version.txt
echo "build.sh: dist/aionui-companion.apk $VERSION_NAME ($VERSION_CODE) sha256 $(cat dist/aionui-companion.apk.sha256)"

if [[ -n "$PUBLISH_DIR" ]]; then
  mkdir -p "$PUBLISH_DIR"
  # Copy then rename, so core never serves a half-written APK.
  for file in aionui-companion.apk aionui-companion.apk.sha256 version.txt; do
    cp "dist/$file" "$PUBLISH_DIR/.$file.tmp"
    mv -f "$PUBLISH_DIR/.$file.tmp" "$PUBLISH_DIR/$file"
  done
  echo "build.sh: published to $PUBLISH_DIR"
fi
