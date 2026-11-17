/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState } from 'react';
import type { PreviewTab, PreviewTabPatch } from '../context/PreviewContext';
import BrowserViewer from './BrowserViewer';
import BrowserScopeSelect from './server/BrowserScopeSelect';
import DeviceBrowserView from './server/DeviceBrowserView';
import ServerBrowserView from './server/ServerBrowserView';
import { VNC_ENGINE } from './server/streamProtocol';
import VncBrowserView from './VncBrowserView';
import { useBrowserDevices } from './server/useBrowserDevices';
import { useServerBrowserAvailability } from './server/useServerBrowserAvailability';

export interface BrowserTabLayerProps {
  /** 所有浏览器类型的 tab / Every browser-type tab */
  browserTabs: PreviewTab[];
  /** 当前激活的 tab id（可能不是浏览器 tab）/ Active tab id (may not be a browser tab) */
  activeTabId: string | null;
  /** 回写 tab 字段 / Patch fields back onto a tab */
  updateTab: (tabId: string, patch: PreviewTabPatch) => void;
}

/**
 * 常驻挂载的浏览器层 / Always-mounted browser layer.
 *
 * 预览面板原本只渲染当前激活的 tab，对文档没问题，但对浏览器是致命的：
 * 切走再切回会重新加载页面，滚动位置、表单内容、未提交的操作全部丢失，
 * Agent 正在进行的操作也会被打断。
 *
 * 所以这一层把所有浏览器 tab 一直挂着，只切换可见性 —— webview 进程不销毁，
 * 页面状态完整保留。非激活的 tab 用 visibility 隐藏而不是 display:none，
 * 这样它们仍有真实尺寸，切回来时不需要重新布局。
 *
 * The preview panel renders only the active tab, which is fine for documents but
 * fatal for a browser: switching away and back would reload the page, losing
 * scroll position, form input, and any in-flight agent operation. This layer keeps
 * every browser tab mounted and only toggles visibility, so the webview process
 * survives. Inactive tabs are hidden via `visibility` rather than `display:none`
 * so they retain real dimensions and need no relayout when shown again.
 */
const BrowserTabLayer: React.FC<BrowserTabLayerProps> = ({ browserTabs, activeTabId, updateTab }) => {
  const handleUrlChange = useCallback(
    (tabId: string, url: string) => {
      // 地址存在 content 里，与其他 tab 类型保持一致 / Address lives in content, like other tab types
      updateTab(tabId, { content: url });
    },
    [updateTab]
  );

  const handleTitleChange = useCallback((tabId: string, title: string) => updateTab(tabId, { title }), [updateTab]);

  const handleFaviconChange = useCallback(
    (tabId: string, favicon: string) => updateTab(tabId, { metadata: { favicon } }),
    [updateTab]
  );

  const serverBrowser = useServerBrowserAvailability();
  // The owner's own browsers (C34) join the switcher; picking one shows its live view instead of the stream.
  const { devices } = useBrowserDevices(serverBrowser.available);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [lastInstance, setLastInstance] = useState(1);

  if (browserTabs.length === 0) return null;

  const isBrowserActive = browserTabs.some((tab) => tab.id === activeTabId);

  // WebUI with the server browser (C30): one real Chrome with its own tabs, instead of one iframe per tab.
  if (serverBrowser.available) {
    const vncProfile = serverBrowser.profiles.find(
      (profile) => profile.instance === lastInstance && profile.engine === VNC_ENGINE
    );
    const requested = browserTabs.find((tab) => tab.id === activeTabId) ?? browserTabs.at(-1);
    return (
      <div className='relative flex-1 overflow-hidden' style={{ display: isBrowserActive ? undefined : 'none' }}>
        {deviceId ? (
          <DeviceBrowserView
            device={devices.find((device) => device.device_id === deviceId)}
            agentsEnabled={serverBrowser.devicesAgentsEnabled}
            switcher={
              <BrowserScopeSelect
                profiles={serverBrowser.profiles}
                devices={devices}
                value={{ kind: 'device', deviceId }}
                onChange={(scope) => {
                  if (scope.kind === 'device') {
                    setDeviceId(scope.deviceId);
                    return;
                  }
                  setLastInstance(scope.instance);
                  setDeviceId(null);
                }}
              />
            }
          />
        ) : vncProfile ? (
          // Camoufox has no CDP screencast: its panel is the VNC view of the profile's display (U4).
          <VncBrowserView
            key={vncProfile.instance}
            instance={vncProfile.instance}
            switcher={
              <BrowserScopeSelect
                profiles={serverBrowser.profiles}
                devices={devices}
                value={{ kind: 'profile', instance: vncProfile.instance }}
                onChange={(scope) => {
                  if (scope.kind === 'device') setDeviceId(scope.deviceId);
                  else setLastInstance(scope.instance);
                }}
              />
            }
          />
        ) : (
          <ServerBrowserView
            profiles={serverBrowser.profiles}
            requestedUrl={requested?.content}
            devices={devices}
            onSelectDevice={setDeviceId}
            initialInstance={lastInstance}
            onInstanceChange={setLastInstance}
          />
        )}
      </div>
    );
  }

  return (
    <div className='relative flex-1 overflow-hidden' style={{ display: isBrowserActive ? undefined : 'none' }}>
      {browserTabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className='absolute inset-0 flex flex-col'
            style={{
              visibility: isActive ? 'visible' : 'hidden',
              pointerEvents: isActive ? undefined : 'none',
              zIndex: isActive ? 1 : 0,
            }}
          >
            <BrowserViewer
              url={tab.content}
              tabId={tab.id}
              onUrlChange={handleUrlChange}
              onTitleChange={handleTitleChange}
              onFaviconChange={handleFaviconChange}
            />
          </div>
        );
      })}
    </div>
  );
};

export default BrowserTabLayer;
