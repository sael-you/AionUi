/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One instance in full: template, status and rule problems, where it is
 * attached (detach per CLI), plain env values, write-only secrets, the tool
 * allow/block list from the last connection test, and the lifecycle actions
 * (test, activate, make dormant, revoke, duplicate, template refresh, delete),
 * each destructive one behind a confirmation. Full-screen sheet on mobile.
 */

import { Alert, Button, Checkbox, Drawer, Input, Message, Modal, Select, Tag } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  McpMarketTemplateRefreshResult,
  McpMarketAssignment,
  McpMarketInstance,
  McpMarketInstanceHealth,
  McpMarketTemplate,
} from '@/common/config/storage';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { formatThrownMcpErrorMessage, formatMcpErrorMessage } from '@/renderer/hooks/mcp/useMcpConnection';
import {
  describeMarketError,
  forcedPlainEnv,
  plainKeys,
  summarizeAttachments,
  missingSecretKeysOf,
  pendingTemplateSecretKeys,
  templateUpdate,
  type MarketProject,
} from '@/renderer/hooks/mcp/market/marketModel';
import type { McpMarketController } from '@/renderer/hooks/mcp/market/useMcpMarket';
import ActivateModal from './ActivateModal';
import SecretField from './SecretField';
import { CliTag, MarketStatusTag, ScopeLabel, TemplateUpdateBadge, touchClass, useIsMobileLayout } from './shared';

type ConfirmKind = 'revoke' | 'delete' | 'dormant' | 'refresh';

type InstanceDrawerProps = {
  instance: McpMarketInstance | null;
  template?: McpMarketTemplate;
  health?: McpMarketInstanceHealth;
  assignments: readonly McpMarketAssignment[];
  projects: readonly MarketProject[];
  assistants: readonly Assistant[];
  market: McpMarketController;
  onClose: () => void;
  onAttach: (instance: McpMarketInstance) => void;
  onDuplicate: (instance: McpMarketInstance) => void;
};

const Section: React.FC<{ title: string; children: React.ReactNode; testId?: string }> = ({
  title,
  children,
  testId,
}) => (
  <section className='flex flex-col gap-8px' data-testid={testId}>
    <h3 className='m-0 text-13px text-t-primary font-semibold'>{title}</h3>
    {children}
  </section>
);

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].toSorted().every((x, i) => x === [...b].toSorted()[i]);

const InstanceDrawer: React.FC<InstanceDrawerProps> = ({
  instance,
  template,
  health,
  assignments,
  projects,
  assistants,
  market,
  onClose,
  onAttach,
  onDuplicate,
}) => {
  const { t } = useTranslation();
  const isMobile = useIsMobileLayout();
  const touch = touchClass(isMobile);
  const [plainEnv, setPlainEnv] = useState<Record<string, string>>({});
  const [tools, setTools] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [activating, setActivating] = useState(false);
  const [refreshResult, setRefreshResult] = useState<McpMarketTemplateRefreshResult | null>(null);
  /** Keys a refused refresh named (409 MCP_TEMPLATE_SECRET_MISSING). */
  const [refreshNeeds, setRefreshNeeds] = useState<string[]>([]);
  /** Secrets of the pending template set in this drawer (the instance lists only its snapshot's keys). */
  const [pendingSet, setPendingSet] = useState<string[]>([]);

  const isWrite = instance?.tier === 'write';
  const storedTools = useMemo(
    () => (instance ? (isWrite ? instance.tools_block : (instance.tools_allow ?? [])) : []),
    [instance, isWrite]
  );

  useEffect(() => {
    setPlainEnv(instance?.plain_env ?? {});
    setTools(storedTools);
    setError(null);
  }, [instance, storedTools]);

  useEffect(() => {
    setConfirm(null);
    setActivating(false);
    setRefreshResult(null);
    setRefreshNeeds([]);
    setPendingSet([]);
  }, [instance?.id]);

  if (!instance) return null;

  const forced = template ? forcedPlainEnv(template, instance.tier) : {};
  const envKeys = [
    ...new Set([...(template ? plainKeys(template) : []), ...Object.keys(instance.plain_env)]),
  ].toSorted();
  const envDirty = envKeys.some((key) => (plainEnv[key] ?? '') !== (instance.plain_env[key] ?? ''));
  const toolsDirty = !sameList(tools, storedTools);
  const attachments = summarizeAttachments(instance.id, assignments);
  const update = templateUpdate(instance);
  const pendingSecrets = [...new Set([...pendingTemplateSecretKeys(instance, template), ...refreshNeeds])].filter(
    (key) => !instance.secrets.some((s) => s.key === key)
  );

  const run = async (
    key: string,
    action: () => Promise<unknown>,
    context: Parameters<typeof describeMarketError>[2]
  ) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(describeMarketError(t, err, context));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const saveEnv = () =>
    run(
      'env',
      () =>
        market.updateInstance(instance.id, {
          plain_env: Object.fromEntries(
            Object.entries(plainEnv).filter(([key, value]) => value.trim() !== '' && !(key in forced))
          ),
        }),
      'generic'
    );

  const saveTools = () =>
    run(
      'tools',
      () => market.updateInstance(instance.id, isWrite ? { tools_block: tools } : { tools_allow: tools }),
      'generic'
    );

  const test = async () => {
    setBusy('test');
    setError(null);
    const result = await market.testConnection(instance);
    setBusy(null);
    if (result.kind === 'ok') {
      Message.success(t('mcp.market.test.success', { count: result.tools.length }));
      return;
    }
    const failure = result.error;
    // A 200 with `success: false` carries the same {error, code, details} as a thrown backend error.
    setError(
      failure && typeof failure === 'object' && 'success' in failure
        ? formatMcpErrorMessage(t, failure as { error?: string; code?: string; details?: unknown })
        : formatThrownMcpErrorMessage(t, failure)
    );
  };

  const confirmAction = async () => {
    const kind = confirm;
    if (!kind) return;
    let ok = false;
    if (kind === 'revoke') ok = await run('revoke', () => market.revoke(instance.id), 'generic');
    if (kind === 'dormant') ok = await run('dormant', () => market.deactivate(instance.id), 'generic');
    if (kind === 'refresh') {
      setBusy('refresh');
      setError(null);
      setRefreshResult(null);
      try {
        setRefreshResult(await market.refreshTemplate(instance.id));
        setRefreshNeeds([]);
        ok = true;
      } catch (err) {
        // "Set <key> first": the keys get a secret field below.
        setRefreshNeeds(missingSecretKeysOf(err));
        setError(describeMarketError(t, err, 'refresh'));
      } finally {
        setBusy(null);
      }
    }
    if (kind === 'delete') {
      ok = await run('delete', () => market.remove(instance.id), 'generic');
      if (ok) onClose();
    }
    if (ok || kind !== 'delete') setConfirm(null);
  };

  const footer = (
    <div className='flex flex-wrap gap-8px' data-testid='mcp-market-drawer-actions'>
      <Button loading={busy === 'test'} onClick={() => void test()} className={touch}>
        {t('mcp.market.actions.test')}
      </Button>
      {instance.status === 'active' ? (
        <Button onClick={() => setConfirm('dormant')} className={touch}>
          {t('mcp.market.actions.makeDormant')}
        </Button>
      ) : (
        <Button type='primary' onClick={() => setActivating(true)} className={touch}>
          {t('mcp.market.actions.activate')}
        </Button>
      )}
      {instance.status !== 'revoked' && (
        <Button status='warning' onClick={() => setConfirm('revoke')} className={touch}>
          {t('mcp.market.actions.revoke')}
        </Button>
      )}
      <Button onClick={() => onAttach(instance)} className={touch}>
        {t('mcp.market.actions.attach')}
      </Button>
      <Button onClick={() => onDuplicate(instance)} className={touch}>
        {t('mcp.market.actions.duplicate')}
      </Button>
      {update && (
        <Button onClick={() => setConfirm('refresh')} className={touch} data-testid='mcp-market-refresh'>
          {t('mcp.market.actions.refreshTemplate')}
        </Button>
      )}
      <Button status='danger' onClick={() => setConfirm('delete')} className={touch}>
        {t('mcp.market.actions.delete')}
      </Button>
    </div>
  );

  return (
    <>
      <Drawer
        visible
        width={isMobile ? '100%' : 560}
        title={
          <span className='flex flex-wrap items-center gap-8px'>
            <span className='font-mono break-all'>{instance.name}</span>
            <MarketStatusTag status={instance.status} />
          </span>
        }
        onCancel={onClose}
        footer={footer}
        unmountOnExit
        data-testid='mcp-market-drawer'
      >
        <div className='flex flex-col gap-20px'>
          <div className='flex flex-col gap-6px'>
            <span className='text-13px text-t-secondary'>
              {t('mcp.market.instance.fromTemplate', { template: template?.name ?? instance.template_id })}
              {instance.template_version ? ` · ${instance.template_version}` : ''}
            </span>
            <div className='flex flex-wrap gap-6px'>
              <Tag size='small' color={isWrite ? 'orangered' : 'arcoblue'}>
                {t(`mcp.market.tier.${instance.tier}`, { defaultValue: instance.tier })}
              </Tag>
              <Tag size='small'>
                {t(`mcp.market.environment.${instance.environment}`, { defaultValue: instance.environment })}
              </Tag>
              <Tag size='small'>{t('mcp.market.instance.enforcement', { value: instance.enforcement })}</Tag>
              {instance.approval_ref && (
                <Tag size='small' color='green'>
                  {t('mcp.market.instance.approvalRecorded')}
                </Tag>
              )}
            </div>
            {instance.description && <p className='m-0 text-13px text-t-secondary'>{instance.description}</p>}
            {isWrite && <Alert type='warning' content={t('mcp.market.instance.writeNote')} />}
            <TemplateUpdateBadge instance={instance} />
            {!instance.template_in_catalogue && (
              <Alert type='warning' content={t('mcp.market.template.notInCatalogue')} />
            )}
          </div>

          {refreshResult && (
            <Alert
              type='success'
              closable
              onClose={() => setRefreshResult(null)}
              data-testid='mcp-market-refresh-result'
              content={
                <div className='flex flex-col gap-4px'>
                  <span>
                    {refreshResult.changed
                      ? t('mcp.market.template.refreshed', {
                          from: refreshResult.from_version ?? '—',
                          to: refreshResult.to_version ?? '—',
                        })
                      : t('mcp.market.template.unchanged')}
                  </span>
                  {refreshResult.added_keys.length > 0 && (
                    <span>{t('mcp.market.template.added', { keys: refreshResult.added_keys.join(', ') })}</span>
                  )}
                  {refreshResult.removed_keys.length > 0 && (
                    <span>{t('mcp.market.template.removed', { keys: refreshResult.removed_keys.join(', ') })}</span>
                  )}
                </div>
              }
            />
          )}

          {error && <Alert type='error' content={error} closable onClose={() => setError(null)} />}

          {(health?.problems.length ?? 0) > 0 && (
            <Section title={t('mcp.market.instance.problemsTitle')}>
              <ul className='m-0 ps-16px text-12px text-t-secondary flex flex-col gap-4px'>
                {health!.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Section>
          )}

          <Section title={t('mcp.market.instance.attachedTo')} testId='mcp-market-drawer-attachments'>
            {attachments.length === 0 ? (
              <span className='text-12px text-t-tertiary'>{t('mcp.market.instance.notAttached')}</span>
            ) : (
              attachments.map((a) => (
                <div key={a.key} className='flex flex-wrap items-center gap-6px'>
                  <ScopeLabel scope={a.scope} projects={projects} assistants={assistants} />
                  {a.clis.map((c) => (
                    <CliTag
                      key={c.assignmentId}
                      cli={c.cli}
                      closable
                      onClose={() => void run('detach', () => market.detach([c.assignmentId]), 'attach')}
                    />
                  ))}
                  <Button
                    size='mini'
                    type='text'
                    loading={busy === 'detach'}
                    onClick={() => void run('detach', () => market.detach(a.clis.map((c) => c.assignmentId)), 'attach')}
                    className={touch}
                  >
                    {t('mcp.market.actions.detach')}
                  </Button>
                </div>
              ))
            )}
          </Section>

          {envKeys.length > 0 && (
            <Section title={t('mcp.market.create.plainEnv')} testId='mcp-market-drawer-env'>
              {envKeys.map((key) => {
                const field = template?.env[key];
                const isForced = key in forced;
                const id = `mcp-market-drawer-env-${key}`;
                return (
                  <div key={key} className='flex flex-col gap-4px'>
                    <label htmlFor={id} className='text-12px text-t-primary font-mono'>
                      {field?.required ? `${key} *` : key}
                    </label>
                    {field?.enum && field.enum.length > 0 ? (
                      <Select
                        id={id}
                        value={plainEnv[key]}
                        disabled={isForced}
                        onChange={(v: string | undefined) => setPlainEnv((prev) => ({ ...prev, [key]: v ?? '' }))}
                        className={touch}
                      >
                        {field.enum.map((option) => (
                          <Select.Option key={option} value={option}>
                            {option}
                          </Select.Option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        id={id}
                        value={plainEnv[key] ?? ''}
                        disabled={isForced}
                        autoComplete='off'
                        onChange={(v) => setPlainEnv((prev) => ({ ...prev, [key]: v }))}
                        className={touch}
                      />
                    )}
                    {(isForced || field?.description) && (
                      <span className='text-12px text-t-secondary'>
                        {isForced ? t('mcp.market.create.forcedByTier', { tier: instance.tier }) : field?.description}
                      </span>
                    )}
                  </div>
                );
              })}
              <div>
                <Button
                  type='primary'
                  size='small'
                  disabled={!envDirty}
                  loading={busy === 'env'}
                  onClick={() => void saveEnv()}
                  className={touch}
                >
                  {t('mcp.market.actions.save')}
                </Button>
              </div>
            </Section>
          )}

          {instance.secrets.length > 0 && (
            <Section title={t('mcp.market.create.secrets')} testId='mcp-market-drawer-secrets'>
              {instance.secrets.map((s) => (
                <SecretField
                  key={s.key}
                  mode='edit'
                  secretKey={s.key}
                  required={s.required}
                  description={template?.env[s.key]?.description}
                  status={s}
                  onReplace={(value) => market.setSecret(instance.id, s.key, value)}
                  onClear={() => market.clearSecret(instance.id, s.key)}
                />
              ))}
            </Section>
          )}

          {update && pendingSecrets.length > 0 && (
            <Section title={t('mcp.market.template.pendingSecretsTitle')} testId='mcp-market-drawer-pending-secrets'>
              <span className='text-12px text-t-secondary'>{t('mcp.market.template.pendingSecretsHint')}</span>
              {pendingSecrets.map((key) => (
                <SecretField
                  key={key}
                  mode='edit'
                  secretKey={key}
                  required={template?.env[key]?.required === true || refreshNeeds.includes(key)}
                  description={template?.env[key]?.description}
                  status={{
                    key,
                    name: '',
                    instance_id: instance.id,
                    instance_name: instance.name,
                    required: template?.env[key]?.required === true,
                    set: pendingSet.includes(key),
                  }}
                  onReplace={async (value) => {
                    await market.setSecret(instance.id, key, value);
                    setPendingSet((prev) => (prev.includes(key) ? prev : [...prev, key]));
                  }}
                  onClear={async () => {
                    await market.clearSecret(instance.id, key);
                    setPendingSet((prev) => prev.filter((k) => k !== key));
                  }}
                />
              ))}
            </Section>
          )}

          <Section
            title={isWrite ? t('mcp.market.tools.blockTitle') : t('mcp.market.tools.allowTitle')}
            testId='mcp-market-drawer-tools'
          >
            <span className='text-12px text-t-secondary'>
              {isWrite ? t('mcp.market.tools.blockHint') : t('mcp.market.tools.allowHint')}
            </span>
            {instance.tools_seen.length === 0 ? (
              <span className='text-12px text-t-tertiary'>{t('mcp.market.tools.none')}</span>
            ) : (
              <>
                <Checkbox.Group direction='vertical' value={tools} onChange={(v) => setTools(v as string[])}>
                  {instance.tools_seen.map((tool) => (
                    <Checkbox key={tool} value={tool}>
                      <span className='font-mono text-12px'>{tool}</span>
                      {template?.tool_classes?.[tool] === 'write' && (
                        <Tag size='small' color='orangered' className='ms-6px'>
                          {t('mcp.market.tier.write')}
                        </Tag>
                      )}
                    </Checkbox>
                  ))}
                </Checkbox.Group>
                <div>
                  <Button
                    type='primary'
                    size='small'
                    disabled={!toolsDirty}
                    loading={busy === 'tools'}
                    onClick={() => void saveTools()}
                    className={touch}
                  >
                    {t('mcp.market.actions.save')}
                  </Button>
                </div>
              </>
            )}
          </Section>
        </div>
      </Drawer>

      {activating && (
        <ActivateModal
          instance={instance}
          onCancel={() => setActivating(false)}
          onConfirm={async () => {
            await market.activate(instance.id);
            setActivating(false);
          }}
        />
      )}

      <Modal
        visible={confirm !== null}
        title={confirm ? t(`mcp.market.confirm.${confirm}.title`, { name: instance.name }) : ''}
        onCancel={() => setConfirm(null)}
        onOk={() => void confirmAction()}
        okText={confirm ? t(`mcp.market.confirm.${confirm}.ok`) : ''}
        cancelText={t('mcp.market.actions.cancel')}
        confirmLoading={busy !== null && busy === confirm}
        okButtonProps={{
          status: confirm === 'delete' || confirm === 'revoke' ? 'danger' : undefined,
          className: touch,
        }}
        cancelButtonProps={{ className: touch }}
        style={isMobile ? { width: '100%' } : undefined}
        unmountOnExit
      >
        {confirm && <p className='m-0 text-14px text-t-primary'>{t(`mcp.market.confirm.${confirm}.body`)}</p>}
        {confirm && error && <Alert type='error' content={error} className='mt-12px' />}
      </Modal>
    </>
  );
};

export default InstanceDrawer;
