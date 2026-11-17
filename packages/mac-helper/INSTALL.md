# AionUi Mac Helper — install guide

The helper lets AionUi agents use the Android phones connected to your Mac (USB or Wi-Fi debugging) while you
allow it. It connects **out** to your AionUi server; nothing listens on your Mac. Every phone is **off** until you
switch it on, here and in AionUi (Settings → Devices).

## 1 Get the binary

Download `aionui-mac-helper-arm64` (Apple silicon) or `aionui-mac-helper-amd64` (Intel) and its `SHA256SUMS`, then:

```sh
shasum -a 256 -c SHA256SUMS --ignore-missing
mkdir -p ~/bin && mv aionui-mac-helper-arm64 ~/bin/aionui-mac-helper && chmod +x ~/bin/aionui-mac-helper
```

## 2 Allow it to run (Gatekeeper, once)

The helper is **ad-hoc signed** (no Apple Developer ID), so macOS blocks the first start:

1. Run `~/bin/aionui-mac-helper version`. macOS says it cannot verify the developer — close the dialog.
2. Open **System Settings → Privacy & Security**, scroll to **Security**, click **Open Anyway** next to
   "aionui-mac-helper" (the button stays for about an hour after the blocked start), enter your password.
3. Run `~/bin/aionui-mac-helper version` again and confirm **Open**.

Source: Apple, "Open a Mac app from an unknown developer"
(https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac).
Each new version of the binary asks again.

## 3 Install adb

Either Google's platform-tools into the helper's own folder (downloaded from Google, checked against Google's
published size and checksum; you accept the Android SDK License, https://developer.android.com/studio/terms):

```sh
aionui-mac-helper install-adb --accept-android-sdk-license
```

or an adb you already have on `PATH` (e.g. `brew install --cask android-platform-tools`).

## 4 Prepare the phone

- **USB:** Settings → About phone → tap _Build number_ 7× → Developer options → **USB debugging** on → plug in →
  accept the "Allow USB debugging?" prompt on the phone.
- **Wi-Fi (Android 11+, same Wi-Fi as the Mac):** Developer options → **Wireless debugging** → _Pair device with
  pairing code_, then on the Mac `adb pair <ip>:<port>` and `adb connect <ip>:<port>` with the values shown on
  the phone (https://developer.android.com/tools/adb#connect-to-a-device-over-wi-fi).
- **Chrome inspection:** open Chrome on the phone; it then shows as "Chrome" in AionUi.

## 5 Pair with AionUi

In AionUi: **Settings → Devices → Phones → Pair a Mac**, copy the code (valid a few minutes), then:

```sh
aionui-mac-helper pair https://<your-aionui-host> <CODE>
aionui-mac-helper status                 # lists phones with their serials
aionui-mac-helper enable <serial>        # allow agents on this phone (also switch it on in AionUi)
aionui-mac-helper install-agent          # keep the helper running (starts at login)
```

## 6 While it runs

- A macOS notification appears when agents start using a phone.
- **Stop everything now:** `aionui-mac-helper stop-all` (undo: `resume`), or switch the phone off in AionUi.
- `aionui-mac-helper disable <serial>` switches one phone off; `logs` shows what agents did (verbs, no typed text
  or screenshots).
- AionUi asks you before crucial actions (payments, messages, deletes) and keeps its own audit.

## 7 Control of this Mac (optional, off by default)

Agents can also take screenshots of the main display, read the frontmost app's accessibility tree, click, type,
press keys and open apps on this Mac — only after you grant macOS permissions **and** switch `mac` on:

1. System Settings → Privacy & Security → **Screen Recording** → add `aionui-mac-helper` and switch it on.
2. System Settings → Privacy & Security → **Accessibility** → add `aionui-mac-helper` and switch it on.
3. The first accessibility-tree read asks to let the helper control **System Events** — allow it.
4. `aionui-mac-helper status` shows `permissions granted`; then `aionui-mac-helper enable mac` and switch the Mac
   on in AionUi.

Limits: main display only; clicks use points (screenshots are scaled to points to match); text fields marked secure
never report their content; macOS ties the permissions to this exact binary, so **every new version needs steps
1–2 again** (ad-hoc signature, no Apple Developer ID). AionUi asks you before crucial actions here too.

## 8 Remove

```sh
aionui-mac-helper uninstall-agent
aionui-mac-helper forget                 # also revoke the device in AionUi → Devices
rm -rf ~/bin/aionui-mac-helper "$HOME/Library/Application Support/AionUi Mac Helper"
```
