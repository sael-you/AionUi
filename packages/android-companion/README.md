# AionUi companion (Android)

The companion app lets the AionUi agents you allow use **this** Android phone — read the
screen, tap, swipe, type, open apps — **only while you switch them on**, with a visible
notification and a floating **Stop** chip the whole time. It is route (b) of
[C38 Agents on the owner's Android phone](../../../clauterm-studio/design/mobile/C38-ANDROID-ACCESS.md)
(TASK-136, card A1). No computer, no cable, no adb needed.

|              |                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Android      | 8.0 (API 26) or newer; tested build target API 35                                                                    |
| Connection   | outbound `wss://<your AionUi host>/api/devices/relay` (W2), started by the phone                                     |
| Distribution | sideload (signed APK). **Not on Google Play**: Play only allows autonomous Accessibility use for accessibility tools |
| Package      | `com.aionui.companion`                                                                                               |

## Install

1. In AionUi open **Settings → Devices → your phone → Companion app**. It shows two QR codes:
   the **download** link (short-lived) and the **pairing** code.
2. Scan the download QR with the phone's camera, open the link, install the APK. Android asks
   once to allow installs from your browser ("Install unknown apps").
3. Open **AionUi companion**.

Installing with `adb install aionui-companion.apk` from a computer works too (and avoids
Android's developer-verification flow for sideloads in the countries where it applies).

## Pair

Tap **Scan QR code** and scan the pairing QR, or type the AionUi address (e.g.
`y.example.com`, an `https://` address is accepted too) and the pairing code, then **Pair**.
If you scan the pairing QR with the phone's camera app instead, it opens the companion with
both fields filled in; you still tap **Pair**.

The phone receives a token once, at pairing. It is stored encrypted with a key that never
leaves the Android Keystore, excluded from backups. **Unpair** forgets it; removing the device
in AionUi revokes it (the app then asks you to pair again).

## Permissions (one time)

The app's checklist shows each one and opens the right Settings screen.

1. **Accessibility service** — needed to read the screen and to tap, swipe and type.
   **Android 13 and newer, sideloaded apps: "Allow restricted settings" first.**
   If the AionUi companion switch in _Settings → Accessibility_ is greyed out
   ("Restricted setting"):
   1. open **Settings → Apps → AionUi companion** (the app's **App info** button goes there),
   2. tap the **⋮** menu (top right) → **Allow restricted settings**, confirm with your PIN,
   3. go back to _Settings → Accessibility → AionUi companion_ and turn it on.

   The menu entry appears only after you have tried to turn the service on once. On some
   phones _Advanced Protection_ blocks non-accessibility apps from this API entirely; the
   companion cannot work there.

2. **Display over other apps** — for the floating "AionUi is controlling this phone · Stop"
   chip. Without it the notification is the only indicator.
3. **Notifications** (Android 13+) — the session notification with **Stop**.
4. The **camera** is asked for only when you scan a QR code.

## Use

- **Agents may use this phone** is **off** by default. While it is off, every agent request is
  refused on the phone itself (AionUi refuses them too).
- **Start session** connects to AionUi and Android asks whether AionUi may see your screen.
  Android asks **before every session** (the grant is single use). Decline and agents can
  still read the accessibility tree and act, but get no screenshots.
- **Stop** — in the notification, on the floating chip or in the app — switches agents off
  **at once**, ends the screen capture and closes the session.
- While a session runs, Android 15+ hides private notifications and one-time codes from the
  capture, and shows its own screen-sharing chip in the status bar.

What agents can do (W2 verbs this app serves): `screenshot` (PNG, or JPEG when scaled down),
`ui_tree` (accessibility tree in `uiautomator dump` form; password fields never carry their
text), `tap`, `swipe`, `text` (types into the focused field), `key` (Back 4, Home 3,
Recents 187, Enter 66), `launch` (apps with a launcher screen), `foreground`, `stop`.
Not served here: logs of other apps, installing APKs, Chrome DevTools — those need the
Mac relay route. Which actions need your OK in AionUi first (payments, messaging, app stores,
…) is decided by AionUi before a request ever reaches the phone.

## Build (maintainers)

The project is a standalone Gradle build (not a bun workspace). It needs JDK 17 and the
Android SDK (platform 35, build-tools 35); in the AionUi container they live in
`/root/.clauterm/android-sdk`.

```bash
./keystore.sh          # ONCE: release key in /root/.clauterm/keys (mode 700/600), never in git
./build.sh             # unit tests + lint + signed release APK → dist/
./build.sh --publish <AIONUI data dir>/devices/companion   # what core serves as the download
./build.sh --unsigned  # debug build for local tests only
```

`dist/` holds exactly `aionui-companion.apk`, `aionui-companion.apk.sha256` (64 hex chars)
and `version.txt` (versionName, versionCode). `--publish` replaces them atomically. This repo
is public: the keystore, its password and the signing properties stay in
`/root/.clauterm/keys/` and are read through `AIONUI_ANDROID_SIGNING`. A new release key would
force every phone to uninstall first, so `keystore.sh` refuses to replace it.

Release certificate (SHA-256), to check an APK with `apksigner verify --print-certs`:
`69:1A:60:E5:9F:0C:F5:91:A4:A5:88:8B:96:81:1D:E2:86:1E:AF:44:4D:A2:F9:7E:60:44:EC:EE:05:4A:53:73`

## Layout

| Path        | What                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `protocol/` | W2 frames and the pairing QR (`aionui-pair:v1?host=…&code=…`) — pure Kotlin, unit-tested                 |
| `relay/`    | the relay session (pair/hello, ping 20 s, idle close 60 s, backoff 1–60 s, revoke) and the OkHttp socket |
| `device/`   | verb dispatcher (args, owner switch, timeouts), Accessibility Service, screen capture, ui_tree XML       |
| `service/`  | foreground service (notification + Stop), overlay chip, shared state                                     |
| `store/`    | the Keystore-encrypted pairing token                                                                     |
| `ui/`       | the single screen: pair, switch, session, permission checklist                                           |

Strings ship in the 13 AionUi locales; `LocalesTest` and Android lint (`MissingTranslation`
is an error) fail the build on a missing one.
