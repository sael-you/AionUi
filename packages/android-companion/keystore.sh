#!/usr/bin/env bash
# Create the companion's release signing key ONCE (TASK-136 A1). Never committed:
# this repo is public. Refuses to overwrite: a new key means every installed app
# must be uninstalled first (Android rejects an update signed with another key).
#
#   keys dir   ${AIONUI_KEYS_DIR:-/root/.clauterm/keys}   (mode 700)
#   keystore   aionui-companion-release.jks              (mode 600)
#   password   aionui-companion-release.password         (mode 600, random, never printed)
#   signing    aionui-companion-signing.properties       (mode 600, read by build.sh)
set -euo pipefail

KEYS_DIR="${AIONUI_KEYS_DIR:-/root/.clauterm/keys}"
KEYSTORE="$KEYS_DIR/aionui-companion-release.jks"
PASSWORD_FILE="$KEYS_DIR/aionui-companion-release.password"
SIGNING="$KEYS_DIR/aionui-companion-signing.properties"
ALIAS="aionui-companion"

if [[ -e "$KEYSTORE" || -e "$PASSWORD_FILE" ]]; then
  echo "keystore.sh: $KEYSTORE already exists; refusing to replace the release key." >&2
  exit 1
fi

umask 077
mkdir -p "$KEYS_DIR"
chmod 700 "$KEYS_DIR"

# 32 random bytes as hex: never echoed, only written to the 0600 file.
head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$PASSWORD_FILE"
chmod 600 "$PASSWORD_FILE"

keytool -genkeypair -v \
  -keystore "$KEYSTORE" -storetype PKCS12 \
  -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=AionUi companion, O=AionUi" \
  -storepass:file "$PASSWORD_FILE" -keypass:file "$PASSWORD_FILE" >/dev/null 2>&1
chmod 600 "$KEYSTORE"

cat > "$SIGNING" <<PROPS
storeFile=$KEYSTORE
storePasswordFile=$PASSWORD_FILE
keyAlias=$ALIAS
PROPS
chmod 600 "$SIGNING"

echo "keystore.sh: release key created in $KEYS_DIR (certificate SHA-256 below)."
keytool -list -keystore "$KEYSTORE" -storetype PKCS12 -storepass:file "$PASSWORD_FILE" -alias "$ALIAS" 2>/dev/null \
  | grep -i "SHA-256" || true
