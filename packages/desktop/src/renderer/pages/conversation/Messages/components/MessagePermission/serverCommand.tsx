/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The owner's OK for a crucial command on a server (C36, TASK-97 ask path).
 * Only the `aionui-servers-crucial` MCP asks; its `run_command` arguments carry
 * the server name and the command, nothing else. The card adds what the owner
 * needs to decide: which server (environment, tier) and why the command counts
 * as crucial — asked from core, never trusted from the agent.
 */

import { Tag } from '@arco-design/web-react';
import { Server } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import {
  SERVERS_CRUCIAL_MCP_NAME,
  SERVERS_RUN_TOOL,
  type ClassifyServerCommandResponse,
} from '@/common/types/platform/serverPools';

export type ServerCommandRequest = { server: string; command: string };

const CLAUDE_TOOL = `mcp__${SERVERS_CRUCIAL_MCP_NAME}__${SERVERS_RUN_TOOL}`;

/**
 * A `run_command` on the crucial servers MCP: claude titles the tool
 * `mcp__<server>__<tool>`; other ACP agents name the server in `server_name`.
 */
export const serverCommandOf = (
  title: string | undefined,
  rawInput: Record<string, unknown> | undefined
): ServerCommandRequest | null => {
  if (!rawInput) return null;
  const server = rawInput.server;
  const command = rawInput.command;
  if (typeof server !== 'string' || !server || typeof command !== 'string' || !command) return null;
  const byTitle = typeof title === 'string' && title.trim().startsWith(CLAUDE_TOOL);
  const byServerName = rawInput.server_name === SERVERS_CRUCIAL_MCP_NAME;
  return byTitle || byServerName ? { server, command } : null;
};

/** Server, environment, tier and the reason it asks, under the card's title. */
export const ServerCommandContext: React.FC<{ request: ServerCommandRequest }> = ({ request }) => {
  const { t } = useTranslation();
  const { data } = useSWR<ClassifyServerCommandResponse>(
    `servers.classify:${request.server}:${request.command}`,
    () => ipcBridge.servers.classify.invoke(request),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const reason = data
    ? data.crucial
      ? data.reason
        ? t('messages.serverApproval.reason', { reason: data.reason })
        : t('messages.serverApproval.crucial')
      : t('messages.serverApproval.declaredByAgent')
    : null;

  return (
    <div className='flex flex-col gap-4px' data-testid='server-approval-context'>
      <div className='flex flex-wrap items-center gap-6px'>
        <Server theme='outline' size='14' aria-hidden />
        <span className='text-13px font-medium text-t-primary'>{request.server}</span>
        {data?.environment ? (
          <Tag size='small' color={data.environment === 'production' ? 'red' : undefined}>
            {t(`mcp.market.environment.${data.environment}`, { defaultValue: data.environment })}
          </Tag>
        ) : null}
        {data?.tier ? <Tag size='small'>{t(`mcp.market.tier.${data.tier}`, { defaultValue: data.tier })}</Tag> : null}
      </div>
      {reason ? (
        <span className='text-12px text-t-secondary' data-testid='server-approval-reason'>
          {reason}
        </span>
      ) : null}
    </div>
  );
};
