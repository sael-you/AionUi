/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common/adapter/httpBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/adapter/httpBridge')>()),
  // Project colour preferences: no backend in these tests.
  httpRequest: vi.fn(async () => undefined),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { AuthProvider, useAuth } from '@/renderer/hooks/context/AuthContext';
import ProjectGroup from '@/renderer/pages/conversation/GroupedHistory/components/ProjectGroup';
import {
  ProjectLabel,
  projectIdentityOf,
  projectIdentityOfConversation,
  setCurrentProjectIdentity,
  useCurrentProjectIdentity,
  useProjectTheme,
} from '@/renderer/components/workspace/ProjectIdentity';
import {
  getCurrentProjectIdentity,
  resetCurrentProjectIdentityForTest,
} from '@/renderer/components/workspace/ProjectIdentity/currentProjectIdentityStore';
import { resetProjectColorsForTest } from '@/renderer/components/workspace/ProjectIdentity/useProjectColors';
import { normalizeWorkspace } from '@/renderer/utils/workspace/workspace';

beforeEach(() => {
  localStorage.clear();
  resetProjectColorsForTest();
  resetCurrentProjectIdentityForTest();
});

describe('project identity of a conversation', () => {
  it('is the normalised user-chosen workspace, like the sidebar grouping', () => {
    expect(
      projectIdentityOfConversation({
        project_id: 'p1',
        extra: { workspace: 'C:\\work\\app\\', custom_workspace: true },
      } as never)
    ).toEqual({ projectId: 'p1', workspace: 'C:/work/app' });
  });

  it('is null for temporary or missing workspaces', () => {
    expect(projectIdentityOfConversation({ extra: { workspace: '/tmp/x', custom_workspace: false } } as never)).toBe(
      null
    );
    expect(projectIdentityOfConversation({ extra: { custom_workspace: true } } as never)).toBe(null);
    expect(projectIdentityOfConversation(null)).toBe(null);
    expect(projectIdentityOf('', 'p')).toBe(null);
    expect(projectIdentityOf('/a/b', undefined)).toEqual({ projectId: null, workspace: '/a/b' });
  });
});

describe('module boundaries', () => {
  it('the shared ProjectIdentity module does not import page code', () => {
    const dir = path.resolve(
      __dirname,
      '../../../../packages/desktop/src/renderer/components/workspace/ProjectIdentity'
    );
    const files = fs.readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(fs.readFileSync(path.join(dir, file), 'utf8'), file).not.toMatch(/from '[^']*renderer\/pages\//);
    }
  });

  it('normalizeWorkspace lives in the renderer workspace utilities', () => {
    expect(normalizeWorkspace('C:\\a\\')).toBe('C:/a');
    expect(normalizeWorkspace('/root/x/')).toBe('/root/x');
  });
});

describe('current project identity store', () => {
  it('notifies on change only', () => {
    const { result } = renderHook(() => useCurrentProjectIdentity());
    expect(result.current).toBeNull();
    act(() => setCurrentProjectIdentity({ projectId: 'p1', workspace: '/a' }));
    const first = result.current;
    expect(first).toEqual({ projectId: 'p1', workspace: '/a' });
    act(() => setCurrentProjectIdentity({ projectId: 'p1', workspace: '/a' }));
    expect(result.current).toBe(first);
    act(() => setCurrentProjectIdentity({ projectId: 'p2', workspace: '/b' }));
    expect(result.current).toEqual({ projectId: 'p2', workspace: '/b' });
    act(() => setCurrentProjectIdentity(null));
    expect(getCurrentProjectIdentity()).toBeNull();
  });
});

const ActiveGroup: React.FC<{ workspace: string; current: string | null }> = ({ workspace, current }) => (
  <ProjectGroup workspace={workspace} name='a' expanded onToggle={() => {}} active={workspace === current} count={0} />
);

describe('sidebar active project group', () => {
  it('highlights the row of the current project with its accent and follows a switch', () => {
    const view = render(<ActiveGroup workspace='/root/projects/a' current='/root/projects/a' />);
    const row = view.container.querySelector('[data-active-project]') as HTMLElement;
    expect(row).not.toBeNull();
    const group = row.closest('[data-project-color]') as HTMLElement;
    expect(group.style.getPropertyValue('--project-accent')).toMatch(/^#[0-9a-f]{6}$/);
    expect(group.style.getPropertyValue('--project-tint')).toMatch(/^rgba\(.*, 0\.06\)$/);

    view.rerender(<ActiveGroup workspace='/root/projects/a' current='/root/projects/b' />);
    expect(view.container.querySelector('[data-active-project]')).toBeNull();
  });
});

describe('sign-out cleanup', () => {
  it('removes every account copy and unsaved edit of the project colours', () => {
    localStorage.setItem('aionui_project_colors', '{}');
    localStorage.setItem('aionui_project_colors:A', '{"/a":"red"}');
    localStorage.setItem('aionui_project_colors_pending:A', '{"/a":"red"}');
    localStorage.setItem('unrelated', '1');
    let clear: (() => void) | undefined;
    const Grab = () => {
      clear = useAuth().clearAuthCache;
      return null;
    };
    render(
      <AuthProvider>
        <Grab />
      </AuthProvider>
    );
    act(() => clear?.());
    expect(localStorage.getItem('aionui_project_colors:A')).toBeNull();
    expect(localStorage.getItem('aionui_project_colors_pending:A')).toBeNull();
    expect(localStorage.getItem('aionui_project_colors')).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('1');
  });
});

describe('ProjectLabel (mobile titlebar)', () => {
  it('shows icon + name with the project variables', () => {
    const Harness = () => {
      const project = useProjectTheme('/root/projects/clauterm-studio');
      return project ? <ProjectLabel project={project} /> : null;
    };
    const { container } = render(<Harness />);
    const label = container.querySelector('[data-project-label]') as HTMLElement;
    expect(label).toHaveTextContent('clauterm-studio');
    expect(label.querySelector('svg')).toBeInTheDocument();
    expect(label.style.getPropertyValue('--project-accent-contrast')).toMatch(/^#[0-9a-f]{6}$/);
    expect(screen.getByText('conversation.projectIdentity.label')).toHaveClass('sr-only');
  });
});
