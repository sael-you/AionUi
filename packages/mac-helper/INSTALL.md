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

## 8 Add-ons: Artemis and Mobilerun (optional)

Two phone agents that run a whole flow on their own ("do this on my phone"), on this Mac, against a phone the
helper reaches: **Artemis** (google/artemis, Apache-2.0) and **Mobilerun** (droidrun/mobilerun, MIT; its Portal
app on the phone is AGPL-3.0 — fine for personal use). Install/remove them from AionUi → Devices → Add-ons, or:

```sh
aionui-mac-helper allow-addon artemis          # default: AionUi may NOT install, remove or run an add-on here
aionui-mac-helper addon-install artemis        # always the version pinned in the helper (google/artemis 351ca8422f7b)
aionui-mac-helper addon-install mobilerun      # Mobilerun 0.7.4, every package hash-pinned
aionui-mac-helper addon-key artemis GEMINI_API_KEY      # their own model key, typed, not shown
aionui-mac-helper addons                       # what is installed, size, stored key names
aionui-mac-helper addon-remove mobilerun       # frees the disk (Python/uv go with the last add-on)
aionui-mac-helper deny-addon artemis           # AionUi can no longer touch it (a running task can still be stopped)
```

- **Off by default.** Until you `allow-addon` one, AionUi cannot install, remove or run it on this Mac, and
  `stop-all` blocks every add-on action except stopping. AionUi can only install the exact versions pinned in the
  helper (uv 0.13.9, Artemis commit 351ca8422f7b with its lockfile, Mobilerun 0.7.4 with hashes for every package).
- They use **their own LLM loop and key** (Artemis: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …;
  Mobilerun: `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `MINIMAX_API_KEY`, …). Keys stay in the
  helper folder (file mode 0600) and are never sent anywhere else or logged.
- AionUi asks you to approve each **task text** before a run starts; inside the run the add-on taps on its own, so
  per-tap approvals do not apply. The phone's switch, `stop-all`, AionUi's Stop and the time limit end a run at once.
- Mobilerun installs its Portal app on the phone before its first task there (once per phone).
- Everything (uv, Python, add-ons) lives in the helper folder; nothing listens on the Mac (Artemis runs standalone,
  without its web console).

## 9 Remove

```sh
aionui-mac-helper uninstall-agent
aionui-mac-helper forget                 # also revoke the device in AionUi → Devices
rm -rf ~/bin/aionui-mac-helper "$HOME/Library/Application Support/AionUi Mac Helper"
```
