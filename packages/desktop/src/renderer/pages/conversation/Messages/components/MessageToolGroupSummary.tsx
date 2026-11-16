import type { BadgeProps } from '@arco-design/web-react';
import { Badge, Button, Message, Spin, Tag, Tooltip } from '@arco-design/web-react';
import { IconDown, IconRight } from '@arco-design/web-react/icon';
import { Checklist, Download, Right } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { getAcpImageFileName } from '@/common/chat/acpToolCallOutput';
import { backgroundRefused, isBackgroundToolSupported } from '@/common/chat/backgroundTool';
import type { NormalizedToolCall, NormalizedToolStatus, ToolMessage } from '@/common/chat/normalizeToolCall';
import { normalizeToolMessages, hasRunningToolMessages } from '@/common/chat/normalizeToolCall';
import LocalImageView from '@/renderer/components/media/LocalImageView';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { downloadFileFromPath } from '@/renderer/utils/file/download';
import { useMessageList } from '../hooks';
import './MessageToolGroupSummary.css';

const statusToBadge = (status: NormalizedToolStatus): BadgeProps['status'] => {
  switch (status) {
    case 'completed':
      return 'success';
    case 'error':
      return 'error';
    case 'running':
      return 'processing';
    case 'canceled':
      return 'default';
    case 'pending':
    default:
      return 'default';
  }
};

/** Calls already sent to the background in this page session (`conversation:call`). */
const requestedCalls = new Set<string>();

/** Test seam: forget the requested calls. */
export const resetBackgroundRequests = (): void => requestedCalls.clear();

/**
 * "Continue in background" for a RUNNING tool call (TASK-8): the agent's turn
 * goes on while the command keeps running; the card stays running until the
 * task's own notification settles it. Shown only where the backend supports
 * it and nothing refused it yet; afterwards a "running in background" tag.
 */
export const BackgroundToolButton: React.FC<{ callId: string; status: string }> = ({ callId, status }) => {
  const { t } = useTranslation();
  const conversation = useConversationContextSafe();
  const messages = useMessageList();
  const key = `${conversation?.conversation_id ?? ''}:${callId}`;
  const [requested, setRequested] = useState(() => requestedCalls.has(key));
  const [sending, setSending] = useState(false);

  if (!conversation || status !== 'running') return null;
  if (!isBackgroundToolSupported({ type: conversation.type, backend: conversation.backend })) return null;
  if (requested) {
    return (
      <Tag size='small' color='arcoblue' className='flex-shrink-0'>
        {t('conversation.backgroundTool.running')}
      </Tag>
    );
  }
  if (backgroundRefused(messages, callId)) return null;

  const send = async () => {
    setSending(true);
    try {
      await ipcBridge.conversation.backgroundToolCall.invoke({
        conversation_id: conversation.conversation_id,
        call_id: callId,
      });
      requestedCalls.add(key);
      setRequested(true);
    } catch {
      Message.error(t('conversation.backgroundTool.failed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Button
      size='mini'
      type='text'
      className='flex-shrink-0'
      loading={sending}
      onClick={(event) => {
        event.stopPropagation();
        void send();
      }}
    >
      {t('conversation.backgroundTool.continue')}
    </Button>
  );
};

/**
 * One step with its expandable input / output. `leading` replaces the status
 * badge (the C21 activity timeline draws its own rail marker and icon) and
 * `trailing` adds a right-aligned slot (e.g. the step's duration).
 */
export const ToolItemDetail: React.FC<{
  item: NormalizedToolCall;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  monoDescription?: boolean;
}> = ({ item, leading, trailing, monoDescription }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [fullItem, setFullItem] = useState<NormalizedToolCall | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const displayItem = fullItem ?? item;
  const hasDetail = displayItem.input || displayItem.output || item.truncated || item.imagePath;
  const [messageApi, messageContext] = Message.useMessage();
  const handleDownloadImage = useCallback(
    async (path: string) => {
      try {
        await downloadFileFromPath(path, getAcpImageFileName(path));
        messageApi.success(t('acp.image.download_success'));
      } catch (error) {
        console.error('[MessageToolGroupSummary] Failed to download image:', error);
        messageApi.error(t('acp.image.download_error'));
      }
    },
    [messageApi, t]
  );

  const loadFullItem = async () => {
    if (!item.truncated || fullItem || loadingFull || !item.conversationId || !item.messageId) return;
    setLoadingFull(true);
    setLoadError(false);
    try {
      const message = await ipcBridge.database.getConversationMessage.invoke({
        conversation_id: item.conversationId,
        message_id: item.messageId,
      });
      const next = normalizeToolMessages([message as ToolMessage]).find((candidate) => candidate.key === item.key);
      if (next) setFullItem(next);
    } catch {
      setLoadError(true);
    } finally {
      setLoadingFull(false);
    }
  };

  const toggleExpanded = () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded) void loadFullItem();
  };

  return (
    <div className='flex flex-col'>
      {messageContext}
      <div className={`flex flex-row items-center ${leading ? 'gap-8px text-t-secondary' : 'color-#86909C gap-12px'}`}>
        {leading ?? (
          <Badge status={statusToBadge(item.status)} className={item.status === 'running' ? 'badge-breathing' : ''} />
        )}
        <span
          className={
            'flex-1 min-w-0' +
            (expanded ? ' break-all' : ' truncate') +
            (hasDetail ? ' cursor-pointer hover:color-#4E5969' : '')
          }
          onClick={hasDetail ? toggleExpanded : undefined}
        >
          <span className='font-medium text-13px'>{displayItem.name}</span>
          {displayItem.description && displayItem.description !== displayItem.name && (
            <span className={monoDescription ? 'm-l-6px text-12px font-mono' : 'm-l-4px opacity-80 text-13px'}>
              {displayItem.description}
            </span>
          )}
        </span>
        <BackgroundToolButton callId={item.key} status={item.status} />
        {trailing}
        {hasDetail && (
          <span className='flex-shrink-0 cursor-pointer hover:color-#4E5969 transition-colors' onClick={toggleExpanded}>
            {expanded ? <IconDown style={{ fontSize: 12 }} /> : <IconRight style={{ fontSize: 12 }} />}
          </span>
        )}
      </div>
      {expanded && hasDetail && (
        <div className='tool-detail-panel m-l-20px m-t-4px'>
          {loadingFull && <div className='tool-detail-label'>Loading...</div>}
          {loadError && <div className='tool-detail-label'>Failed to load full output</div>}
          {displayItem.input && (
            <div className='tool-detail-section'>
              <div className='tool-detail-label'>Input</div>
              <pre className='tool-detail-content'>{displayItem.input}</pre>
            </div>
          )}
          {displayItem.output && (
            <div className='tool-detail-section'>
              <div className='tool-detail-label'>Output</div>
              <pre className='tool-detail-content'>{displayItem.output}</pre>
            </div>
          )}
        </div>
      )}
      {item.imagePath && (
        <div className='group relative m-l-20px m-t-8px overflow-hidden rounded border bg-1 p-2 max-w-280px'>
          <LocalImageView
            src={item.imagePath}
            alt={getAcpImageFileName(item.imagePath)}
            className='max-w-full max-h-320px object-contain rounded'
          />
          <Tooltip content={t('acp.image.download')}>
            <Button
              aria-label={t('acp.image.download_aria')}
              className='!absolute end-10px top-10px !h-28px !w-28px !p-0 opacity-0 shadow-sm transition-opacity group-hover:opacity-90 focus:opacity-100'
              type='secondary'
              size='mini'
              shape='circle'
              icon={<Download theme='outline' size='14' />}
              onClick={() => void handleDownloadImage(item.imagePath)}
            />
          </Tooltip>
        </div>
      )}
    </div>
  );
};

const MessageToolGroupSummary: React.FC<{ messages: ToolMessage[] }> = ({ messages }) => {
  const { t } = useTranslation();
  const hasRunning = hasRunningToolMessages(messages);
  const [showMore, setShowMore] = useState(hasRunning);

  useEffect(() => {
    if (hasRunning) setShowMore(true);
  }, [hasRunning]);

  const tools = useMemo(() => normalizeToolMessages(messages), [messages]);

  return (
    <div className='tool-group-summary'>
      <div className='tool-group-summary__header' onClick={() => setShowMore(!showMore)}>
        <span className='tool-group-summary__icon'>
          {hasRunning ? <Spin size={12} /> : <Checklist theme='outline' size='14' />}
        </span>
        <span className='tool-group-summary__label'>
          {tools.length > 0
            ? t('conversation.orchestration.activity.viewStepsCount', { count: tools.length })
            : t('conversation.orchestration.activity.viewSteps')}
        </span>
        <span className={`tool-group-summary__arrow${showMore ? ' tool-group-summary__arrow--open' : ''}`}>
          <Right theme='outline' size='12' />
        </span>
      </div>
      {showMore && (
        <div className='tool-group-summary__body'>
          {tools.map((item) => (
            <ToolItemDetail key={item.key} item={item} />
          ))}
        </div>
      )}
    </div>
  );
};

export default React.memo(MessageToolGroupSummary);
