/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Attach an instance: Global, a whole project (native project files) or one
 * assistant in a project (AionUi binding), for one or more CLIs. Mirrors the
 * assignment model (three unique scopes, one row per CLI): CLIs already
 * attached in the chosen scope, or reached through the other channel in the
 * same project (R7), are disabled with the reason; the server still decides.
 */

import { Alert, Checkbox, Modal, Radio, Select } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { McpMarketAssignment, McpMarketInstance } from '@/common/config/storage';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import {
  allowedClis,
  attachConflicts,
  describeMarketError,
  globalBlockReason,
  type AttachScope,
  type MarketProject,
} from '@/renderer/hooks/mcp/market/marketModel';
import type { McpMarketController } from '@/renderer/hooks/mcp/market/useMcpMarket';
import { touchClass, useIsMobileLayout } from './shared';

type ScopeKind = AttachScope['kind'];

/** An instance to attach (from its drawer), or a project to attach an instance to (from the project group). */
export type AttachTarget = { instance?: McpMarketInstance; projectId?: string };

type AttachModalProps = {
  target: AttachTarget | null;
  /** Instances to choose from when the target names a project only. */
  instances: readonly McpMarketInstance[];
  projects: readonly MarketProject[];
  assistants: readonly Assistant[];
  assignments: readonly McpMarketAssignment[];
  market: Pick<McpMarketController, 'attach'>;
  onClose: () => void;
};

const AttachModal: React.FC<AttachModalProps> = ({
  target,
  instances,
  projects,
  assistants,
  assignments,
  market,
  onClose,
}) => {
  const { t } = useTranslation();
  const isMobile = useIsMobileLayout();
  const [pickedId, setPickedId] = useState<string | undefined>(undefined);
  const instance = target?.instance ?? instances.find((i) => i.id === pickedId) ?? null;
  const [kind, setKind] = useState<ScopeKind>('project');
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [assistantId, setAssistantId] = useState<string | undefined>(undefined);
  const [clis, setClis] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attachable = useMemo(() => projects.filter((p) => p.project_id), [projects]);
  const selectableAssistants = useMemo(() => assistants.filter((a) => a.enabled !== false), [assistants]);

  useEffect(() => {
    setPickedId(undefined);
  }, [target]);

  useEffect(() => {
    setError(null);
    setAssistantId(undefined);
    setClis(instance ? allowedClis(instance) : []);
    setProjectId(target?.projectId);
    setKind(target?.projectId ? 'project' : instance && globalBlockReason(instance) === null ? 'global' : 'project');
  }, [target, instance]);

  const scope: AttachScope | null =
    kind === 'global'
      ? { kind: 'global' }
      : kind === 'project'
        ? projectId
          ? { kind: 'project', projectId }
          : null
        : projectId && assistantId
          ? { kind: 'assistant', projectId, assistantId }
          : null;

  const cliOptions = instance ? allowedClis(instance) : [];
  const conflicts = instance && scope ? attachConflicts(instance.id, scope, assignments) : [];
  const blockedClis = new Set(conflicts.map((c) => c.cli));
  // CLIs already attached in this scope (or through the other channel) cannot be chosen again.
  const chosenClis = clis.filter((c) => !blockedClis.has(c));

  if (!target) return null;
  const globalReason = instance ? globalBlockReason(instance) : null;

  const submit = async () => {
    if (!instance || !scope || chosenClis.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await market.attach({
        instance_id: instance.id,
        ...(scope.kind !== 'global' ? { project_id: scope.projectId } : {}),
        ...(scope.kind === 'assistant' ? { assistant_id: scope.assistantId } : {}),
        clis: chosenClis,
      });
      onClose();
    } catch (err) {
      setError(describeMarketError(t, err, 'attach'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible
      title={instance ? t('mcp.market.attach.title', { name: instance.name }) : t('mcp.market.attach.pickTitle')}
      onCancel={onClose}
      onOk={() => void submit()}
      okText={t('mcp.market.actions.attach')}
      cancelText={t('mcp.market.actions.cancel')}
      confirmLoading={busy}
      okButtonProps={{ disabled: !instance || !scope || chosenClis.length === 0, className: touchClass(isMobile) }}
      cancelButtonProps={{ className: touchClass(isMobile) }}
      style={isMobile ? { width: '100%', top: 0 } : { width: 520 }}
      unmountOnExit
    >
      <div className='flex flex-col gap-16px' data-testid='mcp-market-attach'>
        {!target.instance && (
          <div className='flex flex-col gap-6px'>
            <span className='text-13px text-t-primary font-medium'>{t('mcp.market.attach.instance')}</span>
            {instances.length === 0 ? (
              <span className='text-12px text-t-secondary'>{t('mcp.market.attach.noInstances')}</span>
            ) : (
              <Select
                value={pickedId}
                onChange={setPickedId}
                placeholder={t('mcp.market.attach.instancePlaceholder')}
                showSearch
                className={touchClass(isMobile)}
              >
                {instances.map((i) => (
                  <Select.Option key={i.id} value={i.id}>
                    {i.name}
                  </Select.Option>
                ))}
              </Select>
            )}
          </div>
        )}
        <div className='flex flex-col gap-6px'>
          <span className='text-13px text-t-primary font-medium'>{t('mcp.market.attach.scope')}</span>
          <Radio.Group value={kind} onChange={(v: ScopeKind) => setKind(v)} direction='vertical'>
            <Radio value='global' disabled={globalReason !== null} className={touchClass(isMobile)}>
              {t('mcp.market.scope.global')}
            </Radio>
            <Radio value='project' className={touchClass(isMobile)}>
              {t('mcp.market.attach.wholeProject')}
            </Radio>
            <Radio value='assistant' className={touchClass(isMobile)}>
              {t('mcp.market.attach.assistant')}
            </Radio>
          </Radio.Group>
          {globalReason && (
            <span className='text-12px text-t-secondary'>{t(`mcp.market.attach.globalBlocked.${globalReason}`)}</span>
          )}
        </div>

        {kind !== 'global' && (
          <div className='flex flex-col gap-6px'>
            <span className='text-13px text-t-primary font-medium'>{t('mcp.market.attach.project')}</span>
            {attachable.length === 0 ? (
              <span className='text-12px text-t-secondary'>{t('mcp.market.attach.noProjects')}</span>
            ) : (
              <Select
                value={projectId}
                onChange={setProjectId}
                placeholder={t('mcp.market.attach.projectPlaceholder')}
                showSearch
                className={touchClass(isMobile)}
              >
                {attachable.map((p) => (
                  <Select.Option key={p.project_id} value={p.project_id!}>
                    {p.name}
                  </Select.Option>
                ))}
              </Select>
            )}
          </div>
        )}

        {kind === 'assistant' && (
          <div className='flex flex-col gap-6px'>
            <span className='text-13px text-t-primary font-medium'>{t('mcp.market.attach.assistant')}</span>
            <Select
              value={assistantId}
              onChange={setAssistantId}
              placeholder={t('mcp.market.attach.assistantPlaceholder')}
              showSearch
              className={touchClass(isMobile)}
            >
              {selectableAssistants.map((a) => (
                <Select.Option key={a.id} value={a.id}>
                  {a.name}
                </Select.Option>
              ))}
            </Select>
            <span className='text-12px text-t-secondary'>{t('mcp.market.attach.assistantNote')}</span>
          </div>
        )}

        <div className='flex flex-col gap-6px'>
          <span className='text-13px text-t-primary font-medium'>{t('mcp.market.attach.clis')}</span>
          <Checkbox.Group
            value={chosenClis}
            onChange={(v) => setClis([...(v as string[]), ...clis.filter((c) => blockedClis.has(c))])}
          >
            {cliOptions.map((cli) => (
              <Checkbox key={cli} value={cli} disabled={blockedClis.has(cli)}>
                {t(`mcp.market.cli.${cli}`, { defaultValue: cli })}
              </Checkbox>
            ))}
          </Checkbox.Group>
          {instance?.tier === 'write' && (
            <span className='text-12px text-t-secondary'>{t('mcp.market.attach.writeClaudeOnly')}</span>
          )}
          {conflicts.map((c) => (
            <span key={`${c.cli}-${c.reason}`} className='text-12px text-warning' data-testid='mcp-attach-conflict'>
              {t(`mcp.market.attach.conflict.${c.reason}`, {
                cli: t(`mcp.market.cli.${c.cli}`, { defaultValue: c.cli }),
              })}
            </span>
          ))}
        </div>

        {instance && instance.status !== 'active' && (
          <Alert type='info' content={t('mcp.market.attach.notActiveNote')} />
        )}
        {error && <Alert type='error' content={error} />}
      </div>
    </Modal>
  );
};

export default AttachModal;
