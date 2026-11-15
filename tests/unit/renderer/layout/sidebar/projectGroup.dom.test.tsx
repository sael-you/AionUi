/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/common/adapter/httpBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/adapter/httpBridge')>()),
  httpRequest: vi.fn(async () => undefined),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'count' in options ? `${key}:${String(options.count)}` : key,
  }),
}));

import ProjectGroup, {
  PROJECT_VISIBLE_LIMIT,
  type ProjectGroupProps,
} from '@/renderer/pages/conversation/GroupedHistory/components/ProjectGroup';

const WS = '/root/projects/aionui';

const Harness: React.FC<Partial<ProjectGroupProps> & { rows?: number; initiallyExpanded?: boolean }> = ({
  rows = 0,
  initiallyExpanded = true,
  ...props
}) => {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  return (
    <div role='tree'>
      <ProjectGroup
        workspace={WS}
        name='aionui'
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        count={rows}
        {...props}
      >
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} data-testid='row'>
            row {i}
          </div>
        ))}
      </ProjectGroup>
    </div>
  );
};

const projectRow = () => screen.getByTestId(`project-row-${WS}`);

describe('ProjectGroup row', () => {
  it('is a tree item with aria-expanded; the count shows only while collapsed; no colour dot or folder icon', () => {
    const { container } = render(<Harness rows={3} />);
    const row = projectRow();
    expect(row.getAttribute('role')).toBe('treeitem');
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(row.getAttribute('aria-level')).toBe('2');
    // Expanded: the rows are visible, so no count (C21).
    expect(screen.queryByTestId(`project-count-${WS}`)).toBeNull();
    // Project tokens live on the group, so the guide / badge use the project accent.
    const group = container.querySelector('[data-project-color]') as HTMLElement;
    expect(group.style.getPropertyValue('--project-accent')).toMatch(/^#[0-9a-f]{6}$/);
    expect(row.getAttribute('aria-label')).toContain('conversation.sidebar.project.count:3');
    expect(row.querySelector('svg, img')).not.toBeNull(); // the chevron only
    expect(row.querySelectorAll('span[aria-hidden="true"]:empty')).toHaveLength(0);
    fireEvent.click(row);
    expect(screen.getByTestId(`project-count-${WS}`).textContent).toBe('3');
  });

  it('marks its conversations as project children (compact rows) while the sidebar is open', () => {
    render(<Harness rows={2} />);
    expect(screen.getByTestId(`project-children-${WS}`).hasAttribute('data-project-children')).toBe(true);
  });

  it('shows running and "needs you" on the row, also while collapsed', () => {
    render(<Harness rows={2} running needsYou={2} initiallyExpanded={false} />);
    expect(projectRow().getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId(`project-running-${WS}`)).toBeInTheDocument();
    expect(screen.getByTestId(`project-needs-you-${WS}`).textContent).toBe('2');
    expect(projectRow().getAttribute('aria-label')).toContain('conversation.sidebar.project.needsYou:2');
    expect(screen.queryAllByTestId('row')).toHaveLength(0);
  });

  it('caps the needs-you badge at 99+', () => {
    render(<Harness rows={1} needsYou={120} />);
    expect(screen.getByTestId(`project-needs-you-${WS}`).textContent).toBe('99+');
  });

  it('shows an empty state with a start link for a project without conversations', () => {
    const onStart = vi.fn();
    render(<Harness rows={0} onStartConversation={onStart} />);
    const empty = screen.getByTestId(`project-empty-${WS}`);
    expect(empty.textContent).toContain('conversation.sidebar.project.empty');
    expect(empty.getAttribute('role')).toBe('treeitem');
    expect(empty.getAttribute('aria-level')).toBe('3');
    fireEvent.click(empty);
    fireEvent.keyDown(empty, { key: 'Enter' });
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it(`shows the ${PROJECT_VISIBLE_LIMIT} most recent conversations and "Show N more"`, () => {
    render(<Harness rows={PROJECT_VISIBLE_LIMIT + 3} />);
    expect(screen.getAllByTestId('row')).toHaveLength(PROJECT_VISIBLE_LIMIT);
    const more = screen.getByTestId(`project-show-more-${WS}`);
    expect(more.textContent).toBe('conversation.sidebar.project.showMore:3');
    expect(more.getAttribute('role')).toBe('treeitem');
    fireEvent.keyDown(more, { key: 'Enter' });
    expect(screen.getAllByTestId('row')).toHaveLength(PROJECT_VISIBLE_LIMIT + 3);
    expect(screen.getByTestId(`project-show-more-${WS}`).textContent).toBe('conversation.sidebar.project.showLess');
  });

  it('toggles with click, Enter, and the horizontal arrows', () => {
    render(<Harness rows={1} />);
    const row = projectRow();
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(row.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(row, { key: 'ArrowLeft' });
    expect(row.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(row, { key: 'ArrowRight' });
    expect(row.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders the actions slot without toggling the project, and opens the menu with Shift+F10', () => {
    const onBoard = vi.fn();
    const onMenu = vi.fn();
    render(
      <Harness
        rows={1}
        actions={
          <>
            <span role='button' tabIndex={-1} data-testid='board-button' onClick={onBoard}>
              Board
            </span>
            <span role='button' tabIndex={-1} data-project-menu-trigger='' onClick={onMenu}>
              menu
            </span>
          </>
        }
      />
    );
    fireEvent.click(screen.getByTestId('board-button'));
    expect(onBoard).toHaveBeenCalledTimes(1);
    expect(projectRow().getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(projectRow(), { key: 'F10', shiftKey: true });
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it('marks the active (current) project row', () => {
    render(<Harness rows={1} active />);
    expect(projectRow().getAttribute('data-active-project')).toBe('true');
  });

  it('renders only the rows (no header) when the sidebar is collapsed to icons', () => {
    render(<Harness rows={2} siderCollapsed initiallyExpanded={false} />);
    expect(screen.queryByTestId(`project-row-${WS}`)).toBeNull();
    expect(screen.getAllByTestId('row')).toHaveLength(2);
    // Icon-only rows keep their normal size.
    expect(screen.getByTestId(`project-children-${WS}`).hasAttribute('data-project-children')).toBe(false);
  });
});
