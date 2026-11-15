/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ChatLayout carries the project colour tokens on its root (header chip, header
// tint, and the send box inside it read them). These tests pin which variables
// a given project + theme produces and that switching project / theme updates them.

const env = vi.hoisted(() => ({ appearance: 'light' as 'light' | 'dark', isMobile: false }));

vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeAppearance: () => env.appearance,
  useThemeContext: () => ({ theme: env.appearance }),
}));

vi.mock('@/common/adapter/httpBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/adapter/httpBridge')>()),
  // Project colour preferences: no backend in these tests.
  httpRequest: vi.fn(async () => undefined),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) => (options?.name ? `${key}:${options.name}` : key),
  }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: env.isMobile }),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({ isOpen: false }),
  PreviewPanel: () => null,
}));

vi.mock('@/renderer/pages/conversation/components/ChatLayout/MobileWorkspaceOverlay', () => ({
  default: () => null,
}));

vi.mock('@/renderer/pages/conversation/components/ChatLayout/WorkspacePanelHeader', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/pages/conversation/components/ChatTitleEditor', () => ({
  default: () => <div>title</div>,
}));

vi.mock('@/renderer/components/agent/AgentBadge', () => ({
  AgentLogoIcon: () => null,
}));

vi.mock('@/renderer/hooks/ui/useResizableSplit', () => ({
  useResizableSplit: () => ({ splitRatio: 60, setSplitRatio: vi.fn(), createDragHandle: () => null }),
}));

vi.mock('@/renderer/pages/conversation/hooks/useContainerWidth', () => ({
  useContainerWidth: () => ({ containerRef: { current: null }, containerWidth: 1200 }),
}));

vi.mock('@/renderer/pages/conversation/hooks/useLayoutConstraints', () => ({
  useLayoutConstraints: () => undefined,
}));

vi.mock('@/renderer/pages/conversation/hooks/useTitleRename', () => ({
  useTitleRename: () => ({
    editingTitle: false,
    setEditingTitle: vi.fn(),
    titleDraft: '',
    setTitleDraft: vi.fn(),
    renameLoading: false,
    canRenameTitle: false,
    submitTitleRename: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/hooks/useWorkspaceCollapse', () => ({
  useWorkspaceCollapse: () => ({ rightSiderCollapsed: true, setRightSiderCollapsed: vi.fn() }),
}));

import ChatLayout from '@/renderer/pages/conversation/components/ChatLayout';
import { useInputFocusRing } from '@/renderer/hooks/chat/useInputFocusRing';
import { STORAGE_KEYS } from '@/common/config/storageKeys';
import {
  PROJECT_COLORS,
  autoProjectColorId,
  buildProjectTheme,
  type ProjectColorId,
} from '@/renderer/components/workspace/ProjectIdentity';
import { resetProjectColorsForTest } from '@/renderer/components/workspace/ProjectIdentity/useProjectColors';

/** Stand-in for the send box: applies the same focus-ring hook SendBox uses for its border. */
const SendBoxProbe: React.FC = () => {
  const { inactiveBorderColor, activeBorderColor, activeShadow } = useInputFocusRing();
  return (
    <div
      data-testid='sendbox'
      data-border={inactiveBorderColor}
      data-focus-border={activeBorderColor}
      data-focus-shadow={activeShadow}
    />
  );
};

const renderLayout = (projectWorkspace?: string | null) =>
  render(
    <ChatLayout sider={null} workspaceEnabled={false} projectWorkspace={projectWorkspace}>
      <SendBoxProbe />
    </ChatLayout>
  );

const surface = (container: HTMLElement) => container.querySelector('[data-project-surface]') as HTMLElement | null;
const tokensOf = (id: ProjectColorId, theme: 'light' | 'dark') =>
  buildProjectTheme(PROJECT_COLORS.find((c) => c.id === id)!, theme);

const WS = '/root/projects/aionui';

beforeEach(() => {
  env.appearance = 'light';
  env.isMobile = false;
  localStorage.clear();
  resetProjectColorsForTest();
});

afterEach(() => {
  localStorage.clear();
});

describe('ChatLayout project identity', () => {
  it('sets the --project-* variables of the project colour for the light theme', () => {
    const { container } = renderLayout(WS);
    const root = surface(container)!;
    const expected = tokensOf(autoProjectColorId(WS), 'light');
    expect(root).toHaveAttribute('data-project-color', autoProjectColorId(WS));
    expect(root).toHaveAttribute('data-project-appearance', 'light');
    expect(root.style.getPropertyValue('--project-accent')).toBe(expected.accent);
    expect(root.style.getPropertyValue('--project-accent-contrast')).toBe(expected.accentContrast);
    expect(root.style.getPropertyValue('--project-tint')).toBe(expected.tint);
    expect(root.style.getPropertyValue('--project-border')).toBe(expected.border);
    expect(root.style.getPropertyValue('--project-focus')).toBe(expected.focus);
    expect(root.style.getPropertyValue('--project-focus-shadow')).toBe(expected.focusShadow);
  });

  it('shows the project chip (name + icon) and tints the header', () => {
    const { container } = renderLayout(`${WS}/`);
    const chip = container.querySelector('[data-project-chip]') as HTMLElement;
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent('aionui');
    expect(chip.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByText('conversation.projectIdentity.label:aionui')).toHaveClass('sr-only');
    expect(container.querySelector('[data-project-header="tint"]')).toBeInTheDocument();
  });

  it('routes the send box border, focus border and glow through the project variables', () => {
    renderLayout(WS);
    const sendbox = screen.getByTestId('sendbox');
    expect(sendbox.dataset.border).toBe('var(--project-border, #c9cacf)');
    expect(sendbox.dataset.focusBorder).toBe('var(--project-focus, #E1E0FF)');
    expect(sendbox.dataset.focusShadow).toMatch(/^var\(--project-focus-shadow, /);
    // The send box sits inside the root that defines those variables.
    expect(sendbox.closest('[data-project-surface]')).not.toBeNull();
  });

  it('uses the dark-theme tokens in dark mode', () => {
    env.appearance = 'dark';
    const { container } = renderLayout(WS);
    const root = surface(container)!;
    const expected = tokensOf(autoProjectColorId(WS), 'dark');
    expect(root).toHaveAttribute('data-project-appearance', 'dark');
    expect(root.style.getPropertyValue('--project-accent')).toBe(expected.accent);
    expect(root.style.getPropertyValue('--project-accent-contrast')).toBe(expected.accentContrast);
  });

  it('honours the user colour choice', () => {
    localStorage.setItem(STORAGE_KEYS.PROJECT_COLORS, JSON.stringify({ [WS]: 'violet' }));
    resetProjectColorsForTest();
    const { container } = renderLayout(WS);
    expect(surface(container)).toHaveAttribute('data-project-color', 'violet');
    expect(surface(container)!.style.getPropertyValue('--project-accent')).toBe(tokensOf('violet', 'light').accent);
  });

  it('updates the variables and the chip when switching project or theme', () => {
    localStorage.setItem(
      STORAGE_KEYS.PROJECT_COLORS,
      JSON.stringify({ [WS]: 'teal', '/root/projects/clauterm': 'orange' })
    );
    resetProjectColorsForTest();
    const view = renderLayout(WS);
    expect(surface(view.container)!.style.getPropertyValue('--project-accent')).toBe(tokensOf('teal', 'light').accent);

    view.rerender(
      <ChatLayout sider={null} workspaceEnabled={false} projectWorkspace='/root/projects/clauterm'>
        <SendBoxProbe />
      </ChatLayout>
    );
    const root = surface(view.container)!;
    expect(root).toHaveAttribute('data-project-color', 'orange');
    expect(root.style.getPropertyValue('--project-accent')).toBe(tokensOf('orange', 'light').accent);
    expect(view.container.querySelector('[data-project-chip]')).toHaveTextContent('clauterm');

    env.appearance = 'dark';
    view.rerender(
      <ChatLayout sider={null} workspaceEnabled={false} projectWorkspace='/root/projects/clauterm'>
        <SendBoxProbe />
      </ChatLayout>
    );
    expect(surface(view.container)!.style.getPropertyValue('--project-accent')).toBe(tokensOf('orange', 'dark').accent);
  });

  it('stays neutral without a project (no variables, chip or header tint)', () => {
    const { container } = renderLayout(null);
    expect(surface(container)).toBeNull();
    expect(container.querySelector('[data-project-chip]')).toBeNull();
    expect(container.querySelector('[data-project-header]')).toBeNull();
    // The send box falls back to its neutral colours.
    expect(screen.getByTestId('sendbox').dataset.border).toBe('var(--project-border, #c9cacf)');
  });

  it('leaves the header tint to the mobile titlebar on mobile', () => {
    env.isMobile = true;
    const { container } = renderLayout(WS);
    expect(surface(container)).not.toBeNull();
    expect(container.querySelector('[data-project-header]')).toBeNull();
  });
});
