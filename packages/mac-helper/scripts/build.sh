#!/usr/bin/env bash
# Build the Mac helper for macOS (arm64 + amd64) from any OS, CGO-free.
# Go's linker gives darwin/arm64 binaries an ad-hoc signature, which Apple
# Silicon requires; there is no Apple Developer ID (see INSTALL.md for the
# Gatekeeper "Open anyway" step). Output: dist/aionui-mac-helper-<arch>.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${VERSION:-0.1.0+$(git rev-parse --short HEAD 2>/dev/null || echo dev)}"
mkdir -p dist
for arch in arm64 amd64; do
  CGO_ENABLED=0 GOOS=darwin GOARCH="$arch" go build -trimpath \
    -ldflags "-s -w -X main.version=${VERSION}" \
    -o "dist/aionui-mac-helper-${arch}" ./cmd/aionui-mac-helper
done
(cd dist && sha256sum aionui-mac-helper-* > SHA256SUMS 2>/dev/null || shasum -a 256 aionui-mac-helper-* > SHA256SUMS)
echo "built dist/ (version ${VERSION})"
