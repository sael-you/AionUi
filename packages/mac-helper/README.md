# mac-helper (TASK-136, C38)

Go, CGO-free, built for `darwin/arm64` + `darwin/amd64` from any OS. Not a bun workspace (no `package.json`).
Design: `clauterm-studio/design/mobile/C38-ANDROID-ACCESS.md` §5–§7. Owner guide: [INSTALL.md](INSTALL.md).

| Package                 | Role                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `cmd/aionui-mac-helper` | CLI: pair, run, status, switches, install-adb, launchd, logs                                |
| `internal/wire`         | W2 frames — mirror of core `aionui-api-types/src/devices.rs` (the single source)            |
| `internal/relay`        | outbound `wss://<host>/api/devices/relay`: pair/hello, inventory, ping, requests, stop      |
| `internal/agent`        | relay handler: inventory, local switches, per-phone verb lock, screenshots, APK install     |
| `internal/adb`          | fixed adb commands with validated, single-quoted arguments; platform-tools installer        |
| `internal/cdp`          | phone Chrome DevTools tunnel (`adb forward` → browser socket)                               |
| `internal/config`       | state dir (0700), config + token files (0600), per-device switches                          |
| `internal/audit`        | local JSON-lines log (no typed text, screenshots or tokens)                                 |
| `internal/macos`        | notifications, launchd agent; `control/`: Mac verbs (CoreGraphics via purego, JXA tree)     |
| `internal/addons`       | add-on host: uv bootstrap (sha256), Artemis (pinned commit) / Mobilerun (PyPI), runs + stop |
| `internal/shot`         | screenshot encoding (PNG, or downscaled JPEG q80)                                           |

```sh
export PATH=/root/.clauterm/toolchain/go/bin:$PATH   # container toolchain
go vet ./... && go test -race ./...
./scripts/build.sh                                   # dist/aionui-mac-helper-{arm64,amd64} + SHA256SUMS
```

Rules: no secrets in this public repo; the device token lives only in the owner's state dir. A wire change starts
in core's `devices.rs`, then `internal/wire`, then C38 §7.
