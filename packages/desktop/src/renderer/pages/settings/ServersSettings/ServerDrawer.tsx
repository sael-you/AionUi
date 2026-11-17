/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Add or edit one server (C36), in the library drawer: the fields, the
 * write-only private key, the host key with its fingerprints, then — for a
 * saved server — Test connection, "Used in" and the latest audited commands.
 * Saving sends only what changed; a new destination asks for its host key.
 */

import { Alert, Button, Input, InputNumber, Message, Modal, Radio, Select, Switch } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SERVER_ENVIRONMENTS,
  SERVER_TIERS,
  type ServerResponse,
  type ServerTestResponse,
} from '@/common/types/platform/serverPools';
import { DrawerBlock, LibraryDrawer } from '@/renderer/components/settings/SettingsModal/library/LibraryParts';
import { useLatestRef } from '@/renderer/hooks/ui/useLatestRef';
import type { StandardProject } from '@/renderer/pages/conversation/GroupedHistory/utils/standardProjects';
import ServerAuditList from './ServerAuditList';
import { HostKeyField, PrivateKeyField } from './ServerKeyFields';
import ServerUsedIn from './ServerUsedIn';
import {
  createRequest,
  describeServerError,
  destinationChanged,
  emptyServerForm,
  serverFormOf,
  updateRequest,
  validateServerForm,
  type ServerFormValues,
} from './serverModel';
import { useServerActions } from './useServers';

export type ServerDrawerTarget = ServerResponse | 'new' | null;

const Field: React.FC<{ label: string; htmlFor?: string; error?: string; children: React.ReactNode }> = ({
  label,
  htmlFor,
  error,
  children,
}) => (
  <div className='flex flex-col gap-4px'>
    <label className='text-12px font-medium text-t-secondary' htmlFor={htmlFor}>
      {label}
    </label>
    {children}
    {error ? (
      <span className='text-12px text-danger' role='alert'>
        {error}
      </span>
    ) : null}
  </div>
);

const ServerDrawer: React.FC<{
  target: ServerDrawerTarget;
  projects: StandardProject[];
  labels: string[];
  isMobile: boolean;
  onClose: () => void;
  onSaved: (server: ServerResponse) => void;
}> = ({ target, projects, labels, isMobile, onClose, onSaved }) => {
  const { t } = useTranslation();
  const actions = useServerActions();
  const existing = target && target !== 'new' ? target : null;
  const [values, setValues] = useState<ServerFormValues>(emptyServerForm);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ServerTestResponse | null>(null);

  // Reset when another server opens (or a new one is started); never pre-fill the key.
  const targetKey = existing ? `${existing.id}:${existing.updated_at}` : target;
  const existingRef = useLatestRef(existing);
  useEffect(() => {
    const current = existingRef.current;
    setValues(current ? serverFormOf(current) : emptyServerForm());
    setTouched(false);
    setTestResult(null);
  }, [targetKey, existingRef]);

  const problems = useMemo(() => validateServerForm(values, existing), [values, existing]);
  const problemOf = (field: keyof ServerFormValues) =>
    touched && problems[field] ? t(`settings.servers.problems.${problems[field]}`) : undefined;
  const set = <K extends keyof ServerFormValues>(key: K, value: ServerFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const moved = existing ? destinationChanged(values, existing) : false;
  const crucialAsks = values.environment === 'production' && values.tier === 'write';

  const save = async () => {
    setTouched(true);
    if (Object.keys(problems).length > 0) return;
    setSaving(true);
    try {
      if (existing) {
        const request = updateRequest(values, existing);
        if (Object.keys(request).length === 0) {
          onClose();
          return;
        }
        const server = await actions.update(existing.id, request);
        Message.success(t('settings.servers.saved', { name: server.name }));
        onSaved(server);
      } else {
        const server = await actions.create(createRequest(values));
        Message.success(t('settings.servers.created', { name: server.name }));
        onSaved(server);
      }
    } catch (error) {
      Message.error(describeServerError(t, error));
    } finally {
      // The typed key is never kept around after a save attempt.
      setValues((current) => ({ ...current, private_key: '' }));
      setSaving(false);
    }
  };

  const scan = async () => {
    try {
      const { host_key } = await actions.scanHostKey(values.host.trim(), Number(values.port) || 22);
      set('host_key', host_key);
    } catch (error) {
      Message.error(describeServerError(t, error));
    }
  };

  const test = async () => {
    if (!existing) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await actions.test(existing.id));
    } catch (error) {
      Message.error(describeServerError(t, error));
    } finally {
      setTesting(false);
    }
  };

  const confirmDelete = () => {
    if (!existing) return;
    Modal.confirm({
      title: t('settings.servers.deleteTitle', { name: existing.name }),
      content: t('settings.servers.deleteBody'),
      okText: t('common.delete'),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        try {
          await actions.remove(existing.id);
          Message.success(t('settings.servers.deleted', { name: existing.name }));
          onClose();
        } catch (error) {
          Message.error(describeServerError(t, error));
        }
      },
    });
  };

  const footer = (
    <div className='flex items-center gap-8px w-full'>
      {existing ? (
        <Button status='danger' onClick={confirmDelete} data-testid='server-delete'>
          {t('common.delete')}
        </Button>
      ) : null}
      <span className='flex-1' />
      <Button onClick={onClose}>{t('common.cancel')}</Button>
      <Button type='primary' loading={saving} onClick={() => void save()} data-testid='server-save'>
        {existing ? t('common.save') : t('settings.servers.add')}
      </Button>
    </div>
  );

  return (
    <LibraryDrawer
      visible={target !== null}
      isMobile={isMobile}
      onClose={onClose}
      testId='server-drawer'
      title={existing ? existing.name : t('settings.servers.addTitle')}
      footer={footer}
    >
      <div className='grid gap-12px' style={{ gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr' }}>
        <Field label={t('settings.servers.fields.name')} htmlFor='server-name' error={problemOf('name')}>
          <Input
            id='server-name'
            value={values.name}
            onChange={(value) => set('name', value.toLowerCase())}
            placeholder='web-1'
            status={problemOf('name') ? 'error' : undefined}
          />
        </Field>
        <Field label={t('settings.servers.fields.user')} htmlFor='server-user' error={problemOf('ssh_user')}>
          <Input
            id='server-user'
            value={values.ssh_user}
            onChange={(value) => set('ssh_user', value)}
            placeholder='deploy'
            status={problemOf('ssh_user') ? 'error' : undefined}
          />
        </Field>
        <Field label={t('settings.servers.fields.host')} htmlFor='server-host' error={problemOf('host')}>
          <Input
            id='server-host'
            value={values.host}
            onChange={(value) => set('host', value)}
            placeholder='203.0.113.10'
            status={problemOf('host') ? 'error' : undefined}
          />
        </Field>
        <Field label={t('settings.servers.fields.port')} htmlFor='server-port' error={problemOf('port')}>
          <InputNumber
            id='server-port'
            min={1}
            max={65535}
            value={Number(values.port) || undefined}
            onChange={(value) => set('port', value === undefined || value === null ? '' : String(value))}
            error={Boolean(problemOf('port'))}
          />
        </Field>
      </div>

      <Field label={t('settings.servers.fields.privateKey')} error={problemOf('private_key')}>
        <PrivateKeyField
          value={values.private_key}
          onChange={(value) => set('private_key', value)}
          stored={Boolean(existing?.has_key)}
          error={problemOf('private_key')}
        />
      </Field>

      <Field label={t('settings.servers.fields.hostKey')} error={problemOf('host_key')}>
        <HostKeyField
          value={values.host_key}
          onChange={(value) => set('host_key', value)}
          onScan={scan}
          canScan={Boolean(values.host.trim()) && !problems.host && !problems.port}
          destinationChanged={moved}
          error={problemOf('host_key')}
        />
      </Field>

      <div className='grid gap-12px' style={{ gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr' }}>
        <Field label={t('settings.servers.fields.environment')}>
          <Select
            value={values.environment}
            onChange={(value: string) => set('environment', value)}
            aria-label={t('settings.servers.fields.environment')}
          >
            {SERVER_ENVIRONMENTS.map((key) => (
              <Select.Option key={key} value={key}>
                {t(`mcp.market.environment.${key}`, { defaultValue: key })}
              </Select.Option>
            ))}
          </Select>
        </Field>
        <Field label={t('settings.servers.fields.tier')}>
          <Radio.Group
            type='button'
            value={values.tier}
            onChange={(value: string) => set('tier', value)}
            aria-label={t('settings.servers.fields.tier')}
          >
            {SERVER_TIERS.map((key) => (
              <Radio key={key} value={key}>
                {t(`mcp.market.tier.${key}`, { defaultValue: key })}
              </Radio>
            ))}
          </Radio.Group>
        </Field>
      </div>
      <Alert
        type={crucialAsks ? 'warning' : 'info'}
        content={
          <div className='flex flex-col gap-4px text-12px'>
            <span>{existing?.tier_note || t('settings.servers.tierNote')}</span>
            {crucialAsks ? <span className='font-medium'>{t('settings.servers.crucialAsks')}</span> : null}
          </div>
        }
        data-testid='server-tier-note'
      />

      <Field label={t('settings.servers.fields.labels')}>
        <Select
          mode='multiple'
          allowCreate
          value={values.labels}
          onChange={(value: string[]) => set('labels', value)}
          placeholder={t('settings.servers.labelsPlaceholder')}
          aria-label={t('settings.servers.fields.labels')}
          options={labels}
        />
      </Field>
      <Field label={t('settings.servers.fields.notes')} htmlFor='server-notes'>
        <Input.TextArea
          id='server-notes'
          value={values.notes}
          onChange={(value) => set('notes', value)}
          autoSize={{ minRows: 2, maxRows: 5 }}
          placeholder={t('settings.servers.notesPlaceholder')}
        />
      </Field>
      <div className='flex items-center justify-between gap-12px'>
        <div className='flex flex-col'>
          <span className='text-13px text-t-primary'>{t('settings.servers.fields.enabled')}</span>
          <span className='text-12px text-t-tertiary'>{t('settings.servers.enabledHint')}</span>
        </div>
        <Switch
          checked={values.enabled}
          onChange={(value) => set('enabled', value)}
          aria-label={t('settings.servers.fields.enabled')}
        />
      </div>

      {existing ? (
        <>
          <DrawerBlock title={t('settings.servers.test.title')}>
            <div className='flex flex-col gap-6px' data-testid='server-test'>
              <Button size='small' className='self-start' loading={testing} onClick={() => void test()}>
                {t('settings.servers.test.run')}
              </Button>
              {testResult ? (
                <Alert
                  type={testResult.ok ? 'success' : 'error'}
                  content={
                    testResult.ok
                      ? t('settings.servers.test.ok', { ms: testResult.latency_ms ?? 0 })
                      : t(`settings.servers.test.errors.${testResult.error_code ?? 'failed'}`, {
                          defaultValue: testResult.message ?? '',
                        })
                  }
                  action={
                    !testResult.ok && testResult.seen_host_key ? (
                      <Button size='mini' onClick={() => set('host_key', testResult.seen_host_key ?? '')}>
                        {t('settings.servers.test.useSeenKey')}
                      </Button>
                    ) : undefined
                  }
                  data-testid='server-test-result'
                />
              ) : null}
            </div>
          </DrawerBlock>
          <DrawerBlock title={t('settings.library.usedIn')}>
            <ServerUsedIn serverId={existing.id} projects={projects} />
          </DrawerBlock>
          <DrawerBlock title={t('settings.servers.audit.title')}>
            <ServerAuditList serverId={existing.id} />
          </DrawerBlock>
        </>
      ) : null}
    </LibraryDrawer>
  );
};

export default ServerDrawer;
