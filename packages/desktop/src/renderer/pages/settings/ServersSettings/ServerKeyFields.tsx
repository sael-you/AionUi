/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The two key fields of a server (C36):
 * - the private key, write-only: a stored key is shown as "Stored", never as a
 *   value (the API returns none); Replace opens an empty field;
 * - the host key, with Scan (asks the host now) and the SHA-256 fingerprints to
 *   compare with `ssh-keygen -lf` on the server before trusting it.
 */

import { Alert, Button, Input, Tag } from '@arco-design/web-react';
import { CheckOne } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hostKeyFingerprint, parseHostKeys } from './serverModel';

export const PrivateKeyField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  stored: boolean;
  error?: string;
}> = ({ value, onChange, stored, error }) => {
  const { t } = useTranslation();
  const [replacing, setReplacing] = useState(!stored);

  useEffect(() => {
    setReplacing(!stored);
  }, [stored]);

  if (stored && !replacing) {
    return (
      <div className='flex flex-wrap items-center gap-8px' data-testid='server-key-stored'>
        <Tag size='small' color='green' icon={<CheckOne theme='outline' size='12' />}>
          {t('settings.servers.key.stored')}
        </Tag>
        <Button size='mini' onClick={() => setReplacing(true)} data-testid='server-key-replace'>
          {t('settings.servers.key.replace')}
        </Button>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-4px'>
      <Input.TextArea
        value={value}
        onChange={onChange}
        autoSize={{ minRows: 4, maxRows: 8 }}
        placeholder={t('settings.servers.key.placeholder')}
        aria-label={t('settings.servers.fields.privateKey')}
        status={error ? 'error' : undefined}
        spellCheck={false}
        autoComplete='off'
        className='font-mono !text-12px'
        data-testid='server-key-input'
      />
      <span className='text-12px text-t-tertiary'>{t('settings.servers.key.hint')}</span>
      {stored ? (
        <Button
          size='mini'
          type='text'
          className='self-start'
          onClick={() => {
            onChange('');
            setReplacing(false);
          }}
        >
          {t('settings.servers.key.keepStored')}
        </Button>
      ) : null}
    </div>
  );
};

/** Fingerprints of the host-key lines, computed in the browser. */
const useFingerprints = (text: string): Array<{ type: string; fingerprint: string }> => {
  const [rows, setRows] = useState<Array<{ type: string; fingerprint: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    const lines = parseHostKeys(text);
    void Promise.all(
      lines.map(async (line) => ({ type: line.type, fingerprint: await hostKeyFingerprint(line.base64) }))
    )
      .then((next) => {
        if (!cancelled) setRows(next);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [text]);
  return rows;
};

export const HostKeyField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  onScan: () => Promise<void>;
  canScan: boolean;
  /** The destination changed: the stored host key no longer applies. */
  destinationChanged: boolean;
  error?: string;
}> = ({ value, onChange, onScan, canScan, destinationChanged, error }) => {
  const { t } = useTranslation();
  const [scanning, setScanning] = useState(false);
  const fingerprints = useFingerprints(value);

  return (
    <div className='flex flex-col gap-6px'>
      {destinationChanged ? (
        <Alert type='warning' showIcon content={t('settings.servers.hostKey.destinationChanged')} />
      ) : null}
      <Input.TextArea
        value={value}
        onChange={onChange}
        autoSize={{ minRows: 2, maxRows: 5 }}
        placeholder={t('settings.servers.hostKey.placeholder')}
        aria-label={t('settings.servers.fields.hostKey')}
        status={error ? 'error' : undefined}
        spellCheck={false}
        className='font-mono !text-12px'
        data-testid='server-host-key-input'
      />
      <div className='flex flex-wrap items-center gap-8px'>
        <Button
          size='mini'
          loading={scanning}
          disabled={!canScan}
          onClick={async () => {
            setScanning(true);
            try {
              await onScan();
            } finally {
              setScanning(false);
            }
          }}
          data-testid='server-host-key-scan'
        >
          {t('settings.servers.hostKey.scan')}
        </Button>
        <span className='text-12px text-t-tertiary'>{t('settings.servers.hostKey.hint')}</span>
      </div>
      {fingerprints.length > 0 ? (
        <ul className='m-0 p-0 list-none flex flex-col gap-2px' data-testid='server-host-key-fingerprints'>
          {fingerprints.map((row) => (
            <li key={`${row.type}:${row.fingerprint}`} className='text-12px text-t-secondary break-all'>
              <span className='text-t-tertiary'>{row.type}</span> <span className='font-mono'>{row.fingerprint}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};
