/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { treeArrowIntent, useRovingTree } from '@/renderer/hooks/ui/useRovingTree';

/** A small sidebar-shaped tree: a section, a project with two rows, a loose row. */
const Tree: React.FC<{ dir?: 'ltr' | 'rtl'; currentId?: string }> = ({ dir = 'ltr', currentId }) => {
  const ref = useRef<HTMLDivElement>(null);
  const { onKeyDown, onFocus } = useRovingTree(ref);
  const [projectOpen, setProjectOpen] = useState(true);
  const item = (key: string, level: number, extra: Record<string, unknown> = {}) => ({
    role: 'treeitem',
    tabIndex: -1,
    'data-tree-item': '',
    'data-tree-level': level,
    'data-tree-key': key,
    'data-testid': key,
    'aria-current': currentId === key ? ('page' as const) : undefined,
    ...extra,
  });
  return (
    <div dir={dir}>
      <div ref={ref} role='tree' onKeyDown={onKeyDown} onFocus={onFocus}>
        <div {...item('section', 1, { 'aria-expanded': true })}>Projects</div>
        <div
          {...item('project', 2, { 'aria-expanded': projectOpen })}
          onKeyDown={(event) => {
            const intent = treeArrowIntent(event);
            if ((intent === 'expand' && !projectOpen) || (intent === 'collapse' && projectOpen)) {
              event.preventDefault();
              setProjectOpen(!projectOpen);
            }
          }}
        >
          aionui
        </div>
        {projectOpen && (
          <div role='group'>
            <div {...item('row-1', 3)}>First</div>
            <div {...item('row-2', 3)}>Second</div>
          </div>
        )}
        <div {...item('loose', 2)}>Loose</div>
      </div>
    </div>
  );
};

const tabStops = () => screen.getAllByRole('treeitem').filter((el) => el.tabIndex === 0);

describe('sidebar tree keyboard navigation (roving tabindex)', () => {
  it('keeps exactly one item in the tab order, the current page first', () => {
    render(<Tree currentId='row-2' />);
    expect(tabStops().map((el) => el.dataset.testid)).toEqual(['row-2']);
  });

  it('moves with ↑/↓ and Home/End, carrying the tab stop along', () => {
    render(<Tree />);
    const section = screen.getByTestId('section');
    section.focus();
    fireEvent.keyDown(section, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('project'));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByTestId('loose'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByTestId('row-2'));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(section);
    expect(tabStops()).toEqual([section]);
  });

  it('← collapses an open project, → expands it, → again enters its first row, ← returns to the parent', () => {
    render(<Tree />);
    const project = screen.getByTestId('project');
    project.focus();
    fireEvent.keyDown(project, { key: 'ArrowLeft' });
    expect(project.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('row-1')).toBeNull();
    fireEvent.keyDown(project, { key: 'ArrowRight' });
    expect(project.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(project, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByTestId('row-1'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(project);
  });

  it('mirrors the horizontal arrows in RTL', () => {
    render(<Tree dir='rtl' />);
    const project = screen.getByTestId('project');
    project.focus();
    fireEvent.keyDown(project, { key: 'ArrowRight' }); // collapse in RTL
    expect(project.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(project, { key: 'ArrowLeft' }); // expand in RTL
    expect(project.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps a tab stop when the focused row disappears', () => {
    render(<Tree />);
    const project = screen.getByTestId('project');
    project.focus();
    fireEvent.keyDown(project, { key: 'ArrowRight' }); // into row-1
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' }); // back to project
    fireEvent.keyDown(project, { key: 'ArrowLeft' }); // collapse: rows unmount
    expect(tabStops()).toHaveLength(1);
  });
});
