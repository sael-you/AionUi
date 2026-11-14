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

vi.mock('@/common/config/configService', () => ({
  configService: { whenReady: () => Promise.resolve(), get: () => undefined, set: () => Promise.resolve() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import WorkspaceCollapse from '@/renderer/pages/conversation/components/WorkspaceCollapse';
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

const ActiveGroup: React.FC<{ workspace: string; current: string | null }> = ({ workspace, current }) => {
  const project = useProjectTheme(current);
  const active = workspace === current;
  return (
    <WorkspaceCollapse
      expanded
      onToggle={() => {}}
      header={<span>{workspace}</span>}
      active={active}
      activeClassName='active-group'
      activeStyle={active ? project?.style : undefined}
    >
      <div />
    </WorkspaceCollapse>
  );
};

describe('sidebar active project group', () => {
  it('highlights the group of the current project with its accent and follows a switch', () => {
    const view = render(<ActiveGroup workspace='/root/projects/a' current='/root/projects/a' />);
    const header = view.container.querySelector('[data-active-project]') as HTMLElement;
    expect(header).toHaveClass('active-group');
    expect(header.style.getPropertyValue('--project-accent')).toMatch(/^#[0-9a-f]{6}$/);
    expect(header.style.getPropertyValue('--project-tint')).toMatch(/^rgba\(.*, 0\.06\)$/);

    view.rerender(<ActiveGroup workspace='/root/projects/a' current='/root/projects/b' />);
    expect(view.container.querySelector('[data-active-project]')).toBeNull();
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
