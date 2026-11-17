/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Message } from '@arco-design/web-react';
import React from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';

const api = vi.hoisted(() => ({
  restartResume: { invoke: vi.fn() },
  setAutoContinue: { invoke: vi.fn() },
}));
vi.mock('@/common', () => ({ ipcBridge: { conversation: api } }));
vi.mock('@/common/adapter/httpBridge', () => ({
  isBackendHttpError: (error: unknown) => typeof (error as { status?: unknown })?.status === 'number',
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}|${JSON.stringify(options)}` : key),
  }),
}));

import NeedsYouBox from '@/renderer/pages/conversation/GroupedHistory/components/NeedsYouBox';
import {
  AutoContinueButton,
  AutoContinueSwitch,
  RestartInterruptedNotice,
  restartDetail,
} from '@/renderer/pages/conversation/components/orchestration/RestartResume';
import {
  isRestartWaiting,
  readAutoContinue,
  readRestartInterrupted,
} from '@/renderer/pages/conversation/components/orchestration/runState';

const KEY = 'conversation.orchestration.restart';
const WAITING = {
  at: 1_700_000_000_000,
  kind: 'tool',
  tool: 'Bash',
  summary: 'bun run build',
  state: 'waiting',
  repeat: 0,
};

const conversationWith = (extra: Record<string, unknown>): TChatConversation =>
  ({ id: 'c1', name: 'Deploy check', type: 'acp', extra }) as unknown as TChatConversation;

const renderNotice = (extra: Record<string, unknown>) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), fallback: { 'conversation/c1': conversationWith(extra) } }}>
      <RestartInterruptedNotice conversationId='c1' />
    </SWRConfig>
  );

describe('turns interrupted by a restart (TASK-44)', () => {
  beforeEach(() => {
    vi.spyOn(Message, 'success').mockImplementation(() => ({}) as never);
    vi.spyOn(Message, 'error').mockImplementation(() => ({}) as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reads the marker and the switch from extra, ignoring malformed values', () => {
    expect(readRestartInterrupted({ restart_interrupted: WAITING })).toEqual(WAITING);
    expect(readRestartInterrupted({ restart_interrupted: { at: 1, kind: 'text', state: 'waiting' } })).toEqual({
      at: 1,
      kind: 'text',
      state: 'waiting',
      repeat: 0,
    });
    expect(readRestartInterrupted({ restart_interrupted: { ...WAITING, state: 'nope' } })).toBeUndefined();
    expect(readRestartInterrupted({ restart_interrupted: 'x' })).toBeUndefined();
    expect(readRestartInterrupted(undefined)).toBeUndefined();
    expect(isRestartWaiting({ restart_interrupted: WAITING })).toBe(true);
    expect(isRestartWaiting({ restart_interrupted: { ...WAITING, state: 'continued' } })).toBe(false);
    expect(readAutoContinue({})).toBe(false);
    expect(readAutoContinue({ auto_continue_after_restart: true })).toBe(true);
  });

  it('words the interrupted step by kind', () => {
    expect(restartDetail({ at: 1, kind: 'text', state: 'waiting', repeat: 0 })).toEqual({ key: `${KEY}.kind.text` });
    expect(restartDetail({ at: 1, kind: 'approval', state: 'waiting', repeat: 0 }).key).toBe(`${KEY}.kind.approval`);
    expect(restartDetail({ at: 1, kind: 'approval', tool: 'Write', state: 'waiting', repeat: 0 })).toEqual({
      key: `${KEY}.kind.approvalNamed`,
      tool: 'Write',
    });
    expect(restartDetail({ at: 1, kind: 'tool', state: 'waiting', repeat: 0 }).key).toBe(`${KEY}.kind.tool`);
  });

  it('shows the row with what was running and continues once', async () => {
    api.restartResume.invoke.mockResolvedValue({ restart_interrupted: { ...WAITING, state: 'continued' } });
    renderNotice({ restart_interrupted: WAITING });
    const row = screen.getByTestId('restart-interrupted');
    expect(row.textContent).toContain(`${KEY}.title`);
    expect(row.textContent).toContain(`${KEY}.kind.toolNamed|{"tool":"Bash"}`);
    expect(row.textContent).toContain('bun run build');
    expect(screen.queryByTestId('restart-auto-blocked')).toBeNull();
    fireEvent.click(screen.getByTestId('restart-continue'));
    await waitFor(() =>
      expect(api.restartResume.invoke).toHaveBeenCalledWith({ conversation_id: 'c1', action: 'continue' })
    );
    expect(api.restartResume.invoke).toHaveBeenCalledTimes(1);
    expect(Message.error).not.toHaveBeenCalled();
  });

  it('dismisses, and says so when it was already handled elsewhere', async () => {
    api.restartResume.invoke.mockRejectedValue({ status: 400 });
    renderNotice({ restart_interrupted: WAITING });
    fireEvent.click(screen.getByTestId('restart-dismiss'));
    await waitFor(() =>
      expect(api.restartResume.invoke).toHaveBeenCalledWith({ conversation_id: 'c1', action: 'dismiss' })
    );
    await waitFor(() => expect(Message.error).toHaveBeenCalledWith(`${KEY}.alreadyHandled`));
  });

  it('says why it did not continue by itself', () => {
    renderNotice({ restart_interrupted: { ...WAITING, auto_blocked: 'sensitive' }, auto_continue_after_restart: true });
    expect(screen.getByTestId('restart-auto-blocked').textContent).toBe(`${KEY}.blocked.sensitive`);
    expect(screen.getByTestId('restart-auto-continue-switch').getAttribute('aria-checked')).toBe('true');
  });

  it('shows only a hint after an automatic continue, and nothing once handled', () => {
    const { unmount } = renderNotice({ restart_interrupted: { ...WAITING, state: 'auto_continued' } });
    expect(screen.getByTestId('restart-auto-continued').textContent).toBe(`${KEY}.autoContinued`);
    expect(screen.queryByTestId('restart-continue')).toBeNull();
    unmount();
    for (const state of ['continued', 'dismissed']) {
      const view = renderNotice({ restart_interrupted: { ...WAITING, state } });
      expect(view.container.textContent).toBe('');
      view.unmount();
    }
    expect(renderNotice({}).container.textContent).toBe('');
  });

  it('the switch is off by default, explains itself and saves', async () => {
    api.setAutoContinue.invoke.mockResolvedValue({ enabled: true });
    render(<AutoContinueSwitch conversationId='c1' enabled={false} />);
    expect(screen.getByTestId('restart-auto-continue').textContent).toContain(`${KEY}.auto.desc`);
    const toggle = screen.getByTestId('restart-auto-continue-switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(api.setAutoContinue.invoke).toHaveBeenCalledWith({ conversation_id: 'c1', enabled: true })
    );
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    expect(Message.success).toHaveBeenCalledWith(`${KEY}.auto.on`);
  });

  it('keeps the switch as it was when saving fails', async () => {
    api.setAutoContinue.invoke.mockRejectedValue(new Error('offline'));
    render(<AutoContinueSwitch conversationId='c1' enabled={false} />);
    const toggle = screen.getByTestId('restart-auto-continue-switch');
    fireEvent.click(toggle);
    await waitFor(() => expect(Message.error).toHaveBeenCalledWith(`${KEY}.auto.failed`));
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('the header button reflects the switch', () => {
    const { rerender } = render(<AutoContinueButton conversation={conversationWith({})} />);
    expect(screen.getByTestId('restart-auto-continue-button').getAttribute('aria-pressed')).toBe('false');
    rerender(<AutoContinueButton conversation={conversationWith({ auto_continue_after_restart: true })} />);
    expect(screen.getByTestId('restart-auto-continue-button').getAttribute('aria-pressed')).toBe('true');
  });

  it('Needs you names the restart as the reason', () => {
    const conversation = conversationWith({ restart_interrupted: WAITING });
    render(
      <NeedsYouBox
        items={[{ conversation, state: 'waiting', where: 'aionui', restartInterrupted: true }]}
        runningCount={0}
        onOpen={() => undefined}
      />
    );
    expect(screen.getByTestId('sidebar-needs-you-c1').getAttribute('aria-label')).toBe(
      `Deploy check, ${KEY}.title, aionui`
    );
  });
});
