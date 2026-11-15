/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A write-only secret field. A stored secret is shown as "Set" or "Not set"
 * (with its last change), never as a value: there is no value to show, the API
 * returns none. Replace opens an empty input; the typed value is sent once and
 * dropped from memory, whatever the outcome. Clear deletes the stored value.
 */

import { Button, Input, Popconfirm, Tag } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { McpMarketSecretStatus } from '@/common/config/storage';
import { describeMarketError, isMaskedValue } from '@/renderer/hooks/mcp/market/marketModel';
import { touchClass, useIsMobileLayout } from './shared';

type SecretFieldBase = {
  secretKey: string;
  required: boolean;
  description?: string;
};

/** Edit mode: a stored slot with its status; changes go to the server at once. */
type SecretFieldEditProps = SecretFieldBase & {
  mode: 'edit';
  status?: McpMarketSecretStatus;
  onReplace: (value: string) => Promise<void>;
  onClear: () => Promise<void>;
};

/** Create mode: the value is part of a new instance's form (sent after the instance exists). */
type SecretFieldCreateProps = SecretFieldBase & {
  mode: 'create';
  value: string;
  onChange: (value: string) => void;
};

export type SecretFieldProps = SecretFieldEditProps | SecretFieldCreateProps;

const SecretLabel: React.FC<SecretFieldBase> = ({ secretKey, required, description }) => {
  const { t } = useTranslation();
  return (
    <div className='flex flex-col gap-2px min-w-0'>
      <span className='flex items-center gap-6px text-13px text-t-primary font-mono break-all'>
        {secretKey}
        {required && (
          <Tag size='small' color='orangered'>
            {t('mcp.market.secret.required')}
          </Tag>
        )}
      </span>
      {description && <span className='text-12px text-t-secondary'>{description}</span>}
    </div>
  );
};

const SecretField: React.FC<SecretFieldProps> = (props) => {
  const { t } = useTranslation();
  const isMobile = useIsMobileLayout();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (props.mode === 'create') {
    const masked = isMaskedValue(props.value);
    return (
      <div className='flex flex-col gap-6px' data-testid={`mcp-secret-${props.secretKey}`}>
        <SecretLabel {...props} />
        <Input.Password
          visibilityToggle={false}
          autoComplete='new-password'
          value={props.value}
          onChange={props.onChange}
          placeholder={t('mcp.market.secret.placeholder')}
          aria-label={props.secretKey}
          className={touchClass(isMobile)}
          status={masked ? 'error' : undefined}
        />
        <span className={masked ? 'text-12px text-danger' : 'text-12px text-t-secondary'}>
          {masked ? t('mcp.market.errors.maskedValue') : t('mcp.market.secret.writeOnlyHint')}
        </span>
      </div>
    );
  }

  const { status, onReplace, onClear } = props;
  const isSet = status?.set === true;

  const close = () => {
    setDraft('');
    setEditing(false);
    setError(null);
  };

  const save = async () => {
    const value = draft;
    if (!value) {
      setError(t('mcp.market.secret.emptyValue'));
      return;
    }
    if (isMaskedValue(value)) {
      setDraft('');
      setError(t('mcp.market.errors.maskedValue'));
      return;
    }
    setBusy(true);
    // The value leaves the component state before the request resolves.
    setDraft('');
    try {
      await onReplace(value);
      close();
    } catch (err) {
      setError(describeMarketError(t, err, 'secret'));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    try {
      await onClear();
    } catch (err) {
      setError(describeMarketError(t, err, 'secret'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='flex flex-col gap-6px' data-testid={`mcp-secret-${props.secretKey}`}>
      <div className='flex flex-wrap items-start justify-between gap-8px'>
        <SecretLabel {...props} />
        <div className='flex items-center gap-6px flex-wrap'>
          <Tag size='small' color={isSet ? 'green' : 'gray'} data-testid='mcp-secret-state'>
            {isSet ? t('mcp.market.secret.set') : t('mcp.market.secret.notSet')}
          </Tag>
          {isSet && status?.updated_at && (
            <span className='text-12px text-t-secondary'>
              {t('mcp.market.secret.changedAt', { date: new Date(status.updated_at).toLocaleString() })}
            </span>
          )}
        </div>
      </div>
      {editing ? (
        <div className='flex flex-col gap-6px'>
          <Input.Password
            visibilityToggle={false}
            autoComplete='new-password'
            autoFocus
            value={draft}
            onChange={setDraft}
            onPressEnter={() => void save()}
            placeholder={t('mcp.market.secret.placeholder')}
            aria-label={props.secretKey}
            className={touchClass(isMobile)}
          />
          <div className='flex gap-8px'>
            <Button
              type='primary'
              size='small'
              loading={busy}
              onClick={() => void save()}
              className={touchClass(isMobile)}
            >
              {t('mcp.market.actions.save')}
            </Button>
            <Button size='small' disabled={busy} onClick={close} className={touchClass(isMobile)}>
              {t('mcp.market.actions.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className='flex gap-8px'>
          <Button size='small' onClick={() => setEditing(true)} disabled={busy} className={touchClass(isMobile)}>
            {isSet ? t('mcp.market.secret.replace') : t('mcp.market.secret.setValue')}
          </Button>
          {isSet && (
            <Popconfirm title={t('mcp.market.secret.clearConfirm')} onOk={() => void clear()}>
              <Button size='small' status='danger' loading={busy} className={touchClass(isMobile)}>
                {t('mcp.market.secret.clear')}
              </Button>
            </Popconfirm>
          )}
        </div>
      )}
      {error && (
        <span role='alert' className='text-12px text-danger'>
          {error}
        </span>
      )}
    </div>
  );
};

export default SecretField;
