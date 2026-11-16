/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * "Import keys from .mcp.json" (C28 §5): the project's old `.mcp.json` servers
 * with the AionUi catalogue template each maps to and which keys were found
 * (never a value). Only the credentials are imported; the server itself always
 * comes from the template. Pick servers, name each instance, choose
 * environment and tier, import, then test each created instance.
 */

import { Alert, Button, Checkbox, Input, Modal, Select, Tag } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mcpService } from '@/common/adapter/ipcBridge';
import type { KitImportPreviewServer, KitImportResponse, KitImportServerResult } from '@/common/config/storage';
import { describeImportError, describeKitError, importInstanceName } from '@/renderer/hooks/mcp/market/kitModel';
import {
  MCP_MARKET_ENVIRONMENTS,
  describeMarketError,
  instanceNameProblem,
} from '@/renderer/hooks/mcp/market/marketModel';
import { marketTestPayload } from '@/renderer/hooks/mcp/market/useMcpMarket';
import { useKitActions, useKitImportPreview, useKitLibrary } from '@/renderer/hooks/mcp/market/useKits';
import { MarketErrorNotice, touchClass, useIsMobileLayout } from '../market/shared';

const TIERS = ['read', 'write'] as const;

type RowState = { selected: boolean; instanceName: string; environment: string; tier: string };

type TestState = { kind: 'running' } | { kind: 'ok'; tools: number } | { kind: 'failed'; message: string };

const importable = (server: KitImportPreviewServer): boolean =>
  server.match === 'catalogue' && Boolean(server.template_id);

const ServerMatch: React.FC<{ server: KitImportPreviewServer }> = ({ server }) => {
  const { t } = useTranslation();
  if (importable(server))
    return (
      <Tag size='small' color='arcoblue'>
        {server.template_id}
      </Tag>
    );
  return (
    <Tag size='small' color='gray'>
      {t(`mcp.kits.import.match.${server.match === 'custom' ? 'custom' : 'none'}`)}
    </Tag>
  );
};

const SecretsFound: React.FC<{ server: KitImportPreviewServer }> = ({ server }) => {
  const { t } = useTranslation();
  if (server.oauth_only) return <span className='text-12px text-t-secondary'>{t('mcp.kits.import.oauth')}</span>;
  if (server.secrets.length === 0)
    return <span className='text-12px text-t-tertiary'>{t('mcp.kits.import.noKeys')}</span>;
  return (
    <span className='flex flex-wrap gap-4px'>
      {server.secrets.map((secret) => (
        <Tag key={secret.field} size='small' color={secret.found ? 'green' : 'orangered'}>
          {t(secret.found ? 'mcp.kits.import.keyFound' : 'mcp.kits.import.keyMissing', { field: secret.field })}
        </Tag>
      ))}
    </span>
  );
};

const ResultRow: React.FC<{ result: KitImportServerResult; instanceName: string }> = ({ result, instanceName }) => {
  const { t } = useTranslation();
  const isMobile = useIsMobileLayout();
  const [test, setTest] = useState<TestState | null>(null);

  const runTest = async (instanceId: string) => {
    setTest({ kind: 'running' });
    try {
      const now = Date.now();
      const outcome = await mcpService.testMcpConnection.invoke(
        marketTestPayload({ id: instanceId, name: instanceName, created_at: now, updated_at: now })
      );
      setTest(
        outcome.success
          ? { kind: 'ok', tools: outcome.tools?.length ?? 0 }
          : { kind: 'failed', message: outcome.error || t('mcp.market.errors.generic') }
      );
    } catch (testError) {
      setTest({ kind: 'failed', message: describeMarketError(t, testError) });
    }
  };

  return (
    <li className='flex flex-col gap-4px rd-8px border border-border-2 px-12px py-8px' data-testid='kit-import-result'>
      <div className='flex flex-wrap items-center gap-8px'>
        <span className='text-13px font-medium text-t-primary break-all'>{result.name}</span>
        {result.instance_id ? (
          <Tag size='small' color='green'>
            {t('mcp.kits.import.created', { name: instanceName })}
          </Tag>
        ) : (
          <Tag size='small' color='red'>
            {t('mcp.kits.import.failed')}
          </Tag>
        )}
        {result.instance_id ? (
          <Button
            size='mini'
            className={`ms-auto ${touchClass(isMobile)}`}
            disabled={result.missing_secrets.length > 0}
            loading={test?.kind === 'running'}
            aria-label={t('mcp.kits.import.testLabel', { name: instanceName })}
            onClick={() => void runTest(result.instance_id ?? '')}
          >
            {t('mcp.kits.import.test')}
          </Button>
        ) : null}
      </div>
      {result.error_code ? (
        <span className='text-12px text-t-secondary'>{describeImportError(t, result.error_code, result.message)}</span>
      ) : null}
      {result.missing_secrets.length > 0 ? (
        <span className='text-12px text-t-secondary'>
          {t('mcp.kits.import.missingSecrets', { fields: result.missing_secrets.join(', ') })}
        </span>
      ) : null}
      {test?.kind === 'ok' ? (
        <span className='text-12px text-t-secondary' role='status'>
          {t('mcp.kits.import.testOk', { count: test.tools })}
        </span>
      ) : null}
      {test?.kind === 'failed' ? (
        <span className='text-12px text-t-secondary' role='status'>
          {t('mcp.kits.import.testFailed', { detail: test.message })}
        </span>
      ) : null}
    </li>
  );
};

type McpJsonImportModalProps = {
  projectId: string;
  projectName: string;
  visible: boolean;
  onClose: () => void;
};

const McpJsonImportModal: React.FC<McpJsonImportModalProps> = ({ projectId, projectName, visible, onClose }) => {
  const { t } = useTranslation();
  const { preview, error, isLoading } = useKitImportPreview(visible ? projectId : null);
  const library = useKitLibrary();
  const { importKeys } = useKitActions();
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<KitImportResponse | null>(null);

  // Default row state when a preview arrives: importable servers selected, `tb-<template>` names, prod + read.
  useEffect(() => {
    if (!preview) return;
    setRows((previous) =>
      Object.fromEntries(
        preview.servers.map((server) => [
          server.name,
          previous[server.name] ?? {
            selected: importable(server),
            instanceName: server.template_id ? importInstanceName(projectName, server.template_id) : '',
            environment: 'production',
            tier: 'read',
          },
        ])
      )
    );
  }, [preview, projectName]);

  useEffect(() => {
    if (visible) return;
    setRows({});
    setResult(null);
    setImportError(null);
  }, [visible]);

  const servers = preview?.servers ?? [];
  const selected = servers.filter((server) => importable(server) && rows[server.name]?.selected);
  const nameProblems = useMemo(() => {
    const existing = library.instances.map((instance) => instance.name);
    return Object.fromEntries(
      selected.map((server) => {
        const name = rows[server.name]?.instanceName ?? '';
        const others = selected
          .filter((other) => other.name !== server.name)
          .map((other) => rows[other.name]?.instanceName ?? '');
        return [server.name, instanceNameProblem(name, [...existing, ...others])];
      })
    );
  }, [selected, rows, library.instances]);
  const canImport = selected.length > 0 && selected.every((server) => nameProblems[server.name] === null) && !importing;

  const update = (name: string, patch: Partial<RowState>) =>
    setRows((previous) => ({ ...previous, [name]: { ...(previous[name] as RowState), ...patch } }));

  const handleImport = async () => {
    setImporting(true);
    setImportError(null);
    try {
      const response = await importKeys(
        projectId,
        selected.map((server) => {
          const row = rows[server.name] as RowState;
          return {
            name: server.name,
            template_id: server.template_id ?? '',
            instance_name: row.instanceName.trim(),
            environment: row.environment,
            tier: row.tier,
          };
        })
      );
      setResult(response);
    } catch (requestError) {
      setImportError(describeKitError(t, requestError));
    } finally {
      setImporting(false);
    }
  };

  const nameOf = (serverName: string) => rows[serverName]?.instanceName ?? serverName;

  return (
    <Modal
      visible={visible}
      title={t('mcp.kits.import.title')}
      onCancel={onClose}
      unmountOnExit
      autoFocus={false}
      style={{ maxWidth: 'calc(100vw - 32px)', width: 760 }}
      footer={
        result ? (
          <Button onClick={onClose}>{t('common.close')}</Button>
        ) : (
          <>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button type='primary' disabled={!canImport} loading={importing} onClick={() => void handleImport()}>
              {t('mcp.kits.import.submit', { count: selected.length })}
            </Button>
          </>
        )
      }
    >
      <div className='flex flex-col gap-12px' data-testid='kit-import-modal'>
        <p className='m-0 text-12px text-t-secondary'>{t('mcp.kits.import.hint')}</p>
        {error ? <MarketErrorNotice message={describeKitError(t, error)} /> : null}
        {importError ? <Alert type='error' content={importError} /> : null}
        {isLoading ? <div className='text-13px text-t-secondary'>{t('mcp.kits.loading')}</div> : null}
        {preview && !preview.file_found ? (
          <div className='text-13px text-t-secondary' data-testid='kit-import-no-file'>
            {t('mcp.kits.import.noFile')}
          </div>
        ) : null}
        {preview?.file_found && servers.length === 0 ? (
          <div className='text-13px text-t-secondary'>{t('mcp.kits.import.noServers')}</div>
        ) : null}
        {result ? (
          <ul className='m-0 p-0 list-none flex flex-col gap-6px' aria-label={t('mcp.kits.import.resultsLabel')}>
            {result.servers.map((entry) => (
              <ResultRow key={entry.name} result={entry} instanceName={nameOf(entry.name)} />
            ))}
          </ul>
        ) : (
          <ul className='m-0 p-0 list-none flex flex-col gap-6px' aria-label={t('mcp.kits.import.serversLabel')}>
            {servers.map((server) => {
              const row = rows[server.name];
              const canPick = importable(server);
              const problem = canPick && row?.selected ? nameProblems[server.name] : null;
              return (
                <li
                  key={server.name}
                  className='flex flex-col md:flex-row md:items-center gap-8px rd-8px border border-border-2 px-12px py-8px'
                  data-testid='kit-import-row'
                >
                  <Checkbox
                    checked={Boolean(canPick && row?.selected)}
                    disabled={!canPick}
                    aria-label={t('mcp.kits.import.pickLabel', { name: server.name })}
                    onChange={(checked: boolean) => update(server.name, { selected: checked })}
                  >
                    <span className='text-13px font-medium text-t-primary break-all'>{server.name}</span>
                  </Checkbox>
                  <ServerMatch server={server} />
                  <SecretsFound server={server} />
                  {canPick ? (
                    <div className='flex flex-col md:flex-row gap-6px md:ms-auto'>
                      <Input
                        size='small'
                        className='md:w-180px'
                        value={row?.instanceName ?? ''}
                        disabled={!row?.selected}
                        status={problem ? 'error' : undefined}
                        aria-label={t('mcp.kits.import.instanceNameLabel', { name: server.name })}
                        onChange={(value) => update(server.name, { instanceName: value })}
                      />
                      <Select
                        size='small'
                        className='md:w-120px'
                        value={row?.environment}
                        disabled={!row?.selected}
                        aria-label={t('mcp.kits.import.environmentLabel', { name: server.name })}
                        onChange={(value: string) => update(server.name, { environment: value })}
                      >
                        {MCP_MARKET_ENVIRONMENTS.map((environment) => (
                          <Select.Option key={environment} value={environment}>
                            {t(`mcp.market.environment.${environment}`, { defaultValue: environment })}
                          </Select.Option>
                        ))}
                      </Select>
                      <Select
                        size='small'
                        className='md:w-90px'
                        value={row?.tier}
                        disabled={!row?.selected}
                        aria-label={t('mcp.kits.import.tierLabel', { name: server.name })}
                        onChange={(value: string) => update(server.name, { tier: value })}
                      >
                        {TIERS.map((tier) => (
                          <Select.Option key={tier} value={tier}>
                            {t(`mcp.market.tier.${tier}`)}
                          </Select.Option>
                        ))}
                      </Select>
                    </div>
                  ) : null}
                  {problem ? (
                    <span className='text-12px text-t-secondary' role='alert'>
                      {t(`mcp.kits.import.nameProblem.${problem}`)}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
};

export default McpJsonImportModal;
