/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Write or edit one rule (C37) in the library drawer: name, description, the
 * markdown body with Edit / Preview and a meter against the 8 KB cap, the
 * on/off switch, where an imported rule came from, and "Used in". Saving sends
 * only what changed, guarded by the version being edited (RULE_STALE).
 */

import { Alert, Button, Input, Message, Modal, Switch, Tabs } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { RULE_BODY_MAX_BYTES, type RuleResponse } from '@/common/types/platform/rules';
import MarkdownView from '@/renderer/components/Markdown';
import { DrawerBlock, LibraryDrawer } from '@/renderer/components/settings/SettingsModal/library/LibraryParts';
import { useLatestRef } from '@/renderer/hooks/ui/useLatestRef';
import type { StandardProject } from '@/renderer/pages/conversation/GroupedHistory/utils/standardProjects';
import KitItemUsedIn from '@/renderer/pages/settings/ToolsSettings/kits/KitItemUsedIn';
import RulesEffectivePanel, { SizeMeter } from './RulesEffectivePanel';
import {
  createRuleRequest,
  describeRuleError,
  emptyRuleForm,
  ruleFormOf,
  updateRuleRequest,
  utf8Bytes,
  validateRuleForm,
  type RuleFormValues,
} from './ruleModel';
import { useRuleActions } from './useRules';

export type RuleDrawerTarget = RuleResponse | 'new' | null;

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

const RuleDrawer: React.FC<{
  target: RuleDrawerTarget;
  projects: StandardProject[];
  /** The scope the page shows, for "What <scope> gets". */
  scope: { projectId: string | null; label: string };
  isMobile: boolean;
  onClose: () => void;
  onSaved: (rule: RuleResponse) => void;
  onStale: () => void;
}> = ({ target, projects, scope, isMobile, onClose, onSaved, onStale }) => {
  const { t } = useTranslation();
  const actions = useRuleActions();
  const existing = target && target !== 'new' ? target : null;
  const [values, setValues] = useState<RuleFormValues>(emptyRuleForm);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');

  const targetKey = existing ? `${existing.id}:${existing.updated_at}` : target;
  const existingRef = useLatestRef(existing);
  useEffect(() => {
    const current = existingRef.current;
    setValues(current ? ruleFormOf(current) : emptyRuleForm());
    setTouched(false);
    setTab('edit');
  }, [targetKey, existingRef]);

  const problems = useMemo(() => validateRuleForm(values), [values]);
  /** After the first save attempt; a body over the cap is shown at once. */
  const problemOf = (field: keyof RuleFormValues): string | undefined => {
    const problem = problems[field];
    if (!problem || (!touched && problem !== 'bodyTooLarge')) return undefined;
    return t(`settings.rules.problems.${problem}`, { max: RULE_BODY_MAX_BYTES / 1024 });
  };
  const set = <K extends keyof RuleFormValues>(key: K, value: RuleFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const bytes = utf8Bytes(values.body);

  const save = async () => {
    setTouched(true);
    if (Object.keys(problems).length > 0) return;
    setSaving(true);
    try {
      if (existing) {
        const request = updateRuleRequest(values, existing);
        if (Object.keys(request).length === 0) {
          onClose();
          return;
        }
        const rule = await actions.update(existing.id, request);
        Message.success(t('settings.rules.saved', { name: rule.name }));
        onSaved(rule);
      } else {
        const rule = await actions.create(createRuleRequest(values));
        Message.success(t('settings.rules.created', { name: rule.name }));
        onSaved(rule);
      }
    } catch (error) {
      Message.error(describeRuleError(t, error));
      if (isBackendHttpError(error) && error.code === 'RULE_STALE') onStale();
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    if (!existing) return;
    Modal.confirm({
      title: t('settings.rules.deleteTitle', { name: existing.name }),
      content: t('settings.rules.deleteBody'),
      okText: t('common.delete'),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        try {
          await actions.remove(existing.id);
          Message.success(t('settings.rules.deleted', { name: existing.name }));
          onClose();
        } catch (error) {
          Message.error(describeRuleError(t, error));
        }
      },
    });
  };

  const footer = (
    <div className='flex items-center gap-8px w-full'>
      {existing ? (
        <Button status='danger' onClick={confirmDelete} data-testid='rule-delete'>
          {t('common.delete')}
        </Button>
      ) : null}
      <span className='flex-1' />
      <Button onClick={onClose}>{t('common.cancel')}</Button>
      <Button type='primary' loading={saving} onClick={() => void save()} data-testid='rule-save'>
        {existing ? t('common.save') : t('settings.rules.add')}
      </Button>
    </div>
  );

  return (
    <LibraryDrawer
      visible={target !== null}
      isMobile={isMobile}
      onClose={onClose}
      testId='rule-drawer'
      title={existing ? existing.name : t('settings.rules.addTitle')}
      footer={footer}
    >
      <Field label={t('settings.rules.fields.name')} htmlFor='rule-name' error={problemOf('name')}>
        <Input
          id='rule-name'
          value={values.name}
          onChange={(value) => set('name', value)}
          placeholder={t('settings.rules.namePlaceholder')}
          status={problemOf('name') ? 'error' : undefined}
        />
      </Field>
      <Field label={t('settings.rules.fields.description')} htmlFor='rule-description' error={problemOf('description')}>
        <Input
          id='rule-description'
          value={values.description}
          onChange={(value) => set('description', value)}
          placeholder={t('settings.rules.descriptionPlaceholder')}
        />
      </Field>

      <div className='flex flex-col gap-6px'>
        <div className='flex items-center justify-between gap-8px'>
          <span className='text-12px font-medium text-t-secondary'>{t('settings.rules.fields.body')}</span>
          <SizeMeter bytes={bytes} max={RULE_BODY_MAX_BYTES} testId='rule-size-meter' />
        </div>
        <Tabs activeTab={tab} onChange={(key) => setTab(key as 'edit' | 'preview')} type='text' size='small'>
          <Tabs.TabPane key='edit' title={t('settings.rules.edit')}>
            <Input.TextArea
              value={values.body}
              onChange={(value) => set('body', value)}
              autoSize={{ minRows: 10, maxRows: 24 }}
              placeholder={t('settings.rules.bodyPlaceholder')}
              aria-label={t('settings.rules.fields.body')}
              status={problemOf('body') ? 'error' : undefined}
              className='font-mono !text-12px'
              data-testid='rule-body'
            />
          </Tabs.TabPane>
          <Tabs.TabPane key='preview' title={t('settings.rules.preview')}>
            <div className='min-h-200px rd-8px border border-solid border-3 p-12px' data-testid='rule-preview'>
              {values.body.trim() ? (
                <MarkdownView>{values.body}</MarkdownView>
              ) : (
                <span className='text-12px text-t-tertiary'>{t('settings.rules.previewEmpty')}</span>
              )}
            </div>
          </Tabs.TabPane>
        </Tabs>
        {problemOf('body') ? (
          <span className='text-12px text-danger' role='alert'>
            {problemOf('body')}
          </span>
        ) : null}
      </div>

      <div className='flex items-center justify-between gap-12px'>
        <div className='flex flex-col'>
          <span className='text-13px text-t-primary'>{t('settings.rules.fields.enabled')}</span>
          <span className='text-12px text-t-tertiary'>{t('settings.rules.enabledHint')}</span>
        </div>
        <Switch
          checked={values.enabled}
          onChange={(value) => set('enabled', value)}
          aria-label={t('settings.rules.fields.enabled')}
        />
      </div>

      {existing?.source_path ? (
        <Alert type='info' content={t('settings.rules.importedFrom', { path: existing.source_path })} />
      ) : null}

      {existing ? (
        <>
          <DrawerBlock title={t('settings.library.usedIn')}>
            <KitItemUsedIn
              kind='rule'
              itemRef={existing.id}
              projects={projects}
              i18nPrefix='settings.rules.usedIn'
              describeError={(error) => describeRuleError(t, error)}
            />
          </DrawerBlock>
          <DrawerBlock title={t('settings.rules.effective.title', { scope: scope.label })}>
            <RulesEffectivePanel query={scope.projectId ? { project_id: scope.projectId } : {}} />
          </DrawerBlock>
        </>
      ) : null}
    </LibraryDrawer>
  );
};

export default RuleDrawer;
