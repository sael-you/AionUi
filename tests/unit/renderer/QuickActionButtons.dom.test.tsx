/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

const mocks = vi.hoisted(() => ({
  desktop: true,
  getStatus: vi.fn(),
  statusChangedOn: vi.fn(() => () => {}),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  webui: {
    getStatus: { invoke: mocks.getStatus },
    statusChanged: { on: mocks.statusChangedOn },
  },
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => mocks.desktop,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

const renderButtons = async () => {
  vi.resetModules();
  const { default: QuickActionButtons } = await import('@/renderer/pages/guid/components/QuickActionButtons');
  return render(
    <QuickActionButtons
      onOpenLink={vi.fn()}
      onOpenBugReport={vi.fn()}
      inactiveBorderColor='var(--border-base)'
      activeShadow='none'
    />
  );
};

describe('QuickActionButtons WebUI shortcut (TASK-95)', () => {
  beforeEach(() => {
    mocks.desktop = true;
    mocks.getStatus.mockReset().mockResolvedValue({ running: true });
    mocks.statusChangedOn.mockClear();
  });

  it('shows the WebUI shortcut with its status on the desktop app', async () => {
    await renderButtons();

    await waitFor(() => expect(screen.getByText(/settings\.webui · settings\.webui\.running/)).toBeTruthy());
    expect(mocks.getStatus).toHaveBeenCalledTimes(1);
  });

  it('hides the WebUI shortcut and asks for no status inside the WebUI', async () => {
    mocks.desktop = false;
    await renderButtons();

    expect(screen.getByText('conversation.welcome.quickActionFeedback')).toBeTruthy();
    expect(screen.queryByText(/settings\.webui/)).toBeNull();
    expect(mocks.getStatus).not.toHaveBeenCalled();
    expect(mocks.statusChangedOn).not.toHaveBeenCalled();
  });
});
