/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Train-2 review U1 #1: AionCore (C15) masks secret MCP env values, so the
 * built-in image-generation server's AIONUI_IMG_API_KEY comes back as "•••".
 * The env sync must not treat that as a difference, or every render PUTs the
 * server again (write loop while Settings → Tools is open). It compares the
 * masked key through the SHA-256 fingerprint of the key it last sent
 * (localStorage, per server id), so a rotated key still reaches the server.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { maskedSecretEntries, mcpEnvMatchesStored } from '@/common/config/imageGenerationMcpEnv';
import {
  fingerprintSecrets,
  readSecretFingerprint,
  writeSecretFingerprint,
} from '@/renderer/utils/mcpSecretFingerprint';
import { MCP_SECRET_MASK } from '@/common/config/storage';

const MASK = '•••';
const REAL_KEY = 'FAKE-IMAGE-KEY-0001';

type Server = {
  id: string;
  name: string;
  builtin: boolean;
  enabled: boolean;
  transport: { type: 'stdio'; command: string; args: string[]; env: Record<string, string> };
};

const hooks = vi.hoisted(() => ({
  initialServers: [] as unknown[],
  updateServer: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
vi.mock('@/renderer/components/base/AionScrollArea', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/renderer/components/base/AionSelect', () => {
  const Select = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { default: Object.assign(Select, { OptGroup: Select, Option: Select }) };
});
vi.mock('@/renderer/components/base/TalkToButlerButton', () => ({ default: () => null }));
vi.mock('@/renderer/pages/settings/components/AddMcpServerModal', () => ({ default: () => null }));
vi.mock('@/renderer/pages/settings/ToolsSettings/McpServerItem', () => ({ default: () => null }));
// The Kits card (C27/C28) has its own tests; it is not part of the image settings.
vi.mock('@/renderer/pages/settings/ToolsSettings/kits/KitsSection', () => ({ default: () => null }));
vi.mock('@/renderer/pages/settings/ToolsSettings/market', () => ({ default: () => null }));
vi.mock('@/renderer/hooks/agent/useConfigModelListWithImage', () => ({
  default: () => ({
    modelListWithImage: [
      {
        id: 'p1',
        name: 'Gemini',
        platform: 'gemini',
        base_url: 'https://gemini.example',
        api_key: REAL_KEY,
        models: ['gemini-image-1'],
      },
    ],
  }),
}));
vi.mock('@/renderer/hooks/mcp', () => ({
  // Real state, so a saved (masked) server re-renders the component like the app does.
  useMcpServers: () => {
    const [mcpServers, setMcpServers] = React.useState(hooks.initialServers);
    const saveMcpServers = React.useCallback(async (updater: unknown) => {
      setMcpServers((prev: unknown[]) =>
        typeof updater === 'function' ? (updater as (p: unknown[]) => unknown[])(prev) : (updater as unknown[])
      );
    }, []);
    return { mcpServers, extensionMcpServers: [], saveMcpServers, setMcpServers, isMcpServersLoading: false };
  },
  useMcpConnection: () => ({ testingServers: {}, handleTestMcpConnection: vi.fn(), handleTestMcpConnections: vi.fn() }),
  useMcpModal: () => ({
    showMcpModal: false,
    editingMcpServer: undefined,
    deleteConfirmVisible: false,
    serverToDelete: undefined,
    mcpCollapseKey: [],
    showAddMcpModal: vi.fn(),
    showEditMcpModal: vi.fn(),
    hideMcpModal: vi.fn(),
    showDeleteConfirm: vi.fn(),
    hideDeleteConfirm: vi.fn(),
    toggleServerCollapse: vi.fn(),
  }),
  useMcpServerCRUD: () => ({
    handleAddMcpServer: vi.fn(),
    handleBatchImportMcpServers: vi.fn(),
    handleEditMcpServer: vi.fn(),
    handleDeleteMcpServer: vi.fn(),
  }),
  useMcpOAuth: () => ({
    oauthStatus: {},
    loggingIn: {},
    checkOAuthStatus: vi.fn(),
    markLoginRequired: vi.fn(),
    clearLoginRequired: vi.fn(),
    login: vi.fn(),
  }),
  useMountedMessage: (m: unknown) => m,
}));
vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: vi.fn(() => Promise.resolve({ id: 'p1', use_model: 'gemini-image-1' })),
  setClientBusinessSetting: vi.fn(() => Promise.resolve()),
  removeClientBusinessSetting: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: { updateServer: { invoke: hooks.updateServer } },
}));

import ToolsModalContent from '@/renderer/components/settings/SettingsModal/contents/ToolsModalContent';

const builtin = (env: Record<string, string>): Server => ({
  id: 'builtin-image-gen',
  name: 'aionui-image-generation',
  builtin: true,
  enabled: true,
  transport: { type: 'stdio', command: 'node', args: ['image.js'], env },
});

const resolvedEnv = (apiKey: string) => ({
  AIONUI_IMG_PROVIDER_ID: 'p1',
  AIONUI_IMG_PLATFORM: 'gemini',
  AIONUI_IMG_BASE_URL: 'https://gemini.example',
  AIONUI_IMG_API_KEY: apiKey,
  AIONUI_IMG_MODEL: 'gemini-image-1',
});

/** Let effects, the PUT and the re-render after it settle several times over. */
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
};

const SERVER_ID = 'builtin-image-gen';
const keyFingerprint = async (key: string) => (await fingerprintSecrets([['AIONUI_IMG_API_KEY', key]])) as string;

describe('built-in image MCP env sync with masked secrets', () => {
  beforeEach(() => {
    window.localStorage.clear();
    hooks.updateServer.mockReset();
    // AionCore answers the PUT like a GET: the secret masked again.
    hooks.updateServer.mockImplementation(async ({ data }: { data: { transport: Server['transport'] } }) =>
      builtin({ ...data.transport.env, AIONUI_IMG_API_KEY: MASK })
    );
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => cleanup());

  it('masked GET with an outdated model → exactly one PUT, then no write loop', async () => {
    hooks.initialServers = [builtin({ ...resolvedEnv(MASK), AIONUI_IMG_MODEL: 'old-image-model' })];
    render(<ToolsModalContent />);
    await waitFor(() => expect(hooks.updateServer).toHaveBeenCalledTimes(1));
    await settle();
    expect(hooks.updateServer).toHaveBeenCalledTimes(1);
    // The one PUT carries the real key from the provider.
    expect(hooks.updateServer.mock.calls[0][0].data.transport.env.AIONUI_IMG_API_KEY).toBe(REAL_KEY);
  });

  it('nothing changes (fingerprint of the current key stored) → no PUT', async () => {
    writeSecretFingerprint(SERVER_ID, await keyFingerprint(REAL_KEY));
    hooks.initialServers = [builtin(resolvedEnv(MASK))];
    render(<ToolsModalContent />);
    await settle();
    expect(hooks.updateServer).not.toHaveBeenCalled();
  });

  it('only the key changes (rotated) → exactly one PUT with the new key, then none', async () => {
    writeSecretFingerprint(SERVER_ID, await keyFingerprint('FAKE-OLD-KEY-0000'));
    hooks.initialServers = [builtin(resolvedEnv(MASK))];
    render(<ToolsModalContent />);
    await waitFor(() => expect(hooks.updateServer).toHaveBeenCalledTimes(1));
    await settle();
    expect(hooks.updateServer).toHaveBeenCalledTimes(1);
    expect(hooks.updateServer.mock.calls[0][0].data.transport.env.AIONUI_IMG_API_KEY).toBe(REAL_KEY);
    expect(readSecretFingerprint(SERVER_ID)).toBe(await keyFingerprint(REAL_KEY));
  });

  it('no fingerprint yet (first run) → exactly one PUT, then none; only the fingerprint is stored', async () => {
    hooks.initialServers = [builtin(resolvedEnv(MASK))];
    render(<ToolsModalContent />);
    await waitFor(() => expect(hooks.updateServer).toHaveBeenCalledTimes(1));
    await settle();
    expect(hooks.updateServer).toHaveBeenCalledTimes(1);
    expect(readSecretFingerprint(SERVER_ID)).toBe(await keyFingerprint(REAL_KEY));
    const stored = Object.keys(window.localStorage).map((k) => window.localStorage.getItem(k));
    expect(JSON.stringify(stored)).not.toContain(REAL_KEY);
  });
});

describe('mcpEnvMatchesStored', () => {
  it("compares a masked stored value through the caller's fingerprint verdict, everything else exactly", () => {
    expect(MCP_SECRET_MASK).toBe(MASK);
    expect(mcpEnvMatchesStored({ K: MASK, M: 'a' }, { K: 'real', M: 'a' }, true)).toBe(true);
    expect(mcpEnvMatchesStored({ K: MASK, M: 'a' }, { K: 'real', M: 'a' }, false)).toBe(false);
    expect(mcpEnvMatchesStored({ K: MASK, M: 'a' }, { K: 'real', M: 'a' })).toBe(false);
    expect(mcpEnvMatchesStored({ K: MASK, M: 'a' }, { K: 'real', M: 'b' }, true)).toBe(false);
    expect(mcpEnvMatchesStored({ K: MASK }, { K: '' }, true)).toBe(false);
    expect(mcpEnvMatchesStored({ K: 'x' }, { K: 'x', L: 'y' })).toBe(false);
    expect(mcpEnvMatchesStored({ K: 'x', L: 'y' }, { K: 'x', M: 'y' })).toBe(false);
    expect(maskedSecretEntries({ K: MASK, M: 'a' }, { K: 'real', M: 'a' })).toEqual([['K', 'real']]);
  });

  it('fingerprints are order-independent and differ per value', async () => {
    const a = await fingerprintSecrets([
      ['A', '1'],
      ['B', '2'],
    ]);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await fingerprintSecrets([
        ['B', '2'],
        ['A', '1'],
      ])
    ).toBe(a);
    expect(
      await fingerprintSecrets([
        ['A', '1'],
        ['B', '3'],
      ])
    ).not.toBe(a);
  });
});
