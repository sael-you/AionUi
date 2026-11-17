/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { Attention } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

/** "Not sent — saved as draft · Retry" above the composer (TASK-127). */
const UnsentMessageBanner: React.FC<{ retrying: boolean; autoRetry: boolean; onRetry: () => void }> = ({
  retrying,
  autoRetry,
  onRetry,
}) => {
  const { t } = useTranslation();
  return (
    <div
      role='status'
      className='flex items-center gap-8px mb-6px px-10px py-6px rd-8px bg-warning-light-1 text-13px text-t-primary'
      data-testid='unsent-message-banner'
    >
      <Attention theme='outline' size='14' className='flex-shrink-0 text-warning-6' aria-hidden />
      <span className='flex-1 min-w-0'>
        {t('conversation.unsent.notSent')}
        {autoRetry ? <span className='text-t-secondary'> · {t('conversation.unsent.autoRetry')}</span> : null}
      </span>
      <Button size='mini' type='outline' loading={retrying} onClick={onRetry} data-testid='unsent-message-retry'>
        {t('conversation.unsent.retry')}
      </Button>
    </div>
  );
};

export default UnsentMessageBanner;
