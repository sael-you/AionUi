/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Settings → Devices (C38 §5, TASK-136; replaces Settings → Browser): every
 * device an agent can reach, in the C33 library layout. Rail = Server
 * browsers · My browsers · Phones · Add-ons · Mac; tabs Active / Library;
 * cards with the agent switch; a 480-px details drawer.
 *
 * The browser settings moved in unchanged: the server browser's switch,
 * limits and profiles sit under Server browsers, the extension install,
 * pairing, paired browsers and the approvals log under My browsers.
 * Desktop: only the in-app browser's own settings, as before.
 */

import { Button, Dropdown, Menu, Message, Modal } from '@arco-design/web-react';
import { Plus } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { devices as devicesApi, serverBrowser } from '@/common/adapter/ipcBridge';
import type { Device, DeviceKind, DevicePairingKind } from '@/common/types/platform/devices';
import type { BrowserStatusResponse } from '@/common/types/platform/serverBrowser';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import LibraryLayout from '@/renderer/components/settings/SettingsModal/library/LibraryLayout';
import { LibraryEmpty } from '@/renderer/components/settings/SettingsModal/library/LibraryParts';
import LibrarySection from '@/renderer/components/settings/SettingsModal/library/LibrarySection';
import { matchesQuery } from '@/renderer/components/settings/SettingsModal/library/libraryModel';
import BrowserApprovalsLog from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/BrowserApprovalsLog';
import BrowserDataSection from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/BrowserDataSection';
import BrowserDevicesSettings from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/BrowserDevicesSettings';
import ServerBrowserSettings from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/ServerBrowserSettings';
import { useSettingsViewMode } from '@/renderer/components/settings/SettingsModal/settingsViewContext';
import BrowserExtensionInstall from '@/renderer/pages/conversation/Preview/browser/BrowserExtensionInstall';
import { useBrowserDevices } from '@/renderer/pages/conversation/Preview/browser/server/useBrowserDevices';
import { SERVER_BROWSER_STATUS_KEY } from '@/renderer/pages/conversation/Preview/browser/server/useServerBrowserAvailability';
import SettingsPageHeader from '@/renderer/pages/settings/components/SettingsPageHeader';
import SettingsPageWrapper from '@/renderer/pages/settings/components/SettingsPageWrapper';
import { useIsMobileLayout } from '@/renderer/pages/settings/ToolsSettings/market/shared';
import { isElectronDesktop } from '@/renderer/utils/platform';
import DeviceCard from './DeviceCard';
import DeviceDrawer from './DeviceDrawer';
import {
  categoryCounts,
  DEVICE_CATEGORIES,
  devicesOn,
  formatDiskSize,
  takesTimeout,
  type DevicesTab,
} from './devicesModel';
import DevicePairingModal from './phones/DevicePairingModal';
import { AddonBlock, MacBlock } from './phones/AddonBlocks';
import { DeviceAccessBlock, DeviceAuditBlock, DeviceRoutesBlock, DEFAULT_TIMEOUT } from './phones/PhoneBlocks';
import { useDevices } from './useDevices';

const KEY = 'settings.devices';

/** Desktop: the in-app webview's data and agent switch (the devices live on the WebUI's AionCore). */
const DesktopDevices: React.FC = () => {
  const { t } = useTranslation();
  const isPageMode = useSettingsViewMode() === 'page';
  return (
    <SettingsPageWrapper>
      <div className='flex flex-col gap-16px' data-testid='devices-settings-page'>
        <SettingsPageHeader title={t(`${KEY}.title`)} description={t('settings.browserPage.descriptionDesktop')} />
        <AionScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow={isPageMode}>
          <BrowserDataSection />
        </AionScrollArea>
      </div>
    </SettingsPageWrapper>
  );
};

const WebDevices: React.FC = () => {
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobileLayout();
  const { devices, reload } = useDevices();
  const { devices: browsers } = useBrowserDevices();
  // Engines carry what the registry does not: how the download was verified, agents-only, the last error.
  const { data: status } = useSWR<BrowserStatusResponse | null>(SERVER_BROWSER_STATUS_KEY, async () => {
    try {
      return await serverBrowser.getStatus.invoke();
    } catch {
      return null;
    }
  });
  const [category, setCategory] = useState<DeviceKind>('server_browser');
  const [tab, setTab] = useState<DevicesTab>('active');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pairingKind, setPairingKind] = useState<DevicePairingKind | null>(null);
  const [modal, modalHolder] = Modal.useModal();

  // "Off in N min" stays current.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const counts = useMemo(() => {
    const byKind = categoryCounts(devices, tab);
    // My browsers are the extension's paired browsers (C34), whatever the registry has yet.
    byKind.my_browser = tab === 'active' ? browsers.length : Math.max(byKind.my_browser, browsers.length);
    return byKind;
  }, [browsers.length, devices, tab]);

  const shown = devicesOn(devices, category, tab).filter((device) => matchesQuery(query, device.name, device.version));
  const opened = devices.find((device) => device.id === openId) ?? null;

  const toggle = async (device: Device, enabled: boolean) => {
    setSaving(device.id);
    try {
      await devicesApi.update.invoke({
        id: device.id,
        enabled,
        ...(enabled && takesTimeout(device) ? { timeout_minutes: DEFAULT_TIMEOUT } : {}),
      });
      await reload();
      Message.success(t(enabled ? `${KEY}.turnedOn` : `${KEY}.turnedOff`, { name: device.name }));
    } catch {
      Message.error(t(`${KEY}.saveFailed`));
    } finally {
      setSaving(null);
    }
  };

  const install = async (device: Device) => {
    try {
      await devicesApi.install.invoke({ id: device.id });
      await reload();
      Message.info(t(`${KEY}.installStarted`, { name: device.name }));
    } catch {
      Message.error(t(`${KEY}.jobStartFailed`, { name: device.name }));
    }
  };

  const remove = (device: Device) => {
    modal.confirm?.({
      title: t(`${KEY}.removeTitle`, { name: device.name }),
      content:
        device.disk_bytes !== null
          ? t(`${KEY}.removeFrees`, { size: formatDiskSize(device.disk_bytes, i18n.language) })
          : t(`${KEY}.removeContent`),
      okText: t(`${KEY}.remove`),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        try {
          await devicesApi.remove.invoke({ id: device.id });
          await reload();
        } catch (error) {
          Message.error(
            isBackendHttpError(error) && error.code === 'DEVICE_IN_USE'
              ? t(`${KEY}.removeInUse`, { name: device.name })
              : t(`${KEY}.jobStartFailed`, { name: device.name })
          );
        }
      },
    });
  };

  const engineOf = (device: Device) => status?.engines?.find((entry) => entry.engine === device.source_id);

  const cards = (list: Device[]) =>
    list.map((device) => (
      <DeviceCard
        key={device.id}
        device={device}
        engine={device.kind === 'server_browser' ? engineOf(device) : undefined}
        now={now}
        saving={saving === device.id}
        onToggle={(target, enabled) => void toggle(target, enabled)}
        onInstall={(target) => void install(target)}
        onRemove={remove}
        onOpen={(target) => setOpenId(target.id)}
        onJobFinished={() => void reload()}
      />
    ));

  // A phone appears once something that reaches it is paired: the Mac helper or the companion app.
  const addPhone = (
    <Dropdown
      trigger='click'
      position='br'
      droplist={
        <Menu onClickMenuItem={(key) => setPairingKind(key as DevicePairingKind)} data-testid='devices-add-phone-menu'>
          <Menu.Item key='mac_helper'>{t(`${KEY}.routes.mac_relay.name`)}</Menu.Item>
          <Menu.Item key='companion'>{t(`${KEY}.routes.companion.name`)}</Menu.Item>
        </Menu>
      }
    >
      <Button size='small' icon={<Plus theme='outline' size={14} />} data-testid='devices-add-phone'>
        {t(`${KEY}.addPhone`)}
      </Button>
    </Dropdown>
  );

  const emptyText = tab === 'active' ? t(`${KEY}.empty.active.${category}`) : t(`${KEY}.empty.library.${category}`);
  const deviceSection =
    shown.length > 0 ? (
      <LibrarySection
        sectionKey={`devices-${category}`}
        title={t(`${KEY}.categories.${category}`)}
        count={shown.length}
        visual={category}
        actions={category === 'phone' ? addPhone : undefined}
      >
        {cards(shown)}
      </LibrarySection>
    ) : category === 'phone' ? (
      <div className='flex flex-col items-center gap-8px'>
        <LibraryEmpty text={emptyText} />
        {addPhone}
      </div>
    ) : (
      <LibraryEmpty
        text={emptyText}
        actionLabel={tab === 'active' ? t(`${KEY}.browseLibrary`) : undefined}
        onAction={tab === 'active' ? () => setTab('library') : undefined}
      />
    );

  let panel: React.ReactNode;
  if (category === 'my_browser') {
    // C34 sections, unchanged: install + pairing in the Library, paired browsers + approvals in Active.
    panel =
      tab === 'library' ? (
        <>
          <BrowserExtensionInstall />
          <BrowserDevicesSettings />
        </>
      ) : (
        <>
          <BrowserDevicesSettings />
          <BrowserApprovalsLog />
        </>
      );
  } else if (category === 'server_browser') {
    panel = (
      <>
        {deviceSection}
        {tab === 'active' ? <ServerBrowserSettings /> : null}
      </>
    );
  } else {
    panel = deviceSection;
  }

  // The selected category's line ("2 on · 610 MB on disk"); My browsers lists its own state.
  const inCategory = devices.filter((device) => device.kind === category);
  const enabledCount = inCategory.filter((device) => device.enabled).length;
  const diskBytes = inCategory.reduce((sum, device) => sum + (device.installed ? (device.disk_bytes ?? 0) : 0), 0);
  const summary = [
    category === 'my_browser' ? null : t(`${KEY}.summaryOn`, { count: enabledCount }),
    diskBytes > 0 ? t(`${KEY}.summaryDisk`, { size: formatDiskSize(diskBytes, i18n.language) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <SettingsPageWrapper contentClassName='max-w-1200px'>
      {modalHolder}
      {/* A column like the Tools page, so the layout takes the full width on phones. */}
      <div className='flex flex-col gap-16px min-h-0'>
        <LibraryLayout
          testId='devices-settings-page'
          title={t(`${KEY}.title`)}
          description={t(`${KEY}.description`)}
          search={{ value: query, onChange: setQuery, placeholder: t(`${KEY}.search`) }}
          rail={{
            categories: DEVICE_CATEGORIES.map((kind) => ({
              key: kind,
              label: t(`${KEY}.categories.${kind}`),
              count: counts[kind],
            })),
            selectedCategory: category,
            onCategory: (key) => setCategory(key as DeviceKind),
          }}
          scopeTitle={t(`${KEY}.categories.${category}`)}
          summary={summary}
          tabs={[
            { key: 'active', label: t('settings.library.tabActive') },
            { key: 'library', label: t('settings.library.tabLibrary') },
          ]}
          activeTab={tab}
          onTab={(key) => setTab(key as DevicesTab)}
          tabsLabel={t('settings.library.tabsLabel')}
          isMobile={isMobile}
        >
          <div className='flex flex-col gap-16px'>{panel}</div>
        </LibraryLayout>
      </div>
      <DeviceDrawer
        device={opened}
        isMobile={isMobile}
        onClose={() => setOpenId(null)}
        onInstall={(target) => void install(target)}
        onRemove={remove}
        onJobFinished={() => void reload()}
      >
        {opened?.kind === 'mac' ? <MacBlock /> : null}
        {opened?.kind === 'addon' ? (
          <>
            <AddonBlock device={opened} host={devices.find((device) => device.id === opened.addon_host) ?? null} />
            {opened.installed ? <DeviceAuditBlock key={opened.id} device={opened} /> : null}
          </>
        ) : null}
        {opened && opened.available === 'now' && (opened.kind === 'phone' || opened.kind === 'mac') ? (
          <>
            <DeviceAccessBlock device={opened} onChanged={() => void reload()} />
            <DeviceRoutesBlock device={opened} onChanged={() => void reload()} onPair={setPairingKind} />
            <DeviceAuditBlock key={opened.id} device={opened} />
          </>
        ) : null}
      </DeviceDrawer>
      <DevicePairingModal kind={pairingKind} onClose={() => setPairingKind(null)} />
    </SettingsPageWrapper>
  );
};

const DevicesSettings: React.FC = () => (isElectronDesktop() ? <DesktopDevices /> : <WebDevices />);

export default DevicesSettings;
