/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@arco-design/web-react';
import { Left, Right, Refresh, Loading, LinkOut, Microphone, Close } from '@icon-park/react';
import type { WebviewHostProps } from './WebviewHost';
import {
  BLANK_URL,
  decideEmbed,
  iframeAllowFor,
  isAppOriginFrame,
  isDevServerUrl,
  labelForUrl,
  resolveDefaultUrlInput,
  sandboxFor,
} from './iframeHostPolicy';

const HINT_DISMISSED_KEY = 'aionui.iframeHost.hintDismissed';

const readHintDismissed = (): boolean => {
  try {
    return window.sessionStorage.getItem(HINT_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * Web (non-Electron) browser host: renders pages in a sandboxed <iframe>.
 *
 * Limits compared with the desktop <webview>, stated in the dismissible hint:
 * - pages are cross-origin, so in-page navigation, redirects, titles and favicons can't be read;
 *   the address bar shows the last address opened here and is marked when the page navigated;
 * - there is no isolated browser session (the desktop `partition`): sites that need sign-in work
 *   best in a new tab;
 * - sites that refuse embedding show the browser's own "refused to connect" page;
 * - agents can't drive it (no CDP on the web); they keep using the Playwright CLI.
 * Security rules live in `iframeHostPolicy.ts`.
 */
const IframeHost: React.FC<WebviewHostProps> = ({
  url,
  showNavBar = false,
  className,
  style,
  onDidFinishLoad,
  onUrlChange,
  onTitleChange,
  onFaviconChange,
  resolveUrlInput,
}) => {
  const { t } = useTranslation();
  const appOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const appHostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const initialUrl = url || BLANK_URL;

  const [history, setHistory] = useState<string[]>([initialUrl]);
  const [index, setIndex] = useState(0);
  const [inputUrl, setInputUrl] = useState(initialUrl === BLANK_URL ? '' : initialUrl);
  const [isLoading, setIsLoading] = useState(decideEmbed(initialUrl, appOrigin).kind === 'embed');
  const [reloadKey, setReloadKey] = useState(0);
  const [devicesOptIn, setDevicesOptIn] = useState(false);
  const [navigatedAway, setNavigatedAway] = useState(false);
  const [landedOnApp, setLandedOnApp] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(readHintDismissed);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const loadCount = useRef(0);
  const lastPropUrl = useRef(initialUrl);

  const currentUrl = history[index] ?? BLANK_URL;
  const decision = landedOnApp ? ({ kind: 'refuse', reason: 'self' } as const) : decideEmbed(currentUrl, appOrigin);
  const devServer = decision.kind === 'embed' && isDevServerUrl(decision.url, appHostname);
  const frameKey = `${index}#${currentUrl}#${reloadKey}#${devicesOptIn ? 'dev' : ''}`;

  // Every new frame (navigation, reload, permission change) starts a fresh load cycle.
  useEffect(() => {
    loadCount.current = 0;
    setNavigatedAway(false);
  }, [frameKey]);

  const show = useCallback(
    (next: string) => {
      setInputUrl(next === BLANK_URL ? '' : next);
      setLandedOnApp(false);
      setDevicesOptIn(false);
      const kind = decideEmbed(next, appOrigin).kind;
      setIsLoading(kind === 'embed');
      onUrlChange?.(next);
      onTitleChange?.(labelForUrl(next));
      onFaviconChange?.('');
      // A blank or refused page renders no frame, so no load event will follow.
      if (kind !== 'embed') onDidFinishLoad?.();
    },
    [appOrigin, onUrlChange, onTitleChange, onFaviconChange, onDidFinishLoad]
  );

  const handleRefresh = useCallback(() => {
    setLandedOnApp(false);
    setIsLoading(decideEmbed(currentUrl, appOrigin).kind === 'embed');
    setReloadKey((k) => k + 1);
  }, [currentUrl, appOrigin]);

  const navigate = useCallback(
    (next: string) => {
      if (next === currentUrl) {
        handleRefresh();
        return;
      }
      setHistory((prev) => [...prev.slice(0, index + 1), next]);
      setIndex((prev) => prev + 1);
      show(next);
    },
    [currentUrl, index, show, handleRefresh]
  );

  // A new `url` prop (e.g. the panel opened another address) navigates the frame; empty = blank.
  useEffect(() => {
    const next = url || BLANK_URL;
    if (next === lastPropUrl.current) return;
    lastPropUrl.current = next;
    if (next !== currentUrl) navigate(next);
  }, [url, currentUrl, navigate]);

  const handleGoBack = useCallback(() => {
    if (index === 0) return;
    setIndex(index - 1);
    show(history[index - 1]);
  }, [history, index, show]);

  const handleGoForward = useCallback(() => {
    if (index >= history.length - 1) return;
    setIndex(index + 1);
    show(history[index + 1]);
  }, [history, index, show]);

  const handleOpenInNewTab = useCallback(() => {
    if (decision.kind !== 'embed') return;
    window.open(decision.url, '_blank', 'noopener,noreferrer');
  }, [decision]);

  const handleSubmit = useCallback(() => {
    const raw = inputUrl.trim();
    if (!raw) return;
    const resolved = resolveUrlInput ? resolveUrlInput(raw) : resolveDefaultUrlInput(raw);
    if (resolved) navigate(resolved);
  }, [inputUrl, resolveUrlInput, navigate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        setInputUrl(currentUrl === BLANK_URL ? '' : currentUrl);
        (e.target as HTMLInputElement).blur();
      }
    },
    [currentUrl]
  );

  const handleLoad = useCallback(() => {
    setIsLoading(false);
    // The embedded page navigated (or redirected) onto the app's own origin: never keep that.
    if (isAppOriginFrame(frameRef.current, appOrigin)) {
      setLandedOnApp(true);
      return;
    }
    loadCount.current += 1;
    if (loadCount.current > 1) setNavigatedAway(true);
    onDidFinishLoad?.();
  }, [appOrigin, onDidFinishLoad]);

  const dismissHint = useCallback(() => {
    setHintDismissed(true);
    try {
      window.sessionStorage.setItem(HINT_DISMISSED_KEY, '1');
    } catch {
      // Storage unavailable: the hint stays dismissed for this page view only.
    }
  }, []);

  const refuseMessage =
    decision.kind !== 'refuse'
      ? ''
      : decision.reason === 'self'
        ? t('preview.browser.cannotEmbedSelf')
        : decision.reason === 'insecure'
          ? t('preview.browser.insecureUrl')
          : t('preview.browser.unsupportedUrl');

  return (
    <div className={`h-full w-full flex flex-col ${className ?? ''}`} style={style} data-testid='iframe-host'>
      {showNavBar && (
        <div className='flex items-center gap-6px h-40px px-10px bg-bg-2 border-b border-border-1 flex-shrink-0'>
          <Button
            size='small'
            icon={<Left theme='outline' size={16} />}
            onClick={handleGoBack}
            disabled={index === 0}
            title={t('common.historyBack')}
            aria-label={t('common.historyBack')}
          />
          <Button
            size='small'
            icon={<Right theme='outline' size={16} />}
            onClick={handleGoForward}
            disabled={index >= history.length - 1}
            title={t('common.forward')}
            aria-label={t('common.forward')}
          />
          <Button
            size='small'
            icon={
              isLoading ? (
                <Loading theme='outline' size={16} className='animate-spin' />
              ) : (
                <Refresh theme='outline' size={16} />
              )
            }
            onClick={handleRefresh}
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
          />
          <Input
            size='small'
            className='flex-1 min-w-0'
            value={inputUrl}
            onChange={(value) => setInputUrl(value)}
            onPressEnter={handleSubmit}
            onKeyDown={handleKeyDown}
            onFocus={(e) => e.target.select()}
            placeholder={t('preview.browser.addressPlaceholder')}
            aria-label={t('preview.browser.addressLabel')}
            title={navigatedAway ? t('preview.browser.mayHaveNavigated') : undefined}
            style={navigatedAway ? { color: 'var(--color-text-3)', fontStyle: 'italic' } : undefined}
            data-testid='iframe-host-address'
          />
          {devServer && (
            <Button
              size='small'
              type={devicesOptIn ? 'primary' : 'secondary'}
              icon={<Microphone theme='outline' size={16} />}
              onClick={() => setDevicesOptIn((on) => !on)}
              title={devicesOptIn ? t('preview.browser.devicesOn') : t('preview.browser.allowDevices')}
              aria-label={devicesOptIn ? t('preview.browser.devicesOn') : t('preview.browser.allowDevices')}
              aria-pressed={devicesOptIn}
              data-testid='iframe-host-devices'
            />
          )}
          <Button
            size='small'
            icon={<LinkOut theme='outline' size={16} />}
            onClick={handleOpenInNewTab}
            disabled={decision.kind !== 'embed'}
            title={t('preview.browser.openInNewTab')}
            aria-label={t('preview.browser.openInNewTab')}
            data-testid='iframe-host-open-new-tab'
          />
        </div>
      )}
      {showNavBar && decision.kind === 'embed' && !hintDismissed && (
        <div className='flex items-start gap-6px px-10px py-4px text-11px text-t-tertiary bg-bg-2 border-b border-border-1 flex-shrink-0'>
          <span className='flex-1'>{t('preview.browser.webModeHint')}</span>
          <Button
            size='mini'
            type='text'
            icon={<Close theme='outline' size={12} />}
            onClick={dismissHint}
            title={t('preview.browser.dismissHint')}
            aria-label={t('preview.browser.dismissHint')}
            data-testid='iframe-host-dismiss-hint'
          />
        </div>
      )}

      <div className='flex-1 overflow-hidden relative' style={{ minHeight: 0 }}>
        {decision.kind === 'embed' && (
          <iframe
            key={frameKey}
            ref={frameRef}
            src={decision.url}
            title={labelForUrl(decision.url)}
            sandbox={sandboxFor(decision.url, appHostname)}
            allow={iframeAllowFor(decision.url, appHostname, devicesOptIn)}
            referrerPolicy='strict-origin-when-cross-origin'
            className='border-0 absolute inset-0 w-full h-full bg-white'
            onLoad={handleLoad}
            data-testid='iframe-host-frame'
          />
        )}
        {decision.kind === 'refuse' && (
          <div
            className='absolute inset-0 flex items-center justify-center p-16px text-center text-13px text-t-secondary'
            role='status'
          >
            {refuseMessage}
          </div>
        )}
      </div>
    </div>
  );
};

export default IframeHost;
