# AionUi Browser Bridge

Lets your AionUi agents use **the tabs you share** in your own Chrome or Arc, with your logins
(design C34, TASK-125). Nothing is shared until you share a tab; Chrome shows
"AionUi Browser Bridge started debugging this browser" on shared tabs, and **Cancel** there,
**Stop all** in the popup or **Revoke** in AionUi end it at once.

## Build

```bash
bun packages/browser-extension/scripts/build.ts
```

Writes `packages/browser-extension/dist/unpacked/` (load this folder) and
`dist/aionui-browser-bridge-<version>.zip`. The manifest `key` pins the extension id to
`bdgcogndgcbcmaijgnhahjddbaclknbb`; AionCore only accepts that origin.

## Install (owner, once per browser)

1. Unzip `aionui-browser-bridge-<version>.zip` somewhere permanent (e.g. `~/AionUi Browser Bridge`).
2. Chrome: open `chrome://extensions` · Arc: open `arc://extensions`. Turn on **Developer mode**.
3. **Load unpacked** → pick the unzipped folder. Pin the AionUi icon to the toolbar.
4. In AionUi: **Settings → Browser → Your own browser → Pair a Mac browser**. A code appears.
5. Click the AionUi icon in the browser: type your AionUi address (as shown next to the code), the code,
   a name ("Mac"), then **Pair**. The status turns green; AionUi lists the browser.
6. Turn on **Agents may use my Mac browser** (and **Agents can use the browser**) in Settings → Browser.
7. Open the tab you want an agent to use, click the AionUi icon, switch on **Share this tab with AionUi**.

Google sign-in, Gmail, banks and payment pages pause the agent until you tap **Allow** in AionUi.

## Local network

Shared tabs cannot reach your local network: requests to private, loopback and link-local IPs,
`localhost` and `*.local` are blocked in the browser while a tab is shared, and such pages cannot be
shared (TASK-121). Tabs you have not shared are untouched.

## Update

Rebuild, replace the folder contents, then press the reload arrow on the extension card in
`chrome://extensions`. The pairing survives.
