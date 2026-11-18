/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one-time import of existing rule files (C37), in two deliberate steps:
 * 1. Preview the files of a scope (the container's global AGENTS.md, or a
 *    project's) and the rules they would become — nothing is written — then
 *    Import: the rules are created and attached at that scope; files untouched.
 * 2. Hand the imported files over to AionUi (owner ticks what will happen):
 *    Global — the file is generated from the Global rules from now on;
 *    project — the repo file becomes a one-line pointer. AionUi never commits
 *    or pushes.
 */

import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Message,
  Modal,
  Radio,
  Select,
  Skeleton,
  Tag,
} from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuleImportFile, RuleImportScope } from '@/common/types/platform/rules';
import MarkdownView from '@/renderer/components/Markdown';
import type { StandardProject } from '@/renderer/pages/conversation/GroupedHistory/utils/standardProjects';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { describeRuleError, formatBytes } from './ruleModel';
import { useRuleActions, useRuleImportPreview, useRuleSources } from './useRules';

const STATUS_COLORS: Record<string, string> = {
  new: 'arcoblue',
  imported: 'green',
  managed: 'gray',
  pointer: 'gray',
  missing: 'gray',
  refused: 'red',
};

const FileRow: React.FC<{ file: RuleImportFile }> = ({ file }) => {
  const { t } = useTranslation();
  return (
    <li className='flex flex-col gap-6px rd-8px border border-solid border-3 p-10px' data-testid='rule-import-file'>
      <div className='flex flex-wrap items-center gap-6px'>
        <code className='flex-1 min-w-0 break-all text-12px text-t-primary'>{file.path}</code>
        <Tag size='small' color={STATUS_COLORS[file.status]}>
          {t(`settings.rules.import.status.${file.status}`, { defaultValue: file.status })}
        </Tag>
        {file.bytes > 0 ? <span className='text-12px text-t-tertiary'>{formatBytes(file.bytes)}</span> : null}
      </div>
      {file.status === 'new' && file.rules.length > 0 ? (
        <Collapse bordered={false} className='!bg-transparent'>
          {file.rules.map((rule, index) => (
            <Collapse.Item
              key={`${rule.name}:${index}`}
              name={`${index}`}
              header={
                <span className='flex flex-wrap items-center gap-6px'>
                  <span className='text-13px text-t-primary'>{rule.name}</span>
                  <span className='text-12px text-t-tertiary'>{formatBytes(rule.bytes)}</span>
                  {rule.name_taken ? (
                    <Tag size='small' color='orange'>
                      {t('settings.rules.import.nameTaken')}
                    </Tag>
                  ) : null}
                </span>
              }
            >
              <div className='max-h-280px overflow-auto text-13px'>
                <MarkdownView>{rule.body}</MarkdownView>
              </div>
            </Collapse.Item>
          ))}
        </Collapse>
      ) : null}
    </li>
  );
};

const RuleImportModal: React.FC<{
  visible: boolean;
  projects: StandardProject[];
  /** The page's scope: the modal starts there. */
  initialProjectId: string | null;
  onClose: () => void;
}> = ({ visible, projects, initialProjectId, onClose }) => {
  const { t } = useTranslation();
  const actions = useRuleActions();
  const [scope, setScope] = useState<RuleImportScope>(initialProjectId ? 'project' : 'global');
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const [busy, setBusy] = useState<'import' | 'manage' | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  /** Core's line diff (or reason) when a file changed since its import: nothing was written. */
  const [fileChanged, setFileChanged] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setScope(initialProjectId ? 'project' : 'global');
    setProjectId(initialProjectId);
    setAcknowledged(false);
    setFileChanged(null);
  }, [visible, initialProjectId]);

  const ready = visible && (scope === 'global' || Boolean(projectId));
  const { preview, error, isLoading } = useRuleImportPreview(ready ? scope : null, projectId);
  const { sources } = useRuleSources();

  const files = preview?.files ?? [];
  const newRules = files.filter((file) => file.status === 'new').flatMap((file) => file.rules);
  const blocked = newRules.some((rule) => rule.name_taken);
  // Files already imported (not yet handed over) for this scope.
  const handOver = sources.filter(
    (source) =>
      source.status === 'imported' && source.scope === scope && (scope === 'global' || source.project_id === projectId)
  );

  const runImport = async () => {
    setBusy('import');
    try {
      const result = await actions.importScope(scope, projectId);
      Message.success(t('settings.rules.import.imported', { count: result.rules.length }));
    } catch (importError) {
      Message.error(describeRuleError(t, importError));
    } finally {
      setBusy(null);
    }
  };

  const runManage = async () => {
    setBusy('manage');
    setFileChanged(null);
    try {
      const result = await actions.manageFiles(scope, projectId);
      Message.success(t('settings.rules.import.handedOver', { count: result.written.length }));
      setAcknowledged(false);
    } catch (manageError) {
      if (isBackendHttpError(manageError) && manageError.code === 'RULE_FILE_CHANGED') {
        setFileChanged(manageError.backendMessage);
      } else {
        Message.error(describeRuleError(t, manageError));
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      visible={visible}
      title={t('settings.rules.import.title')}
      onCancel={onClose}
      footer={null}
      unmountOnExit
      autoFocus={false}
      style={{ maxWidth: 'calc(100vw - 32px)', width: 680 }}
    >
      <div className='flex flex-col gap-12px' data-testid='rule-import'>
        <p className='m-0 text-13px text-t-secondary'>{t('settings.rules.import.intro')}</p>
        <div className='flex flex-wrap items-center gap-8px'>
          <Radio.Group
            type='button'
            value={scope}
            onChange={(value: RuleImportScope) => {
              setScope(value);
              setAcknowledged(false);
            }}
            aria-label={t('settings.rules.import.scopeLabel')}
          >
            <Radio value='global'>{t('settings.library.scopeGlobal')}</Radio>
            <Radio value='project'>{t('mcp.kits.level.project')}</Radio>
          </Radio.Group>
          {scope === 'project' ? (
            <Select
              className='!min-w-200px !flex-1'
              value={projectId ?? undefined}
              onChange={(value: string) => {
                setProjectId(value);
                setAcknowledged(false);
              }}
              placeholder={t('settings.rules.import.projectPlaceholder')}
              aria-label={t('settings.rules.import.projectLabel')}
              showSearch
              options={projects
                .filter((p) => p.project_id)
                .map((p) => ({ value: p.project_id as string, label: p.name }))}
            />
          ) : null}
        </div>

        {!ready ? null : error ? (
          <Alert type='error' content={describeRuleError(t, error)} />
        ) : isLoading ? (
          <Skeleton animation text={{ rows: 3 }} />
        ) : files.length === 0 ? (
          <span className='text-13px text-t-tertiary'>{t('settings.rules.import.noFiles')}</span>
        ) : (
          <ul className='m-0 p-0 list-none flex flex-col gap-8px'>
            {files.map((file) => (
              <FileRow key={file.path} file={file} />
            ))}
          </ul>
        )}

        {/* Step 1 — import: creates the rules, never touches a file. */}
        {ready && newRules.length > 0 ? (
          <div className='flex flex-col gap-6px'>
            {blocked ? <Alert type='warning' content={t('settings.rules.import.blocked')} /> : null}
            <div className='flex items-center justify-between gap-8px'>
              <span className='text-12px text-t-secondary'>{t('settings.rules.import.importHint')}</span>
              <Button
                type='primary'
                loading={busy === 'import'}
                disabled={blocked}
                onClick={() => void runImport()}
                data-testid='rule-import-run'
              >
                {t('settings.rules.import.run', { count: newRules.length })}
              </Button>
            </div>
          </div>
        ) : null}

        {/* Step 2 — hand the files over: a rewrite of the file, asked separately. */}
        {ready && handOver.length > 0 ? (
          <div
            className='flex flex-col gap-8px rd-8px border border-solid border-3 p-12px'
            data-testid='rule-import-hand-over'
          >
            <span className='text-13px font-medium text-t-primary'>{t('settings.rules.import.handOverTitle')}</span>
            <span className='text-12px text-t-secondary'>
              {t(scope === 'global' ? 'settings.rules.import.handOverGlobal' : 'settings.rules.import.handOverProject')}
            </span>
            <ul className='m-0 ps-16px text-12px text-t-primary'>
              {handOver.map((source) => (
                <li key={source.id}>
                  <code className='break-all'>{source.path}</code>
                </li>
              ))}
            </ul>
            {fileChanged !== null ? (
              <Alert
                type='error'
                title={t('settings.rules.errors.fileChanged')}
                content={
                  fileChanged ? (
                    <pre className='m-0 max-h-200px overflow-auto whitespace-pre-wrap break-words text-12px'>
                      {fileChanged}
                    </pre>
                  ) : undefined
                }
                data-testid='rule-import-file-changed'
              />
            ) : null}
            <Checkbox checked={acknowledged} onChange={setAcknowledged} data-testid='rule-import-acknowledge'>
              {t(scope === 'global' ? 'settings.rules.import.ackGlobal' : 'settings.rules.import.ackProject')}
            </Checkbox>
            <Button
              className='self-end'
              status='warning'
              disabled={!acknowledged}
              loading={busy === 'manage'}
              onClick={() => void runManage()}
              data-testid='rule-import-manage'
            >
              {t('settings.rules.import.handOver')}
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
};

export default RuleImportModal;
