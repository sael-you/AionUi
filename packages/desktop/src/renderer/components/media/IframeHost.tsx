/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Left, Right, Refresh, Loading, LinkOut } from '@icon-park/react';
import type { WebviewHostProps } from './WebviewHost';
import { URL_VIEWER_TOOLBAR_CSS } from './urlViewerToolbarStyles';
import {
  BLANK_URL,
  IFRAME_SANDBOX,
  decideEmbed,
  iframeAllowFor,
  labelForUrl,
  resolveDefaultUrlInput,
} from './iframeHostPolicy';

/**
 * Web (non-Electron) browser host: renders pages in a sandboxed <iframe>.
 *
 * Limits compared with the desktop <webview>, stated in the UI hint:
 * - pages are cross-origin, so in-page link navigation, titles and favicons can't be read;
 *   history covers the addresses opened from the address bar (or by the owner of the panel);
 * - sites that refuse embedding (X-Frame-Options / CSP frame-ancestors) show the browser's own
 *   "refused to connect" page; "Open in new tab" is the way out;
 * - agents can't drive it (no CDP on the web); they keep using the Playwright CLI.
 */
const IframeHost: React.FC<WebviewHostProps> = ({
  url,
  showNavBar = false,
  className,
  style,
  onDidFinishLoad,
  onUrlChange,
  onTitleChange,
  resolveUrlInput,
}) => {
  const { t } = useTranslation();
  const appOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const appHostname = typeof window !== 'undefined' ? window.location.hostname : '';

  const [history, setHistory] = useState<string[]>([url || BLANK_URL]);
  const [index, setIndex] = useState(0);
  const [inputUrl, setInputUrl] = useState(url === BLANK_URL ? '' : url);
  const [isLoading, setIsLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const lastPropUrl = useRef(url);

  const currentUrl = history[index] ?? BLANK_URL;
  const decision = decideEmbed(currentUrl, appOrigin);

  const announce = useCallback(
    (next: string) => {
      setInputUrl(next === BLANK_URL ? '' : next);
      onUrlChange?.(next);
      onTitleChange?.(labelForUrl(next));
    },
    [onUrlChange, onTitleChange]
  );

  const navigate = useCallback(
    (next: string) => {
      setHistory((prev) => [...prev.slice(0, index + 1), next]);
      setIndex((prev) => prev + 1);
      setIsLoading(decideEmbed(next, appOrigin).kind === 'embed');
      announce(next);
    },
    [index, appOrigin, announce]
  );

  // A new `url` prop (e.g. the owner opened another address) navigates the frame.
  useEffect(() => {
    if (url === lastPropUrl.current) return;
    lastPropUrl.current = url;
    if (url && url !== currentUrl) navigate(url);
  }, [url, currentUrl, navigate]);

  const handleGoBack = useCallback(() => {
    if (index === 0) return;
    const next = history[index - 1];
    setIndex(index - 1);
    setIsLoading(decideEmbed(next, appOrigin).kind === 'embed');
    announce(next);
  }, [history, index, appOrigin, announce]);

  const handleGoForward = useCallback(() => {
    if (index >= history.length - 1) return;
    const next = history[index + 1];
    setIndex(index + 1);
    setIsLoading(decideEmbed(next, appOrigin).kind === 'embed');
    announce(next);
  }, [history, index, appOrigin, announce]);

  const handleRefresh = useCallback(() => {
    setIsLoading(decision.kind === 'embed');
    setReloadKey((k) => k + 1);
  }, [decision.kind]);

  const handleOpenInNewTab = useCallback(() => {
    if (decision.kind !== 'embed') return;
    window.open(decision.url, '_blank', 'noopener,noreferrer');
  }, [decision]);

  const handleUrlSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const raw = inputUrl.trim();
      if (!raw) return;
      const resolved = resolveUrlInput ? resolveUrlInput(raw) : resolveDefaultUrlInput(raw);
      if (resolved) navigate(resolved);
    },
    [inputUrl, resolveUrlInput, navigate]
  );

  const handleUrlKeyDown = useCallback(
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
    onDidFinishLoad?.();
  }, [onDidFinishLoad]);

  return (
    <div className={`h-full w-full flex flex-col ${className ?? ''}`} style={style} data-testid='iframe-host'>
      {showNavBar && <style>{URL_VIEWER_TOOLBAR_CSS}</style>}
      {showNavBar && (
        <div className='aion-url-viewer-toolbar flex items-center gap-6px h-40px px-10px bg-bg-2 border-b border-border-1 flex-shrink-0'>
          <button
            onClick={handleGoBack}
            disabled={index === 0}
            className='toolbar-btn icon-btn'
            title={t('common.historyBack')}
            aria-label={t('common.historyBack')}
          >
            <Left theme='outline' size={16} />
          </button>
          <button
            onClick={handleGoForward}
            disabled={index >= history.length - 1}
            className='toolbar-btn icon-btn'
            title={t('common.forward')}
            aria-label={t('common.forward')}
          >
            <Right theme='outline' size={16} />
          </button>
          <button
            onClick={handleRefresh}
            className='toolbar-btn icon-btn'
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
          >
            {isLoading ? (
              <Loading theme='outline' size={16} className='animate-spin' />
            ) : (
              <Refresh theme='outline' size={16} />
            )}
          </button>
          <form onSubmit={handleUrlSubmit} className='flex-1 ms-2px'>
            <input
              type='text'
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              onKeyDown={handleUrlKeyDown}
              onFocus={(e) => e.target.select()}
              className='toolbar-input'
              placeholder={t('preview.browser.addressPlaceholder')}
            />
          </form>
          <button
            onClick={handleOpenInNewTab}
            disabled={decision.kind !== 'embed'}
            className='toolbar-btn icon-btn'
            title={t('preview.browser.openInNewTab')}
            aria-label={t('preview.browser.openInNewTab')}
            data-testid='iframe-host-open-new-tab'
          >
            <LinkOut theme='outline' size={16} />
          </button>
        </div>
      )}
      {showNavBar && decision.kind === 'embed' && (
        <div className='px-10px py-4px text-11px text-t-tertiary bg-bg-2 border-b border-border-1 flex-shrink-0'>
          {t('preview.browser.webModeHint')}
        </div>
      )}

      <div className='flex-1 overflow-hidden relative' style={{ minHeight: 0 }}>
        {decision.kind === 'embed' && (
          <iframe
            key={`${currentUrl}#${reloadKey}`}
            src={decision.url}
            title={labelForUrl(decision.url)}
            sandbox={IFRAME_SANDBOX}
            allow={iframeAllowFor(decision.url, appHostname)}
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
            {decision.reason === 'self' ? t('preview.browser.cannotEmbedSelf') : t('preview.browser.unsupportedUrl')}
          </div>
        )}
      </div>
    </div>
  );
};

export default IframeHost;
