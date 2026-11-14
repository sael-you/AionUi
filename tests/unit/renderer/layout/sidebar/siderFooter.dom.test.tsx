/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import SiderFooter from '@/renderer/components/layout/Sider/SiderFooter';

const renderFooter = (overrides: Partial<React.ComponentProps<typeof SiderFooter>> = {}) => {
  const handlers = { onSettingsClick: vi.fn(), onThemeToggle: vi.fn(), onLogoutClick: vi.fn() };
  render(
    <SiderFooter
      isMobile={false}
      isSettings={false}
      theme='light'
      siderTooltipProps={{ disabled: true }}
      userName='youssef'
      showLogout
      {...handlers}
      {...overrides}
    />
  );
  return handlers;
};

describe('sidebar footer (one compact row)', () => {
  it('shows the user avatar + name and opens Settings from the row', () => {
    const { onSettingsClick } = renderFooter();
    const user = screen.getByTestId('sider-footer-user');
    expect(user.textContent).toContain('Y');
    expect(user.textContent).toContain('youssef');
    // A real (Arco) button: keyboard activation comes with it.
    expect(user.tagName).toBe('BUTTON');
    fireEvent.click(user);
    expect(onSettingsClick).toHaveBeenCalledTimes(1);
  });

  it('falls back to a local-user label without an account (desktop)', () => {
    renderFooter({ userName: undefined });
    expect(screen.getByTestId('sider-footer-user').textContent).toContain('conversation.sidebar.footer.localUser');
  });

  it('offers Settings, the theme switch and Logout in its menu', async () => {
    const { onThemeToggle, onLogoutClick } = renderFooter();
    fireEvent.click(screen.getByTestId('sider-footer-menu'));
    fireEvent.click(await screen.findByText('settings.darkMode'));
    expect(onThemeToggle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('sider-footer-menu'));
    fireEvent.click(await screen.findByText('settings.googleLogout'));
    expect(onLogoutClick).toHaveBeenCalledTimes(1);
  });

  it('hides Logout when there is no session to end', async () => {
    renderFooter({ showLogout: false });
    fireEvent.click(screen.getByTestId('sider-footer-menu'));
    await screen.findByText('settings.darkMode');
    expect(screen.queryByText('settings.googleLogout')).toBeNull();
  });

  it('turns the row into "Back" inside Settings', () => {
    renderFooter({ isSettings: true });
    expect(screen.getByTestId('sider-footer-user').getAttribute('aria-label')).toContain('common.back');
  });

  it('keeps an icon-only account menu in the collapsed sidebar (icon rail)', async () => {
    const { onThemeToggle, onLogoutClick, onSettingsClick } = renderFooter({ collapsed: true });
    // No name in the rail, but the avatar button and the menu trigger stay.
    expect(screen.getByTestId('sider-footer-user').textContent).not.toContain('youssef');
    const trigger = screen.getByTestId('sider-footer-menu');
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('aria-label')).toBe('conversation.sidebar.footer.menu');
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByText('common.settings'));
    expect(onSettingsClick).toHaveBeenCalledTimes(1);
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByText('settings.darkMode'));
    expect(onThemeToggle).toHaveBeenCalledTimes(1);
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByText('settings.googleLogout'));
    expect(onLogoutClick).toHaveBeenCalledTimes(1);
  });
});
