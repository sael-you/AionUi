/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Create or edit a browser profile (TASK-124): its name (1–40 characters, unique),
 * a colour from the project palette (or none) and an optional emoji. The server
 * checks everything again; its refusals come back as messages here.
 */

import { Input, Modal, Radio, Select } from '@arco-design/web-react';
import classNames from 'classnames';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BROWSER_PROFILE_COLORS,
  BROWSER_PROFILE_NAME_MAX,
  type BrowserEngineStatus,
  type BrowserInstanceFields,
  type BrowserInstanceSettings,
} from '@/common/types/platform/serverBrowser';
import { useProfileAccent } from './BrowserProfileLabel';

/** Emoji field limit (the server allows ≤ 16 bytes). */
const EMOJI_MAX_BYTES = 16;

export type BrowserProfileDraft = { name: string; color: string; emoji: string; engine?: string };

/** Chrome is every profile's engine until another is chosen (C35). */
export const DEFAULT_ENGINE = 'chrome';

/** The fields to send: `""` clears colour/emoji on an existing profile, a new one just omits them. */
export const profileFields = (
  draft: BrowserProfileDraft,
  existing: boolean
): BrowserInstanceFields & { name: string } => {
  const name = draft.name.trim();
  const emoji = draft.emoji.trim();
  const engine = draft.engine ? { engine: draft.engine } : {};
  if (existing) return { name, color: draft.color, emoji, ...engine };
  return { name, ...(draft.color ? { color: draft.color } : {}), ...(emoji ? { emoji } : {}), ...engine };
};

/** Why the draft cannot be saved yet, or `null`. */
export const profileDraftProblem = (
  draft: BrowserProfileDraft
): 'nameRequired' | 'nameTooLong' | 'emojiTooLong' | null => {
  const name = draft.name.trim();
  if (!name) return 'nameRequired';
  if ([...name].length > BROWSER_PROFILE_NAME_MAX) return 'nameTooLong';
  if (new TextEncoder().encode(draft.emoji.trim()).length > EMOJI_MAX_BYTES) return 'emojiTooLong';
  return null;
};

const Swatch: React.FC<{ color: string }> = ({ color }) => {
  const accent = useProfileAccent(color);
  return (
    <span
      className='inline-block size-14px rd-full border border-solid border-3 align-middle'
      style={accent ? { background: accent, borderColor: accent } : undefined}
      aria-hidden
    />
  );
};

type BrowserProfileModalProps = {
  /** `null` = closed; `'new'` = create; a profile = edit it. */
  target: BrowserInstanceSettings | 'new' | null;
  saving: boolean;
  /** Engines AionCore knows (C35); absent or empty = no engine choice (older AionCore). */
  engines?: BrowserEngineStatus[];
  onSave: (draft: BrowserProfileDraft) => void;
  onClose: () => void;
};

const BrowserProfileModal: React.FC<BrowserProfileModalProps> = ({ target, saving, engines, onSave, onClose }) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<BrowserProfileDraft>({ name: '', color: '', emoji: '' });

  useEffect(() => {
    if (!target) return;
    setDraft(
      target === 'new'
        ? { name: '', color: '', emoji: '' }
        : { name: target.name, color: target.color ?? '', emoji: target.emoji ?? '', engine: target.engine }
    );
  }, [target]);

  const problem = profileDraftProblem(draft);
  const update = (patch: Partial<BrowserProfileDraft>) => setDraft((current) => ({ ...current, ...patch }));

  return (
    <Modal
      visible={target !== null}
      title={
        target === 'new' ? t('settings.serverBrowser.profile.addTitle') : t('settings.serverBrowser.profile.editTitle')
      }
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      confirmLoading={saving}
      okButtonProps={{ disabled: problem !== null }}
      onOk={() => onSave(draft)}
      onCancel={onClose}
      unmountOnExit
      style={{ maxWidth: 'calc(100vw - 32px)', width: 480 }}
    >
      <div className='flex flex-col gap-14px' data-testid='browser-profile-modal'>
        <label className='flex flex-col gap-6px'>
          <span className='text-13px text-t-secondary'>{t('settings.serverBrowser.profile.name')}</span>
          <Input
            value={draft.name}
            maxLength={BROWSER_PROFILE_NAME_MAX}
            placeholder={t('settings.serverBrowser.profile.namePlaceholder')}
            status={problem === 'nameTooLong' ? 'error' : undefined}
            onChange={(value) => update({ name: value })}
            onPressEnter={() => {
              if (!problem) onSave(draft);
            }}
          />
        </label>
        <div className='flex flex-col gap-6px'>
          <span id='browser-profile-color' className='text-13px text-t-secondary'>
            {t('settings.serverBrowser.profile.color')}
          </span>
          <Radio.Group
            className='flex flex-wrap items-center gap-6px'
            value={draft.color}
            aria-labelledby='browser-profile-color'
            onChange={(value: string) => update({ color: value })}
          >
            <Radio value='' className='!m-0'>
              {({ checked }) => (
                <span
                  className={classNames(
                    'inline-flex h-24px items-center rd-12px border border-solid px-10px text-12px text-t-primary',
                    checked ? 'border-primary-6 bg-fill-2' : 'border-3'
                  )}
                >
                  {t('settings.serverBrowser.profile.noColor')}
                </span>
              )}
            </Radio>
            {BROWSER_PROFILE_COLORS.map((color) => (
              <Radio key={color} value={color} className='!m-0'>
                {({ checked }) => (
                  <span
                    className={classNames(
                      'inline-flex size-24px items-center justify-center rd-full border-[2px] border-solid',
                      checked ? 'border-primary-6' : 'border-transparent'
                    )}
                  >
                    <Swatch color={color} />
                    <span className='sr-only'>{t(`conversation.history.projectColors.${color}`)}</span>
                  </span>
                )}
              </Radio>
            ))}
          </Radio.Group>
        </div>
        <label className='flex flex-col gap-6px'>
          <span className='text-13px text-t-secondary'>{t('settings.serverBrowser.profile.emoji')}</span>
          <Input
            className='w-120px'
            value={draft.emoji}
            placeholder='🎮'
            status={problem === 'emojiTooLong' ? 'error' : undefined}
            onChange={(value) => update({ emoji: value })}
          />
        </label>
        {engines && engines.length > 0 ? (
          <div className='flex flex-col gap-6px'>
            <span id='browser-profile-engine' className='text-13px text-t-secondary'>
              {t('settings.serverBrowser.profile.engine')}
            </span>
            <Select
              value={draft.engine ?? DEFAULT_ENGINE}
              aria-labelledby='browser-profile-engine'
              onChange={(value: string) => update({ engine: value })}
              data-testid='browser-profile-engine'
            >
              {engines.map((entry) => {
                const current = (draft.engine ?? DEFAULT_ENGINE) === entry.engine;
                const notes = [
                  entry.installed_version ? null : t('settings.serverBrowser.profile.engineNotDownloaded'),
                  entry.agents_only ? t('settings.devices.engine.agentsOnly') : null,
                ].filter(Boolean);
                return (
                  // An engine is downloaded on the Devices page first; the profile's own stays selectable.
                  <Select.Option
                    key={entry.engine}
                    value={entry.engine}
                    disabled={!entry.installed_version && !current}
                  >
                    {t(`settings.devices.engine.names.${entry.engine}`, { defaultValue: entry.engine })}
                    {notes.length > 0 ? ` (${notes.join(', ')})` : ''}
                  </Select.Option>
                );
              })}
            </Select>
            <span className='text-12px text-t-secondary'>{t('settings.serverBrowser.profile.engineHint')}</span>
          </div>
        ) : null}
        {problem && problem !== 'nameRequired' ? (
          <span className='text-12px text-t-secondary' role='alert'>
            {t(`settings.serverBrowser.profile.errors.${problem}`, { max: BROWSER_PROFILE_NAME_MAX })}
          </span>
        ) : null}
      </div>
    </Modal>
  );
};

export default BrowserProfileModal;
