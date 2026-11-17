/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Live view of a Camoufox profile (C35 v2 / C38 K6d, TASK-136 U4). Camoufox
 * has no CDP screencast, so AionCore tunnels the VNC view of the profile's
 * display: `GET /api/browser/instances/{n}/vnc`, raw RFB in binary frames,
 * no password (the VNC server is only reachable by AionCore). Connecting
 * starts the profile or attaches to it. The view scales to the panel, starts
 * view-only (the owner switches that off to click and type), and never
 * shares the clipboard.
 */

import { Button, Message, Spin, Switch } from '@arco-design/web-react';
import type RFB from '@novnc/novnc';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { serverBrowser } from '@/common/adapter/ipcBridge';
import { browserVncUrl, vncCloseKey } from './server/streamProtocol';

const KEY = 'preview.serverBrowser.vnc';

type Phase = 'connecting' | 'connected' | 'closed';
type Closed = { key: ReturnType<typeof vncCloseKey>; reason: string };

const VncBrowserView: React.FC<{
  instance: number;
  /** The switcher (profiles + devices), shown in the header like on the other browser views. */
  switcher: React.ReactNode;
}> = ({ instance, switcher }) => {
  const { t } = useTranslation();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<RFB | null>(null);
  const [phase, setPhase] = useState<Phase>('connecting');
  const [closed, setClosed] = useState<Closed | null>(null);
  const [viewOnly, setViewOnly] = useState(true);
  const viewOnlyRef = useRef(viewOnly);
  const [attempt, setAttempt] = useState(0);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return undefined;
    let cancelled = false;
    setPhase('connecting');
    setClosed(null);
    // Our own socket, so the close code (why AionCore refused) is visible; noVNC only reports "disconnected".
    const socket = new WebSocket(browserVncUrl(window.location, instance));
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('close', (event) => {
      if (cancelled) return;
      setPhase('closed');
      setClosed({ key: vncCloseKey(event.code), reason: event.reason });
    });
    void import('@novnc/novnc')
      .then(({ default: Rfb }) => {
        if (cancelled) return;
        const rfb = new Rfb(surface, socket);
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfb.viewOnly = viewOnlyRef.current;
        rfb.addEventListener('connect', () => {
          if (!cancelled) setPhase('connected');
        });
        rfbRef.current = rfb;
      })
      .catch(() => {
        if (cancelled) return;
        socket.close();
        setPhase('closed');
        setClosed({ key: 'ended', reason: '' });
      });
    return () => {
      cancelled = true;
      try {
        rfbRef.current?.disconnect();
      } catch {
        // Already disconnected.
      }
      rfbRef.current = null;
      socket.close();
    };
  }, [instance, attempt]);

  useEffect(() => {
    viewOnlyRef.current = viewOnly;
    if (rfbRef.current) rfbRef.current.viewOnly = viewOnly;
  }, [viewOnly]);

  const stop = async () => {
    setStopping(true);
    try {
      await serverBrowser.stopInstance.invoke({ instance });
    } catch {
      Message.error(t(`${KEY}.stopFailed`));
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className='absolute inset-0 flex flex-col bg-1' data-testid='vnc-browser-view'>
      <div className='flex flex-wrap items-center gap-8px px-8px py-6px border-b border-b-solid border-3'>
        {switcher}
        <label className='inline-flex items-center gap-6px text-12px text-t-secondary'>
          <Switch
            size='small'
            checked={viewOnly}
            aria-label={t(`${KEY}.viewOnly`)}
            onChange={(checked: boolean) => setViewOnly(checked)}
            data-testid='vnc-view-only'
          />
          <span aria-hidden='true'>{t(`${KEY}.viewOnly`)}</span>
        </label>
        <span className='flex-1' />
        {phase === 'closed' ? (
          <Button size='mini' type='primary' onClick={() => setAttempt((value) => value + 1)} data-testid='vnc-connect'>
            {t(`${KEY}.connect`)}
          </Button>
        ) : (
          <Button size='mini' loading={stopping} onClick={() => void stop()} data-testid='vnc-stop'>
            {t(`${KEY}.stop`)}
          </Button>
        )}
      </div>
      <div className='relative flex-1 min-h-0'>
        <div
          ref={surfaceRef}
          className='absolute inset-0 overflow-hidden'
          role='application'
          aria-label={t(`${KEY}.surfaceLabel`)}
          data-testid='vnc-surface'
        />
        {phase === 'connecting' ? (
          <div
            className='absolute inset-0 flex items-center justify-center gap-8px text-13px text-t-secondary bg-1'
            role='status'
          >
            <Spin size={14} />
            <span>{t(`${KEY}.connecting`)}</span>
          </div>
        ) : null}
        {phase === 'closed' && closed ? (
          <div
            className='absolute inset-0 flex items-center justify-center p-16px text-13px text-t-secondary text-center bg-1'
            role='status'
            data-testid='vnc-closed'
          >
            {t(`${KEY}.closed.${closed.key}`, { reason: closed.reason })}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default VncBrowserView;
