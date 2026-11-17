/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Message } from '@arco-design/web-react';
import type { TFunction } from 'i18next';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ decide: { invoke: vi.fn() } }));
const platform = vi.hoisted(() => ({ desktop: false }));
vi.mock('@/common/adapter/ipcBridge', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  tokenPool: api,
}));
vi.mock('@/common/adapter/httpBridge', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isBackendHttpError: (error: unknown) => typeof (error as { status?: unknown })?.status === 'number',
}));
vi.mock('@/renderer/hooks/context/ThemeContext', () => ({ useThemeContext: () => ({ theme: 'light' }) }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => platform.desktop }));
vi.mock('@/renderer/services/i18n/format', () => ({ formatDateTime: (at: number) => `at:${at}` }));
const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key}|${JSON.stringify(options)}` : key) as unknown as TFunction;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'en-US' } }) }));

import type { IMessageTips } from '@/common/chat/chatLib';
import MessageTips from '@/renderer/pages/conversation/Messages/components/MessageTips';
import {
  TokenPoolAskActions,
  tokenPoolTipBody,
} from '@/renderer/pages/conversation/components/orchestration/TokenPoolTip';

const KEY = 'conversation.agentTip.tokenPool';
const BASE = { provider: 'Claude', from: 'work', to: 'spare', reason: 'five hour limit' };
const body = (code: string, params: Record<string, unknown>) => tokenPoolTipBody(code, params, t, 'en-US');

describe('Token Pool chat tips (TASK-137)', () => {
  it('leaves other codes to the generic tip text', () => {
    expect(body('CLI_VERSION_OLDER', {})).toBeNull();
    expect(tokenPoolTipBody(undefined, undefined, t, 'en-US')).toBeNull();
    expect(body('TOKEN_POOL_FUTURE', BASE)).toBeNull();
  });

  it('says which limit was hit, with the reset time in the owner locale', () => {
    const text = body('TOKEN_POOL_EXHAUSTED', {
      ...BASE,
      reason_kind: 'limit',
      limit_type: 'five_hour',
      resets_at: 1_800_000_000_000,
    });
    expect(text).toContain(`${KEY}.hitLimitResets|`);
    expect(text).toContain(`"limit":"${KEY}.limitNamed|{\\"type\\":\\"five hour\\"}"`);
    expect(text).toContain('"time":"at:1800000000000"');
    expect(text).toContain(`${KEY}.exhausted`);
    expect(body('TOKEN_POOL_EXHAUSTED', { ...BASE, reason_kind: 'limit', limit_type: null })).toContain(
      `"limit":"${KEY}.limitUsage"`
    );
    expect(body('TOKEN_POOL_EXHAUSTED', { ...BASE, reason_kind: 'revoked' })).toContain(`${KEY}.hitRevoked|`);
    expect(body('TOKEN_POOL_EXHAUSTED', { ...BASE, reason_kind: 'unknown' })).toContain(`${KEY}.hitUnknown|`);
  });

  it('falls back to the English reason of an older Token Pool', () => {
    expect(body('TOKEN_POOL_EXHAUSTED', BASE)).toContain(`"limit":"five hour limit"`);
  });

  it('a switch says how it happened, whether the conversation restarted and whether the message was re-sent', () => {
    const auto = body('TOKEN_POOL_SWITCHED', { ...BASE, reason_kind: 'limit', restarted: true, resent: true });
    expect(auto).toContain(`${KEY}.switched.auto|{"to":"spare"}`);
    expect(auto).toContain(`${KEY}.restarted`);
    expect(auto).toContain(`${KEY}.resent`);
    const answered = body('TOKEN_POOL_SWITCHED', {
      ...BASE,
      how: 'answer',
      busy: true,
      restarted: false,
      resent: false,
    });
    expect(answered).toContain(`${KEY}.switched.answer|`);
    expect(answered).toContain(`${KEY}.busy`);
    expect(answered).toContain(`${KEY}.notResent`);
    expect(body('TOKEN_POOL_SWITCHED', { ...BASE, how: 'timeout' })).toContain(`${KEY}.switched.timeout|`);
    const already = body('TOKEN_POOL_RESTARTED', { ...BASE, restarted: false, busy: false, resent: false });
    expect(already).toContain(`${KEY}.alreadyOn|{"to":"spare"}`);
    expect(already).toContain(`${KEY}.next`);
  });

  it('words the manual switch, the question and the wait', () => {
    expect(body('TOKEN_POOL_SWITCHED_MANUAL', { provider: 'Codex', to: 'spare' })).toBe(
      `${KEY}.manual|{"provider":"Codex","to":"spare"}`
    );
    const ask = body('TOKEN_POOL_ASK', { ...BASE, decision_id: 'd1', timeout_minutes: 10 });
    expect(ask).toContain(`${KEY}.ask|{"to":"spare"}`);
    expect(ask).toContain(`${KEY}.askTimeout|{"count":10}`);
    expect(body('TOKEN_POOL_ASK', { ...BASE, decision_id: 'd1', timeout_minutes: 0 })).not.toContain('askTimeout');
    expect(body('TOKEN_POOL_WAIT', BASE)).toBe(`${KEY}.wait|{"provider":"Claude","from":"work"}`);
    expect(body('TOKEN_POOL_WAIT', { provider: 'Claude', from: null })).toBe(
      `${KEY}.waitCurrent|{"provider":"Claude"}`
    );
  });
});

describe('TokenPoolAskActions (TASK-137)', () => {
  beforeEach(() => {
    platform.desktop = false;
    vi.spyOn(Message, 'error').mockImplementation(() => ({}) as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sends each choice for that decision and then says what happens', async () => {
    api.decide.invoke.mockResolvedValue({});
    render(<TokenPoolAskActions decisionId='d 1' />);
    expect(screen.getByRole('group', { name: `${KEY}.actions.label` })).toBeInTheDocument();
    expect(screen.getByTestId('token-pool-ask-switch')).toBeInTheDocument();
    expect(screen.getByTestId('token-pool-ask-wait')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('token-pool-ask-switch_resend'));
    await waitFor(() =>
      expect(api.decide.invoke).toHaveBeenCalledWith({ decision_id: 'd 1', choice: 'switch_resend' })
    );
    expect(await screen.findByTestId('token-pool-ask-outcome')).toHaveTextContent(`${KEY}.actions.done.switch_resend`);
    expect(screen.queryByTestId('token-pool-ask-actions')).toBeNull();
  });

  it('409 hides the buttons as already answered; 404 as no longer open', async () => {
    api.decide.invoke.mockRejectedValueOnce({ status: 409 });
    const first = render(<TokenPoolAskActions decisionId='d1' />);
    fireEvent.click(screen.getByTestId('token-pool-ask-wait'));
    expect(await screen.findByTestId('token-pool-ask-outcome')).toHaveTextContent(`${KEY}.actions.answered`);
    first.unmount();
    api.decide.invoke.mockRejectedValueOnce({ status: 404 });
    render(<TokenPoolAskActions decisionId='d2' />);
    fireEvent.click(screen.getByTestId('token-pool-ask-switch'));
    expect(await screen.findByTestId('token-pool-ask-outcome')).toHaveTextContent(`${KEY}.actions.notOpen`);
    expect(Message.error).not.toHaveBeenCalled();
  });

  it('keeps the buttons and says so when the answer could not be sent', async () => {
    api.decide.invoke.mockRejectedValue(new Error('offline'));
    render(<TokenPoolAskActions decisionId='d1' />);
    fireEvent.click(screen.getByTestId('token-pool-ask-switch'));
    await waitFor(() => expect(Message.error).toHaveBeenCalledWith(`${KEY}.actions.failed`));
    expect(screen.getByTestId('token-pool-ask-actions')).toBeInTheDocument();
  });

  it('shows nothing on the desktop app (no Token Pool in front of it)', () => {
    platform.desktop = true;
    const { container } = render(<TokenPoolAskActions decisionId='d1' />);
    expect(container).toBeEmptyDOMElement();
  });

  it('the chat tip shows the localized question with the buttons; other Token Pool tips have none', () => {
    const tip = (code: string, params: Record<string, unknown>): IMessageTips =>
      ({
        id: code,
        msg_id: code,
        conversation_id: 'c1',
        type: 'tips',
        content: { content: 'English fallback', type: 'warning', code, params },
      }) as unknown as IMessageTips;
    const ask = render(<MessageTips message={tip('TOKEN_POOL_ASK', { ...BASE, decision_id: 'd1' })} />);
    expect(ask.container).toHaveTextContent(`${KEY}.ask|{"to":"spare"}`);
    expect(ask.container).not.toHaveTextContent('English fallback');
    expect(screen.getByTestId('token-pool-ask-actions')).toBeInTheDocument();
    ask.unmount();
    const switched = render(<MessageTips message={tip('TOKEN_POOL_SWITCHED', BASE)} />);
    expect(switched.container).toHaveTextContent(`${KEY}.switched.auto`);
    expect(screen.queryByTestId('token-pool-ask-actions')).toBeNull();
  });
});
