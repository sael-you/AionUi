/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The WebUI's in-app browser when the server browser is available (C30): a real
 * Chrome on the server, shown by CDP screencast and driven by the owner's mouse,
 * wheel, keyboard and paste. Tabs come from the server (agents' tabs included,
 * and followed live while an agent works); instance 1 is the one with the
 * owner's logins, others are separate profiles.
 */

import { Alert, Button, Input, Message, Modal, Spin, Tag, Tooltip } from '@arco-design/web-react';
import { Close, Left, Loading, Plus, Refresh, Right, Robot } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BrowserDevice, BrowserFrameMeta, BrowserState } from '@/common/types/platform/serverBrowser';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { resolveAddressBarInput } from '../constants';
import {
  errorKey,
  fitFrame,
  isGoogleSignInRejected,
  keyInputOf,
  modifiersOf,
  mouseButtonOf,
  toPagePoint,
} from './streamProtocol';
import BrowserScopeSelect from './BrowserScopeSelect';
import type { ServerBrowserProfile } from './useServerBrowserAvailability';
import { useServerBrowserStream, type FrameDecoder } from './useServerBrowserStream';

/** After the owner picks or opens a tab, the panel does not jump to the agent's tab for this long. */
const OWN_TAB_WINDOW_MS = 3000;
const RESIZE_DEBOUNCE_MS = 150;

/**
 * The tab to switch the panel to so the owner watches the agent live: the tab an
 * agent last acted on, while it is driving, unless the panel shows it already or
 * the owner just picked a tab themselves. `null` otherwise.
 */
export const agentTabToFollow = (
  state: Pick<BrowserState, 'tabs' | 'agent_active' | 'agent_tab_id'>,
  ownerPickedRecently: boolean
): string | null => {
  if (!state.agent_active || ownerPickedRecently || !state.agent_tab_id) return null;
  const tab = state.tabs.find((entry) => entry.id === state.agent_tab_id);
  return tab && !tab.active ? tab.id : null;
};

type ServerBrowserViewProps = {
  /** The owner's browser profiles (TASK-124); instance 1 "Main" always exists. */
  profiles: ServerBrowserProfile[];
  /** An address the preview tab asked for (opened from a link); opened in a new tab once. */
  requestedUrl?: string;
  /** Test seam: frame decoder. */
  decodeFrame?: FrameDecoder;
  /** The owner's own paired browsers (C34), offered in the same switcher. */
  devices?: BrowserDevice[];
  onSelectDevice?: (deviceId: string) => void;
  /** The profile to show first (the one shown before switching to a device). */
  initialInstance?: number;
  onInstanceChange?: (instance: number) => void;
};

const ServerBrowserView: React.FC<ServerBrowserViewProps> = ({
  profiles,
  requestedUrl,
  decodeFrame,
  devices = [],
  onSelectDevice,
  initialInstance = 1,
  onInstanceChange,
}) => {
  const { t } = useTranslation();
  const isMobile = useLayoutContext()?.isMobile ?? false;
  const [instance, setInstanceState] = useState(initialInstance);
  const setInstance = useCallback(
    (next: number) => {
      setInstanceState(next);
      onInstanceChange?.(next);
    },
    [onInstanceChange]
  );
  // The profile on screen was deleted (Settings → Browser): go back to the first one ("Main").
  useEffect(() => {
    if (profiles.length > 0 && !profiles.some((profile) => profile.instance === instance)) {
      setInstance(profiles[0]?.instance ?? 1);
    }
  }, [profiles, instance]);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const metaRef = useRef<BrowserFrameMeta | null>(null);
  const panelTabAtRef = useRef(0);
  const openedUrlRef = useRef<string | null>(null);
  const [address, setAddress] = useState('');
  const [editingAddress, setEditingAddress] = useState(false);
  const [mobileText, setMobileText] = useState('');
  const [promptText, setPromptText] = useState('');

  const draw = useCallback((image: ImageBitmap | HTMLImageElement, meta: BrowserFrameMeta) => {
    metaRef.current = meta;
    const canvas = canvasRef.current;
    const surface = surfaceRef.current;
    if (!canvas || !surface) return;
    const ratio = window.devicePixelRatio || 1;
    const { clientWidth: width, clientHeight: height } = surface;
    if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
    if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d');
    if (!context) return;
    const drawn = fitFrame({ width, height }, meta);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, drawn.left * ratio, drawn.top * ratio, drawn.width * ratio, drawn.height * ratio);
  }, []);

  const stream = useServerBrowserStream(instance, draw, decodeFrame);
  const { state, send } = stream;
  const activeTab = state?.tabs.find((tab) => tab.active) ?? null;

  // Follow the tab an agent acts on, live (the owner watches the agent work).
  useEffect(() => {
    if (!state) return;
    const follow = agentTabToFollow(state, Date.now() - panelTabAtRef.current < OWN_TAB_WINDOW_MS);
    if (follow) send({ type: 'tab_select', id: follow });
  }, [state, send]);

  useEffect(() => {
    if (!editingAddress) setAddress(activeTab?.url === 'about:blank' ? '' : (activeTab?.url ?? ''));
  }, [activeTab?.url, editingAddress]);

  // An address opened from a link (preview tab content) becomes a new server tab, once.
  useEffect(() => {
    if (!requestedUrl || requestedUrl === 'about:blank' || stream.connection !== 'open') return;
    if (openedUrlRef.current === requestedUrl) return;
    openedUrlRef.current = requestedUrl;
    panelTabAtRef.current = Date.now();
    send({ type: 'tab_new', url: requestedUrl });
  }, [requestedUrl, stream.connection, send]);

  // Tell the server the panel size (debounced), and again after every reconnect.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || stream.connection !== 'open') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const report = () => {
      const width = Math.round(surface.clientWidth);
      const height = Math.round(surface.clientHeight);
      if (width > 0 && height > 0) {
        send({ type: 'resize', width, height, device_scale_factor: window.devicePixelRatio || 1 });
      }
    };
    report();
    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(report, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(surface);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, [stream.connection, send, instance]);

  useEffect(() => {
    const code = stream.lastError?.code;
    if (!code) return;
    Message.warning(t(`preview.serverBrowser.errors.${errorKey(code)}`));
    stream.clearError();
  }, [stream.lastError, stream.clearError, t]);

  useEffect(() => {
    if (!stream.fileChooser) return;
    Message.info(t('preview.serverBrowser.fileUploadUnsupported'));
    stream.clearFileChooser();
  }, [stream.fileChooser, stream.clearFileChooser, t]);

  const pointer = (event: React.MouseEvent) => {
    const surface = surfaceRef.current;
    const meta = metaRef.current;
    if (!surface || !meta) return null;
    const rect = surface.getBoundingClientRect();
    return toPagePoint(event.clientX, event.clientY, rect, meta);
  };

  const sendMouse = (event: React.MouseEvent, kind: 'move' | 'down' | 'up') => {
    const point = pointer(event);
    if (!point) return;
    send({
      type: 'mouse',
      event: kind,
      x: point.x,
      y: point.y,
      button: kind === 'move' ? 'none' : mouseButtonOf(event.button),
      click_count: kind === 'move' ? 0 : Math.max(1, event.detail),
      modifiers: modifiersOf(event),
    });
  };

  // Wheel needs a non-passive listener so the panel itself does not scroll.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const meta = metaRef.current;
      const point = meta ? toPagePoint(event.clientX, event.clientY, surface.getBoundingClientRect(), meta) : null;
      if (!point) return;
      send({
        type: 'mouse',
        event: 'wheel',
        x: point.x,
        y: point.y,
        button: 'none',
        click_count: 0,
        modifiers: modifiersOf(event),
        delta_x: event.deltaX,
        delta_y: event.deltaY,
      });
    };
    surface.addEventListener('wheel', onWheel, { passive: false });
    return () => surface.removeEventListener('wheel', onWheel);
  }, [send]);

  const onKey = (event: React.KeyboardEvent, kind: 'down' | 'up') => {
    // Let the browser fire `paste` for Ctrl/Cmd+V; it arrives as insert_text.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return;
    event.preventDefault();
    send({ type: 'key', ...keyInputOf(event, kind) });
  };

  const navigate = () => {
    const resolved = resolveAddressBarInput(address);
    setEditingAddress(false);
    if (resolved) send({ type: 'navigate', url: resolved });
  };

  const newTab = () => {
    panelTabAtRef.current = Date.now();
    send({ type: 'tab_new' });
  };

  const sendMobileText = () => {
    if (mobileText) send({ type: 'insert_text', text: mobileText });
    setMobileText('');
  };

  const status = state?.status ?? (stream.connection === 'open' ? 'starting' : 'stopped');
  const tabLimitReached = Boolean(state && state.tabs.length >= state.max_tabs);
  const googleRejected = Boolean(activeTab && isGoogleSignInRejected(activeTab.url));

  return (
    <div className='flex flex-col h-full min-h-0 bg-1' data-testid='server-browser'>
      <div className='flex items-center gap-6px h-40px px-10px bg-2 border-b border-3 flex-shrink-0'>
        <Button
          size='small'
          icon={<Left theme='outline' size={16} className='rtl:rotate-180' />}
          disabled={!state?.can_go_back}
          onClick={() => send({ type: 'back' })}
          aria-label={t('common.historyBack')}
          title={t('common.historyBack')}
        />
        <Button
          size='small'
          icon={<Right theme='outline' size={16} className='rtl:rotate-180' />}
          disabled={!state?.can_go_forward}
          onClick={() => send({ type: 'forward' })}
          aria-label={t('common.forward')}
          title={t('common.forward')}
        />
        <Button
          size='small'
          icon={
            activeTab?.loading ? (
              <Loading theme='outline' size={16} className='animate-spin' />
            ) : (
              <Refresh theme='outline' size={16} />
            )
          }
          onClick={() => send({ type: activeTab?.loading ? 'stop' : 'reload' })}
          aria-label={t('common.refresh')}
          title={t('common.refresh')}
        />
        <Input
          size='small'
          className='flex-1 min-w-0'
          value={address}
          placeholder={t('preview.browser.addressPlaceholder')}
          aria-label={t('preview.browser.addressLabel')}
          onFocus={(event) => {
            setEditingAddress(true);
            event.target.select();
          }}
          onBlur={() => setEditingAddress(false)}
          onChange={(value) => setAddress(value)}
          onPressEnter={navigate}
          data-testid='server-browser-address'
        />
        {state?.agent_active ? (
          <Tooltip content={t('preview.browser.agentActiveTooltip')}>
            <Tag
              size='small'
              color='arcoblue'
              icon={<Robot theme='outline' size={12} />}
              data-testid='server-browser-agent'
            >
              {t('preview.serverBrowser.agentDriving')}
            </Tag>
          </Tooltip>
        ) : null}
        <BrowserScopeSelect
          profiles={profiles}
          devices={devices}
          value={{ kind: 'profile', instance }}
          onChange={(scope) =>
            scope.kind === 'device' ? onSelectDevice?.(scope.deviceId) : setInstance(scope.instance)
          }
        />
      </div>

      <div
        role='tablist'
        aria-label={t('preview.serverBrowser.tabsLabel')}
        className='flex items-center gap-4px px-8px py-4px bg-2 border-b border-3 overflow-x-auto flex-shrink-0'
      >
        {(state?.tabs ?? []).map((tab) => (
          <span
            key={tab.id}
            className={`inline-flex items-center max-w-180px rd-6px ${tab.active ? 'bg-fill-3' : ''}`}
            data-testid='server-browser-tab'
          >
            <Button
              size='mini'
              type='text'
              role='tab'
              aria-selected={tab.active}
              className='truncate !max-w-150px'
              title={tab.url}
              onClick={() => {
                panelTabAtRef.current = Date.now();
                send({ type: 'tab_select', id: tab.id });
              }}
            >
              {tab.title || tab.url || t('preview.browser.newTab')}
            </Button>
            <Button
              size='mini'
              type='text'
              icon={<Close theme='outline' size={10} />}
              aria-label={t('preview.serverBrowser.closeTab', { title: tab.title || tab.url })}
              onClick={() => send({ type: 'tab_close', id: tab.id })}
            />
          </span>
        ))}
        <Button
          size='mini'
          type='text'
          icon={<Plus theme='outline' size={12} />}
          disabled={tabLimitReached}
          aria-label={t('preview.browser.newTab')}
          title={tabLimitReached ? t('preview.serverBrowser.errors.tabLimit') : t('preview.browser.newTab')}
          onClick={newTab}
        />
      </div>

      {googleRejected ? (
        <Alert className='flex-shrink-0' type='warning' content={t('preview.serverBrowser.googleRejected')} />
      ) : null}

      <div
        ref={surfaceRef}
        role='application'
        tabIndex={0}
        aria-label={t('preview.serverBrowser.surfaceLabel')}
        aria-roledescription={t('preview.serverBrowser.surfaceRole')}
        className='relative flex-1 min-h-0 outline-none focus-visible:ring-2 focus-visible:ring-primary-6 cursor-default'
        onMouseDown={(event) => {
          surfaceRef.current?.focus();
          sendMouse(event, 'down');
        }}
        onMouseUp={(event) => sendMouse(event, 'up')}
        onMouseMove={(event) => sendMouse(event, 'move')}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => onKey(event, 'down')}
        onKeyUp={(event) => onKey(event, 'up')}
        onPaste={(event) => {
          const text = event.clipboardData.getData('text/plain');
          if (text) send({ type: 'insert_text', text });
          event.preventDefault();
        }}
        data-testid='server-browser-surface'
      >
        <canvas ref={canvasRef} className='absolute inset-0 w-full h-full' aria-hidden />
        {status !== 'running' ? (
          <div className='absolute inset-0 flex flex-col items-center justify-center gap-10px bg-1' role='status'>
            {status === 'starting' ? <Spin /> : null}
            <span className='text-13px text-t-secondary'>
              {state?.error_code
                ? t(`preview.serverBrowser.errors.${errorKey(state.error_code)}`)
                : t(`preview.serverBrowser.status.${status}`)}
            </span>
            {status === 'stopped' || status === 'error' ? (
              <Button type='primary' size='small' onClick={() => send({ type: 'start' })}>
                {t('preview.serverBrowser.start')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {isMobile ? (
        <div className='flex items-center gap-6px px-8px py-6px bg-2 border-t border-3 flex-shrink-0'>
          <Input
            size='small'
            className='flex-1 min-w-0'
            value={mobileText}
            placeholder={t('preview.serverBrowser.typePlaceholder')}
            aria-label={t('preview.serverBrowser.typeLabel')}
            onChange={setMobileText}
            onPressEnter={sendMobileText}
          />
          <Button size='small' className='min-h-44px' onClick={sendMobileText}>
            {t('preview.serverBrowser.typeSend')}
          </Button>
          <Button
            size='small'
            className='min-h-44px'
            onClick={() =>
              send({ type: 'key', event: 'down', key: 'Enter', code: 'Enter', key_code: 13, modifiers: 0, text: '\r' })
            }
          >
            {t('preview.serverBrowser.typeEnter')}
          </Button>
        </div>
      ) : null}

      <Modal
        visible={stream.dialog !== null}
        title={t('preview.serverBrowser.dialogTitle')}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        hideCancel={stream.dialog?.kind === 'alert'}
        onOk={() => {
          if (stream.dialog) {
            send({
              type: 'dialog_reply',
              tab_id: stream.dialog.tab_id,
              accept: true,
              ...(stream.dialog.kind === 'prompt' ? { prompt_text: promptText } : {}),
            });
          }
          stream.clearDialog();
        }}
        onCancel={() => {
          if (stream.dialog) send({ type: 'dialog_reply', tab_id: stream.dialog.tab_id, accept: false });
          stream.clearDialog();
        }}
        afterOpen={() => setPromptText(stream.dialog?.default_prompt ?? '')}
      >
        <p className='m-0 mb-8px text-13px text-t-primary whitespace-pre-wrap break-words'>{stream.dialog?.message}</p>
        {stream.dialog?.kind === 'prompt' ? (
          <Input value={promptText} onChange={setPromptText} aria-label={t('preview.serverBrowser.dialogPrompt')} />
        ) : null}
      </Modal>
    </div>
  );
};

export default ServerBrowserView;
