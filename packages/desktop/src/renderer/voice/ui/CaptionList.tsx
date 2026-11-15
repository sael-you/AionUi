/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Typography } from '@arco-design/web-react';
import classNames from 'classnames';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { VoiceCaption } from '../core/types';
import styles from './voice.module.css';

/** Live captions (always available, plan §4 UX). Speech is English, so text uses `dir="auto"`. */
const CaptionList: React.FC<{ captions: VoiceCaption[] }> = ({ captions }) => {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [captions]);

  return (
    <section aria-label={t('voice.captions.title')}>
      <Typography.Text type='secondary' className='text-12px'>
        {t('voice.captions.title')}
      </Typography.Text>
      <div ref={listRef} className={styles.captions} role='log' aria-live='polite' aria-relevant='additions text'>
        {captions.length === 0 ? (
          <Typography.Text type='secondary'>{t('voice.captions.empty')}</Typography.Text>
        ) : (
          captions.map((c) => (
            <p key={c.id} className={classNames(styles.caption, !c.final && styles.captionPartial)} dir='auto'>
              <Typography.Text bold>{t(`voice.captions.role.${c.role}`)}: </Typography.Text>
              <span>{c.text}</span>
            </p>
          ))
        )}
      </div>
    </section>
  );
};

export default CaptionList;
