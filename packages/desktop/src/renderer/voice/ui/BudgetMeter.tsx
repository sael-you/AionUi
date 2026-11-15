/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Progress, Typography } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { VoiceBudget } from '../core/types';

/** Today's spend vs the daily limit (plan §3.5 budget; warning at 80 %, cap at 100 %). */
const BudgetMeter: React.FC<{ budget: VoiceBudget }> = ({ budget }) => {
  const { t } = useTranslation();
  const ratio = budget.limitUsd > 0 ? Math.min(1, budget.usedUsd / budget.limitUsd) : 0;
  const reached = budget.warning === '100' || (budget.limitUsd > 0 && budget.usedUsd >= budget.limitUsd);
  const warning = reached || budget.warning === '80' || ratio >= 0.8;
  return (
    <section aria-label={t('voice.budget.title')} className='flex flex-col gap-4px'>
      <div className='flex items-center justify-between gap-8px'>
        <Typography.Text type='secondary' className='text-12px'>
          {t('voice.budget.title')}
        </Typography.Text>
        <Typography.Text className='text-12px'>
          {t('voice.budget.usage', { used: budget.usedUsd.toFixed(2), limit: budget.limitUsd.toFixed(2) })}
        </Typography.Text>
      </div>
      <Progress
        percent={Math.round(ratio * 100)}
        showText={false}
        size='small'
        status={warning ? 'warning' : 'normal'}
        aria-label={t('voice.budget.title')}
      />
      {warning && (
        <Typography.Text type='warning' className='text-12px'>
          {reached ? t('voice.budget.reached') : t('voice.budget.warning')}
        </Typography.Text>
      )}
    </section>
  );
};

export default BudgetMeter;
