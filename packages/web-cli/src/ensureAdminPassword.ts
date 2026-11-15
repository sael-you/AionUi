/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * On first tarball launch, the aioncore's SQLite `users` table holds the
 * seeded `system_default_user` row with an empty password_hash. We probe
 * /api/auth/status; if `needs_setup === true`, ask the backend to generate and
 * persist a random password via POST /api/webui/reset-password and print it to
 * stdout so the user can log in.
 *
 * Mirrors Electron's maybeSeedInitialPassword in
 * packages/desktop/src/process/bridge/webuiBridge.ts:52-77 and the Bun dev
 * helper in scripts/webui.ts — when either changes, keep this in sync.
 *
 * The printed format is load-bearing: scripts/smoke-test-web-cli.sh greps for
 * "Generated initial admin password: <pw>". Do not change it without updating
 * that script.
 *
 * WebUI identity (card C11): the reset endpoint is local-only there and accounts
 * are managed outside aionui-web. The status is still probed: with no password
 * yet the first-password steps are printed as a warning, otherwise the procedure.
 */

/**
 * How passwords and sessions are managed when AionCore runs in WebUI identity
 * (card C11; the Token Pool's RUNBOOK.md is the reference). Printed by `resetpass`
 * and at start-up.
 */
export const WEBUI_PASSWORD_PROCEDURE: readonly string[] = [
  'AionCore runs in WebUI identity: /api/webui/reset-password and resetpass are not used.',
  'Owner password: change it in the AionUi settings, or reset it in the container with',
  '  node /opt/aionui-tp/current/token-pool/service/cli.js set-password <user> < <file-with-new-password>',
  '  (first line of the file; delete the file afterwards).',
  'Sign out every session: `aioncore --data-dir <data-dir> user disable --username <internal user>`, then',
  '  `... user enable --username <internal user>`, then restart AionUi and the Token Pool together',
  '  (`kill -HUP $(cat /run/aionui-tp.pid)`).',
  'Never run `aioncore user set-password` on its own: the Token Pool internal.json would no longer match.',
  'See the Token Pool RUNBOOK.md.',
];

/**
 * First start in WebUI identity with no AionCore password yet (`needs_setup`):
 * the internal account and the gateway credentials must be created together.
 */
export const WEBUI_FIRST_PASSWORD_STEPS: readonly string[] = [
  'WARNING: AionCore runs in WebUI identity and has no password yet — nobody can sign in.',
  'Set the internal account password with `aioncore user set-password` AND write the Token Pool',
  '  internal.json with the same password atomically, in the same step (see the Token Pool RUNBOOK.md).',
  'Then set the owner login with',
  '  node /opt/aionui-tp/current/token-pool/service/cli.js set-password <user> < <file-with-new-password>',
];

export type EnsureAdminPasswordDeps = {
  fetch: typeof fetch;
  log: (msg: string) => void;
  warn: (msg: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

export type EnsureAdminPasswordOptions = {
  /** 127.0.0.1 port where aioncore listens (from WebHostHandle.backendPort). */
  backendPort: number;
  /** Total wait budget for /api/auth/status coming up. Default: 15s. */
  statusTimeoutMs?: number;
  /** Poll interval between /api/auth/status attempts. Default: 500ms. */
  statusPollIntervalMs?: number;
  /** Backend identity (`resolveBackendIdentity()`); `webui` skips the local-only seeding. */
  identity?: 'local' | 'webui';
  /**
   * Command to show in fallback hints ("Forgot the password? Run ..."). Varies
   * by launch context — packaged tarball = `aionui-web resetpass`, in-repo dev
   * = `bun run resetpass`. Defaults to the packaged form.
   */
  resetCommand?: string;
};

type AuthStatus = {
  needs_setup?: boolean;
  data?: { needs_setup?: boolean };
};

type ResetPasswordResponse = {
  data?: { new_password?: string };
  new_password?: string;
};

type SystemUserResponse = {
  data?: { username?: string } | null;
};

async function waitForStatus(
  deps: EnsureAdminPasswordDeps,
  url: string,
  budgetMs: number,
  intervalMs: number
): Promise<AuthStatus> {
  const deadline = deps.now() + budgetMs;
  let lastErr: unknown = undefined;
  while (deps.now() < deadline) {
    try {
      const res = await deps.fetch(url);
      if (res.ok) {
        return (await res.json()) as AuthStatus;
      }
      lastErr = new Error(`/api/auth/status returned ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await deps.sleep(intervalMs);
  }
  throw lastErr instanceof Error ? lastErr : new Error('/api/auth/status did not come up in time');
}

async function fetchAdminUsername(deps: EnsureAdminPasswordDeps, backendPort: number): Promise<string> {
  try {
    const res = await deps.fetch(`http://127.0.0.1:${backendPort}/api/auth/internal/users/system`);
    if (!res.ok) return 'admin';
    const json = (await res.json()) as SystemUserResponse;
    return json.data?.username || 'admin';
  } catch {
    return 'admin';
  }
}

/**
 * Probe backend auth state. On fresh install, POST reset-password and print the
 * generated credentials. Never throws — any failure is warned and the caller
 * continues starting the server (user can still see the login page, they just
 * need to run resetpass manually).
 */
export async function ensureAdminPassword(
  opts: EnsureAdminPasswordOptions,
  deps: EnsureAdminPasswordDeps
): Promise<void> {
  const timeoutMs = opts.statusTimeoutMs ?? 15_000;
  const intervalMs = opts.statusPollIntervalMs ?? 500;
  const resetCmd = opts.resetCommand ?? 'aionui-web resetpass';
  const base = `http://127.0.0.1:${opts.backendPort}`;

  let status: AuthStatus;
  try {
    status = await waitForStatus(deps, `${base}/api/auth/status`, timeoutMs, intervalMs);
  } catch (err) {
    deps.warn(`[aionui-web] could not verify admin credentials: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  const needsSetup = status.needs_setup ?? status.data?.needs_setup ?? false;

  // WebUI identity: the reset endpoint is local-only; never call it. Without a
  // password yet, say loudly how the first one must be set; otherwise point to
  // the procedure.
  if (opts.identity === 'webui') {
    if (needsSetup) WEBUI_FIRST_PASSWORD_STEPS.forEach((line) => deps.warn(`[aionui-web] ${line}`));
    else WEBUI_PASSWORD_PROCEDURE.forEach((line) => deps.log(`[aionui-web] ${line}`));
    return;
  }

  if (!needsSetup) {
    const username = await fetchAdminUsername(deps, opts.backendPort);
    deps.log(`[aionui-web] Log in with username "${username}". Forgot the password? Run \`${resetCmd}\`.`);
    return;
  }

  try {
    const resetRes = await deps.fetch(`${base}/api/webui/reset-password`, { method: 'POST' });
    if (!resetRes.ok) {
      deps.warn(`[aionui-web] /api/webui/reset-password returned ${resetRes.status} — run \`${resetCmd}\``);
      return;
    }
    const payload = (await resetRes.json()) as ResetPasswordResponse;
    const newPassword = payload.data?.new_password ?? payload.new_password;
    if (!newPassword) {
      deps.warn(`[aionui-web] /api/webui/reset-password returned no new_password — run \`${resetCmd}\``);
      return;
    }
    const username = await fetchAdminUsername(deps, opts.backendPort);
    deps.log(`[aionui-web] Generated initial admin password: ${newPassword}`);
    deps.log(`[aionui-web] Log in with username "${username}" and change it from the UI.`);
  } catch (err) {
    deps.warn(
      `[aionui-web] failed to seed initial admin password: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
