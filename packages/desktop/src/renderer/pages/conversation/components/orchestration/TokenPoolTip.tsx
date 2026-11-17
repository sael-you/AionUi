/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Token Pool notices in the chat (TASK-137): the pool says in the affected
 * conversation when an account hit its limit and what it did, and — when it is
 * set to ask first — waits for the owner's answer. The tips arrive with a code
 * (`TOKEN_POOL_*`) and params; this builds the localized text (the English
 * `content` stays the fallback) and the three answer buttons.
 */

import { Button, Message } from '@arco-design/web-react';
import type { TFunction } from 'i18next';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { tokenPool, type TokenPoolChoice } from '@/common/adapter/ipcBridge';
import { formatDateTime } from '@/renderer/services/i18n/format';
import { isElectronDesktop } from '@/renderer/utils/platform';

const KEY = 'conversation.agentTip.tokenPool';

export const TOKEN_POOL_ASK = 'TOKEN_POOL_ASK';

type Params = Record<string, unknown> | undefined;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** "Claude account “work” hit its five hour limit (resets …)." from the structured reason, else the English one. */
const hitSentence = (params: Params, t: TFunction, language: string): string => {
  const base = { provider: text(params?.provider), from: text(params?.from) };
  switch (params?.reason_kind) {
    case 'revoked':
      return t(`${KEY}.hitRevoked`, base);
    case 'unknown':
      return t(`${KEY}.hitUnknown`, base);
    case 'limit': {
      const type = text(params.limit_type).replace(/[_-]/g, ' ');
      const limit = type ? t(`${KEY}.limitNamed`, { type }) : t(`${KEY}.limitUsage`);
      return typeof params.resets_at === 'number'
        ? t(`${KEY}.hitLimitResets`, {
            ...base,
            limit,
            time: formatDateTime(params.resets_at, language, { dateStyle: 'medium', timeStyle: 'short' }),
          })
        : t(`${KEY}.hitLimit`, { ...base, limit });
    }
    default:
      // An older Token Pool: only its English reason.
      return t(`${KEY}.hitLimit`, { ...base, limit: text(params?.reason) });
  }
};

/**
 * The localized body of a `TOKEN_POOL_*` tip, or null for any other code (and
 * for an unknown Token Pool code: the English content is shown).
 */
export const tokenPoolTipBody = (
  code: string | undefined,
  params: Params,
  t: TFunction,
  language: string
): string | null => {
  if (!code?.startsWith('TOKEN_POOL_')) return null;
  const to = text(params?.to);
  const provider = text(params?.provider);
  const hit = () => hitSentence(params, t, language);
  const after = () => [
    params?.restarted ? t(`${KEY}.restarted`) : params?.busy ? t(`${KEY}.busy`) : t(`${KEY}.next`),
    params?.resent ? t(`${KEY}.resent`) : t(`${KEY}.notResent`),
  ];
  switch (code) {
    case 'TOKEN_POOL_SWITCHED': {
      const how = params?.how === 'answer' || params?.how === 'timeout' ? params.how : 'auto';
      return [hit(), t(`${KEY}.switched.${how}`, { to }), ...after()].join(' ');
    }
    case 'TOKEN_POOL_RESTARTED':
      return [hit(), t(`${KEY}.alreadyOn`, { to }), ...after()].join(' ');
    case 'TOKEN_POOL_EXHAUSTED':
      return [hit(), t(`${KEY}.exhausted`)].join(' ');
    case 'TOKEN_POOL_SWITCHED_MANUAL':
      return t(`${KEY}.manual`, { provider, to });
    case TOKEN_POOL_ASK: {
      const minutes = typeof params?.timeout_minutes === 'number' ? params.timeout_minutes : 0;
      return [hit(), t(`${KEY}.ask`, { to }), minutes > 0 ? t(`${KEY}.askTimeout`, { count: minutes }) : '']
        .filter(Boolean)
        .join(' ');
    }
    case 'TOKEN_POOL_WAIT':
      return text(params?.from)
        ? t(`${KEY}.wait`, { provider, from: text(params?.from) })
        : t(`${KEY}.waitCurrent`, { provider });
    default:
      return null;
  }
};

const CHOICES: readonly TokenPoolChoice[] = ['switch_resend', 'switch', 'wait'];

type Outcome = { kind: 'chosen'; choice: TokenPoolChoice } | { kind: 'answered' } | { kind: 'notOpen' };

/**
 * Switch & re-send · Switch only · Wait, under a `TOKEN_POOL_ASK` tip. The
 * Token Pool answers 409 when the question was already answered (here, in
 * Settings → Token Pool, or by its timeout) and 404 when it is gone: the
 * buttons then give way to one line saying so.
 */
export const TokenPoolAskActions: React.FC<{ decisionId: string }> = ({ decisionId }) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<TokenPoolChoice | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // The Token Pool sits in front of the WebUI only.
  if (isElectronDesktop()) return null;

  const decide = async (choice: TokenPoolChoice) => {
    setBusy(choice);
    try {
      await tokenPool.decide.invoke({ decision_id: decisionId, choice });
      setOutcome({ kind: 'chosen', choice });
    } catch (error) {
      const status = isBackendHttpError(error) ? error.status : 0;
      if (status === 409) setOutcome({ kind: 'answered' });
      else if (status === 404) setOutcome({ kind: 'notOpen' });
      else Message.error(t(`${KEY}.actions.failed`));
    } finally {
      setBusy(null);
    }
  };

  if (outcome) {
    return (
      <div className='text-12px text-t-secondary' role='status' data-testid='token-pool-ask-outcome'>
        {outcome.kind === 'chosen' ? t(`${KEY}.actions.done.${outcome.choice}`) : t(`${KEY}.actions.${outcome.kind}`)}
      </div>
    );
  }

  return (
    <div
      className='flex flex-wrap gap-8px'
      role='group'
      aria-label={t(`${KEY}.actions.label`)}
      data-testid='token-pool-ask-actions'
    >
      {CHOICES.map((choice) => (
        <Button
          key={choice}
          size='small'
          type={choice === 'switch_resend' ? 'primary' : 'secondary'}
          loading={busy === choice}
          disabled={busy !== null}
          onClick={() => void decide(choice)}
          data-testid={`token-pool-ask-${choice}`}
        >
          {t(`${KEY}.actions.${choice}`)}
        </Button>
      ))}
    </div>
  );
};
