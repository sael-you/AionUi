/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

// The real SendBox inside a project surface: its border, focus border and focus
// glow resolve through the --project-* variables set on the surface root.

const env = vi.hoisted(() => ({ appearance: 'light' as 'light' | 'dark' }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listAvailableSkills: { invoke: vi.fn().mockResolvedValue([]) },
      listWorkspaceFiles: { invoke: vi.fn().mockResolvedValue([]) },
    },
  },
}));

vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeAppearance: () => env.appearance,
  useThemeContext: () => ({ theme: env.appearance }),
}));

vi.mock('@/common/adapter/httpBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/adapter/httpBridge')>()),
  // Project colour preferences: no backend in these tests.
  httpRequest: vi.fn(async () => undefined),
}));

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({
    conversation_id: 'sendbox-active-focus-conversation',
    type: 'acp',
  }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    setSendBoxHandler: vi.fn(),
    domSnippets: [],
    removeDomSnippet: vi.fn(),
    clearDomSnippets: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMessageList: () => [],
}));

vi.mock('@/renderer/hooks/file/useConversationExport', () => ({
  useConversationExport: () => ({
    isOpen: false,
    showMenu: false,
    step: 'menu',
    filename: '',
    pathPreview: '',
    menuItems: [],
    activeIndex: 0,
    loading: false,
    openExportFlow: vi.fn(),
    closeExportFlow: vi.fn(),
    handleKeyDown: vi.fn(),
    onSelectMenuItem: vi.fn(),
    setActiveIndex: vi.fn(),
    setFilename: vi.fn(),
    submitFilename: vi.fn(),
  }),
}));

vi.mock('@/renderer/components/chat/BtwOverlay/useBtwCommand', () => ({
  useBtwCommand: () => ({
    answer: '',
    question: '',
    isLoading: false,
    isOpen: false,
    ask: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('@/renderer/hooks/file/useDragUpload', () => ({
  useDragUpload: () => ({ isFileDragging: false, dragHandlers: {} }),
}));

vi.mock('@/renderer/hooks/file/usePasteService', () => ({
  usePasteService: () => ({ onPaste: vi.fn(), onFocus: vi.fn() }),
}));

vi.mock('@/renderer/hooks/file/useUploadState', () => ({
  useUploadState: () => ({ isUploading: false }),
}));

vi.mock('@/renderer/hooks/file/useAbortUploadsOnConversationChange', () => ({
  useAbortUploadsOnConversationChange: vi.fn(),
}));

vi.mock('@/renderer/hooks/system/useLiveTranscriptInsertion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/hooks/system/useLiveTranscriptInsertion')>();
  return {
    ...actual,
    useLiveTranscriptInsertion: () => ({ handleLiveTranscript: vi.fn() }),
  };
});

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: vi.fn() },
  useAddEventListener: vi.fn(),
}));

vi.mock('@/renderer/components/chat/BtwOverlay', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/SpeechInputButton', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/UploadProgressBar', () => ({ default: () => null }));

import SendBox from '@/renderer/components/chat/SendBox';
import { useProjectTheme } from '@/renderer/components/workspace/ProjectIdentity';

const ProjectSurface: React.FC<{ workspace: string | null }> = ({ workspace }) => {
  const project = useProjectTheme(workspace);
  const [value, setValue] = useState('');
  return (
    <div data-testid='surface' style={project?.style} {...project?.dataAttributes}>
      <SendBox value={value} onChange={setValue} onSend={vi.fn().mockResolvedValue(undefined)} active={false} />
    </div>
  );
};

const panelOf = (container: HTMLElement) => container.querySelector('.sendbox-panel') as HTMLElement;

describe('SendBox project accent', () => {
  it('uses the project border at rest and the project focus border + glow when focused', () => {
    const { container } = render(<ProjectSurface workspace='/root/projects/aionui' />);
    const surface = screen.getByTestId('surface');
    expect(surface.style.getPropertyValue('--project-border')).toMatch(/^rgba\(/);
    expect(surface.style.getPropertyValue('--project-focus')).toMatch(/^#[0-9a-f]{6}$/);

    const panel = panelOf(container);
    expect(panel.getAttribute('style')).toContain('var(--project-border, #c9cacf)');

    fireEvent.focus(screen.getByTestId('sendbox-input'));
    expect(panel.getAttribute('style')).toContain('var(--project-focus, #E1E0FF)');
    expect(panel.getAttribute('style')).toContain('var(--project-focus-shadow, ');
  });

  it('keeps the dark neutral fallbacks for dark mode outside a project', () => {
    env.appearance = 'dark';
    const { container } = render(<ProjectSurface workspace={null} />);
    expect(screen.getByTestId('surface').style.getPropertyValue('--project-border')).toBe('');
    expect(panelOf(container).getAttribute('style')).toContain('var(--project-border, #3a3a4a)');
    env.appearance = 'light';
  });
});
