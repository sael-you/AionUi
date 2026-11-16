/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A project's own kit (C28): create it in one click (named after the
 * project), then add or remove library skills, MCP market instances (catalogue
 * or custom definitions) and wanted catalogue templates. The kit applies to
 * every conversation of the project without an attachment row. Each change is
 * one partial update guarded by the kit's `updated_at` (`KIT_STALE` → reload).
 */

import { Button, Message, Select } from '@arco-design/web-react';
import { Close, Plus } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { KitResponse, UpdateKitRequest } from '@/common/config/storage';
import { describeKitError, kitFormFromKit } from '@/renderer/hooks/mcp/market/kitModel';
import { useKitActions, useKitLibrary, useProjectKit } from '@/renderer/hooks/mcp/market/useKits';
import { MarketErrorNotice, touchClass, useIsMobileLayout } from '../market/shared';

type ProjectKitPanelProps = { projectId: string; projectName: string };

type MemberListProps = {
  title: string;
  /** Current members; `missing` = a deleted MCP instance still listed by the kit. */
  members: Array<{ value: string; label: string; missing?: boolean }>;
  options: Array<{ value: string; label: string }>;
  addLabel: string;
  busy: boolean;
  testId: string;
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
};

/** One member list of the kit: removable tags and a searchable "add" select. */
const MemberList: React.FC<MemberListProps> = ({
  title,
  members,
  options,
  addLabel,
  busy,
  testId,
  onAdd,
  onRemove,
}) => {
  const { t } = useTranslation();
  const headingId = `${testId}-title`;
  return (
    <section aria-labelledby={headingId} className='flex flex-col gap-8px' data-testid={testId}>
      <h4 id={headingId} className='m-0 text-13px font-medium text-t-primary'>
        {title}{' '}
        <span className='text-t-secondary font-normal'>
          {t('mcp.kits.projectKit.count', { count: members.length })}
        </span>
      </h4>
      <div className='flex flex-wrap gap-6px'>
        {members.length === 0 ? <span className='text-12px text-t-tertiary'>{t('mcp.kits.none')}</span> : null}
        {members.map((member) => (
          <span
            key={member.value}
            className='inline-flex items-center gap-2px rd-4px border border-border-2 ps-8px'
            data-testid={`${testId}-member`}
          >
            <span className={`text-12px ${member.missing ? 'text-t-secondary line-through' : 'text-t-primary'}`}>
              {member.label}
            </span>
            <Button
              size='mini'
              type='text'
              disabled={busy}
              icon={<Close theme='outline' size={10} />}
              aria-label={t('mcp.kits.projectKit.removeLabel', { name: member.label })}
              onClick={() => onRemove(member.value)}
            />
          </span>
        ))}
      </div>
      <Select
        showSearch
        value={undefined}
        disabled={busy}
        placeholder={addLabel}
        aria-label={addLabel}
        notFoundContent={<span className='text-13px text-t-secondary'>{t('mcp.kits.attach.noOptions')}</span>}
        onChange={(value: string | undefined) => {
          if (value) onAdd(value);
        }}
      >
        {options.map((option) => (
          <Select.Option key={option.value} value={option.value}>
            {option.label}
          </Select.Option>
        ))}
      </Select>
    </section>
  );
};

const ProjectKitPanel: React.FC<ProjectKitPanelProps> = ({ projectId, projectName }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobileLayout();
  const { projectKit, error, isLoading } = useProjectKit(projectId);
  const library = useKitLibrary();
  const { createKit, patchKit } = useKitActions();
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      Message.success(success);
    } catch (actionError) {
      Message.error(describeKitError(t, actionError));
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = () =>
    run(() => createKit({ ...kitFormFromKit(null), name: projectName }, projectId), t('mcp.kits.projectKit.created'));

  const patch = (kit: KitResponse, data: Omit<UpdateKitRequest, 'expected_updated_at'>) =>
    run(() => patchKit(kit, data), t('mcp.kits.saved'));

  if (error) return <MarketErrorNotice message={describeKitError(t, error)} />;
  if (isLoading) return <div className='text-13px text-t-secondary'>{t('mcp.kits.loading')}</div>;

  if (!projectKit) {
    return (
      <div className='flex flex-col items-start gap-10px' data-testid='project-kit-empty'>
        <p className='m-0 text-13px text-t-secondary'>{t('mcp.kits.projectKit.none', { name: projectName })}</p>
        <Button
          type='primary'
          icon={<Plus theme='outline' size={14} />}
          className={touchClass(isMobile)}
          loading={busy}
          onClick={() => void handleCreate()}
        >
          {t('mcp.kits.projectKit.create')}
        </Button>
      </div>
    );
  }

  const kit = projectKit;
  const instanceLabel = (id: string) => {
    const instance = library.instances.find((entry) => entry.id === id);
    return instance
      ? `${instance.name} · ${t(`mcp.market.environment.${instance.environment}`, { defaultValue: instance.environment })} · ${t(`mcp.market.tier.${instance.tier}`, { defaultValue: instance.tier })}`
      : id;
  };

  return (
    <div className='flex flex-col gap-16px' data-testid='project-kit-panel'>
      <div className='flex flex-wrap items-center gap-8px'>
        <span className='text-14px font-medium text-t-primary break-all'>{kit.name}</span>
        <Button
          size='small'
          type='text'
          className={`ms-auto ${touchClass(isMobile)}`}
          onClick={() => navigate(`/settings/skills?project=${encodeURIComponent(projectId)}`)}
        >
          {t('mcp.kits.projectKit.viewSkills')}
        </Button>
      </div>
      <p className='m-0 text-12px text-t-secondary'>{t('mcp.kits.projectKit.hint')}</p>
      <MemberList
        title={t('mcp.kits.skills')}
        testId='project-kit-skills'
        busy={busy}
        addLabel={t('mcp.kits.projectKit.addSkill')}
        members={kit.skills.map((name) => ({ value: name, label: name }))}
        options={library.skillNames
          .filter((name) => !kit.skills.includes(name))
          .map((name) => ({ value: name, label: name }))}
        onAdd={(name) => void patch(kit, { skills: [...kit.skills, name] })}
        onRemove={(name) => void patch(kit, { skills: kit.skills.filter((entry) => entry !== name) })}
      />
      <MemberList
        title={t('mcp.kits.mcps')}
        testId='project-kit-mcps'
        busy={busy}
        addLabel={t('mcp.kits.projectKit.addMcp')}
        members={kit.mcps.map((member) => ({
          value: member.instance_id,
          label: member.missing ? t('mcp.kits.missingInstance', { id: member.instance_id }) : member.instance_name,
          missing: member.missing,
        }))}
        options={library.instances
          .filter((instance) => !kit.mcps.some((member) => member.instance_id === instance.id))
          .map((instance) => ({ value: instance.id, label: instanceLabel(instance.id) }))}
        onAdd={(id) => void patch(kit, { mcp_instance_ids: [...kit.mcps.map((member) => member.instance_id), id] })}
        onRemove={(id) =>
          void patch(kit, {
            mcp_instance_ids: kit.mcps.map((member) => member.instance_id).filter((entry) => entry !== id),
          })
        }
      />
      <MemberList
        title={t('mcp.kits.form.templates')}
        testId='project-kit-templates'
        busy={busy}
        addLabel={t('mcp.kits.projectKit.addTemplate')}
        members={kit.mcp_templates.map((id) => ({
          value: id,
          label: t('mcp.kits.needsInstance', {
            template: library.templates.find((template) => template.id === id)?.name ?? id,
          }),
        }))}
        options={library.templates
          .filter((template) => !kit.mcp_templates.includes(template.id))
          .map((template) => ({ value: template.id, label: template.name }))}
        onAdd={(id) => void patch(kit, { mcp_templates: [...kit.mcp_templates, id] })}
        onRemove={(id) => void patch(kit, { mcp_templates: kit.mcp_templates.filter((entry) => entry !== id) })}
      />
      <p className='m-0 text-12px text-t-tertiary'>{t('mcp.kits.projectKit.customHint')}</p>
    </div>
  );
};

export default ProjectKitPanel;
