/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Voice settings (plan §3.5 kill switch / budget / car mode; §1 shortcut):
 * voice on/off (off by default), engine, wake word, car mode, budget display,
 * arm shortcut. Server-owned values go through `GET/PUT /api/voice/settings`;
 * the shortcut is per browser. Rendered inside the voice overlay and, after the
 * integration patch, as the `/settings/voice` page.
 */

import { Button, Input, Message, Switch, Typography } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AionSelect from '@/renderer/components/base/AionSelect';
import PreferenceRow from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/PreferenceRow';
import { DEFAULT_VOICE_SHORTCUT, loadVoiceShortcut, saveVoiceShortcut, shortcutFromEvent } from '../core/shortcut';
import type { VoiceEngineId, VoiceSettings } from '../core/types';
import type { VoiceController } from '../core/VoiceController';
import { useVoiceView } from '../core/voiceStore';
import BudgetMeter from './BudgetMeter';

const ENGINES: Array<{ id: VoiceEngineId; labelKey: string; available: boolean }> = [
  { id: 'openai-realtime', labelKey: 'voice.settings.engineName.openaiRealtime', available: true },
  { id: 'openai-relay', labelKey: 'voice.settings.engineName.openaiRelay', available: false },
  { id: 'minimax-cascade', labelKey: 'voice.settings.engineName.minimaxCascade', available: false },
];

const VoiceSettingsPanel: React.FC<{ controller: VoiceController }> = ({ controller }) => {
  const { t } = useTranslation();
  const view = useVoiceView(controller.store);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState<keyof VoiceSettings | null>(null);
  const [shortcut, setShortcut] = useState(loadVoiceShortcut);
  const settings = view.settings;

  useEffect(() => {
    let alive = true;
    void controller.loadSettings().then((s) => {
      if (alive) setLoadFailed(!s);
    });
    return () => {
      alive = false;
    };
  }, [controller]);

  const save = (key: keyof VoiceSettings, value: VoiceSettings[keyof VoiceSettings]) => {
    setSaving(key);
    void controller.saveSettings({ [key]: value } as Partial<VoiceSettings>).then((ok) => {
      setSaving(null);
      if (!ok) Message.error(t('voice.settings.saveFailed'));
    });
  };

  const onShortcutKey = (event: React.KeyboardEvent) => {
    if (event.key === 'Tab') return;
    event.preventDefault();
    const next = shortcutFromEvent(event.nativeEvent);
    if (!next) return;
    setShortcut(next);
    saveVoiceShortcut(next);
  };

  const disabled = !settings;
  const budget = settings
    ? {
        usedUsd: view.budget?.usedUsd ?? settings.used_today_usd ?? 0,
        limitUsd: view.budget?.limitUsd ?? settings.daily_budget_usd,
        warning: Boolean(view.budget?.warning),
      }
    : null;

  return (
    <div className='flex flex-col' data-testid='voice-settings'>
      {loadFailed && !settings && (
        <Typography.Text type='error' role='alert'>
          {t('voice.settings.loadFailed')}
        </Typography.Text>
      )}
      <div className='w-full flex flex-col divide-y divide-border-2'>
        <PreferenceRow label={t('voice.settings.enabled')} description={t('voice.settings.enabledHint')}>
          <Switch
            aria-label={t('voice.settings.enabled')}
            checked={Boolean(settings?.enabled)}
            disabled={disabled}
            loading={saving === 'enabled'}
            onChange={(v) => save('enabled', v)}
          />
        </PreferenceRow>
        <PreferenceRow label={t('voice.settings.engine')}>
          <AionSelect
            aria-label={t('voice.settings.engine')}
            className='min-w-200px'
            value={settings?.engine ?? 'openai-realtime'}
            disabled={disabled}
            onChange={(v: VoiceEngineId) => save('engine', v)}
          >
            {ENGINES.map((e) => (
              <AionSelect.Option key={e.id} value={e.id} disabled={!e.available}>
                {t(e.labelKey)}
                {e.available ? '' : ` (${t('voice.settings.engineLater')})`}
              </AionSelect.Option>
            ))}
          </AionSelect>
        </PreferenceRow>
        <PreferenceRow label={t('voice.settings.wakeWord')} description={t('voice.settings.wakeWordHint')}>
          <Switch
            aria-label={t('voice.settings.wakeWord')}
            checked={settings?.wake_word_enabled !== false}
            disabled={disabled}
            loading={saving === 'wake_word_enabled'}
            onChange={(v) => save('wake_word_enabled', v)}
          />
        </PreferenceRow>
        <PreferenceRow label={t('voice.settings.carMode')} description={t('voice.settings.carModeHint')}>
          <Switch
            aria-label={t('voice.settings.carMode')}
            checked={Boolean(settings?.car_mode)}
            disabled={disabled}
            loading={saving === 'car_mode'}
            onChange={(v) => save('car_mode', v)}
          />
        </PreferenceRow>
        <PreferenceRow label={t('voice.settings.shortcut')}>
          <div className='flex items-center gap-8px'>
            <Input
              aria-label={t('voice.settings.shortcut')}
              className='w-140px'
              readOnly
              value={shortcut}
              placeholder={t('voice.settings.shortcutRecord')}
              onKeyDown={onShortcutKey}
            />
            <Button
              size='small'
              disabled={shortcut === DEFAULT_VOICE_SHORTCUT}
              onClick={() => {
                setShortcut(DEFAULT_VOICE_SHORTCUT);
                saveVoiceShortcut(DEFAULT_VOICE_SHORTCUT);
              }}
            >
              {t('voice.settings.shortcutReset')}
            </Button>
          </div>
        </PreferenceRow>
        {budget && (
          <div className='py-12px'>
            <BudgetMeter budget={budget} />
          </div>
        )}
      </div>
      <Typography.Text type='secondary' className='text-12px pt-8px'>
        {t('voice.settings.privacy')}
      </Typography.Text>
    </div>
  );
};

export default VoiceSettingsPanel;
