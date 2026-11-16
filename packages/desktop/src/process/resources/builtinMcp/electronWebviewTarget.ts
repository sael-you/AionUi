/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Electron target of the single-target CDP bridge: the in-app browser webview's
 * `webContents.debugger`. Moved unchanged out of cdpBridge.ts (TASK-111) so the bridge
 * server is target-agnostic.
 */

import { webContents, type Debugger, type WebContents } from 'electron';
import { SINGLE_SESSION_ID, buildTargetInfo } from './cdpTargetProtocol';
import type { CdpTarget, CdpTargetEvents } from './cdpTarget';

export type ElectronWebviewTarget = CdpTarget & {
  /** 侧边浏览器的 webContents id；未附加时为 null。/ null while nothing is attached. */
  attachedWebContentsId: () => number | null;
  attach: (webContentsId: number) => { ok: true } | { ok: false; reason: string };
  detach: () => void;
};

type AttachedState = {
  contents: WebContents;
  dbg: Debugger;
  onMessage: (event: unknown, method: string, params: unknown, sessionId: string) => void;
  onDestroyed: () => void;
};

export const createElectronWebviewTarget = ({ emit: broadcast }: CdpTargetEvents): ElectronWebviewTarget => {
  let attached: AttachedState | null = null;

  const currentTargetInfo = () => {
    if (!attached || attached.contents.isDestroyed()) return buildTargetInfo('', 'about:blank');
    return buildTargetInfo(attached.contents.getTitle(), attached.contents.getURL());
  };

  const detachInternal = () => {
    if (!attached) return;
    const { contents, dbg, onMessage, onDestroyed } = attached;
    attached = null;
    try {
      dbg.removeListener('message', onMessage);
      contents.removeListener('destroyed', onDestroyed);
      if (dbg.isAttached()) dbg.detach();
    } catch {
      // 已经销毁/已分离时 Electron 会抛，忽略即可。
      // Electron throws if it is already destroyed or detached; nothing to do.
    }
  };

  /**
   * 附加到指定 webContents。
   *
   * 两道校验都必须报错而不是「尽力而为」：
   *  - getType() 必须是 webview：防止把主窗口（带 preload 桥）交出去，这正是原方案的漏洞。
   *  - debugger.attach() 会和同一个 webContents 上打开的 DevTools 冲突（Electron 限制），
   *    这时给出可读的原因，而不是抛一个原始异常。
   *
   * Both checks must fail loudly rather than degrade:
   *  - getType() must be 'webview', so the main window (with its preload bridge) can never
   *    be handed over — that is precisely the hole in the process-wide approach.
   *  - debugger.attach() conflicts with DevTools open on the same webContents (an Electron
   *    limitation); surface a readable reason instead of a raw throw.
   */
  const attachInternal = (webContentsId: number): { ok: true } | { ok: false; reason: string } => {
    const contents = webContents.fromId(webContentsId);
    if (!contents || contents.isDestroyed()) {
      return { ok: false, reason: `No live webContents with id ${webContentsId}` };
    }

    const type = contents.getType();
    if (type !== 'webview') {
      return {
        ok: false,
        reason: `Refusing to attach to webContents of type "${type}"; only the in-app browser webview may be exposed.`,
      };
    }

    if (attached?.contents.id === webContentsId) return { ok: true };
    detachInternal();

    const dbg = contents.debugger;
    try {
      if (!dbg.isAttached()) dbg.attach('1.3');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `Could not attach debugger (DevTools open on this view will block it): ${message}` };
    }

    const onMessage = (_event: unknown, method: string, params: unknown, _sessionId: string) => {
      /**
       * 统一贴上我们那个固定 sessionId 再转发。
       *
       * puppeteer 用 flatten 模式，它靠 sessionId 把事件路由到对应的页面会话；不贴的话
       * 事件会被当成浏览器级的，Page/Runtime 那些事件就丢了。
       *
       * Stamp our fixed sessionId before forwarding. puppeteer runs in flatten mode and
       * routes events to the page session by sessionId; without it these would look
       * browser-level and Page/Runtime events would be dropped.
       */
      broadcast({ method, params: params ?? {}, sessionId: SINGLE_SESSION_ID });
    };

    const onDestroyed = () => {
      detachInternal();
      broadcast({ method: 'Target.targetDestroyed', params: { targetId: currentTargetInfo().targetId } });
    };

    dbg.on('message', onMessage);
    contents.once('destroyed', onDestroyed);
    attached = { contents, dbg, onMessage, onDestroyed };
    return { ok: true };
  };

  return {
    targetInfo: currentTargetInfo,
    isAttached: () => Boolean(attached && !attached.contents.isDestroyed()),
    send: (method, params) => {
      if (!attached || attached.contents.isDestroyed()) return Promise.reject(new Error('The in-app browser is gone.'));
      return attached.dbg.sendCommand(method, params);
    },
    attachedWebContentsId: () => (attached && !attached.contents.isDestroyed() ? attached.contents.id : null),
    attach: attachInternal,
    detach: detachInternal,
  };
};
