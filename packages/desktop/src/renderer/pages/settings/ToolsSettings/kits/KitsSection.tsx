/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Settings → Tools → Kits (C27): every kit with its skills, MCP instances,
 * wanted templates and the levels it is attached to; create, edit, delete;
 * and the global attachments. Project, assistant and conversation
 * attachments live where those are edited (project menu, assistant editor,
 * conversation header).
 */

import { Button, Divider, Message, Modal, Tag } from '@arco-design/web-react';
import { Plus } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { KitResponse } from '@/common/config/storage';
import { kitAttachmentLevels, describeKitError } from '@/renderer/hooks/mcp/market/kitModel';
import { useKitActions, useKitAttachments, useKitList } from '@/renderer/hooks/mcp/market/useKits';
import { MarketErrorNotice, touchClass, useIsMobileLayout } from '../market/shared';
import { useStandardProjects } from '@/renderer/pages/conversation/GroupedHistory/hooks/useStandardProjects';
import KitAttachPanel from './KitAttachPanel';
import KitEditModal from './KitEditModal';

const ALL_ATTACHMENTS = {};

const MemberTags: React.FC<{ label: string; empty: string; children: React.ReactNode; hasItems: boolean }> = ({
  label,
  empty,
  children,
  hasItems,
}) => (
  <div className='flex flex-wrap items-center gap-6px'>
    <span className='text-12px text-t-secondary me-2px'>{label}</span>
    {hasItems ? children : <span className='text-12px text-t-tertiary'>{empty}</span>}
  </div>
);

const KitCard: React.FC<{
  kit: KitResponse;
  /** Display name of the kit's project (project kits only). */
  projectName?: string;
  levels: ReturnType<typeof kitAttachmentLevels>;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ kit, projectName, levels, onEdit, onDelete }) => {
  const { t } = useTranslation();
  const isMobile = useIsMobileLayout();
  return (
    <li className='rd-12px border border-border-2 px-12px py-12px flex flex-col gap-8px' data-testid='kit-card'>
      <div className='flex flex-wrap items-center gap-8px'>
        <span className='text-14px text-t-primary font-medium break-all'>{kit.name}</span>
        {kit.builtin_key ? (
          <Tag size='small' color='arcoblue'>
            {t('mcp.kits.builtin', { key: kit.builtin_key })}
          </Tag>
        ) : null}
        {kit.project_id ? (
          <Tag size='small' color='cyan' data-testid='kit-card-project'>
            {t('mcp.kits.projectKit.of', { name: projectName ?? kit.project_id })}
          </Tag>
        ) : null}
        <div className='ms-auto flex items-center gap-4px'>
          <Button
            size='mini'
            type='text'
            className={touchClass(isMobile)}
            aria-label={t('mcp.kits.editLabel', { name: kit.name })}
            onClick={onEdit}
          >
            {t('common.edit')}
          </Button>
          <Button
            size='mini'
            type='text'
            status='danger'
            className={touchClass(isMobile)}
            aria-label={t('mcp.kits.deleteLabel', { name: kit.name })}
            onClick={onDelete}
          >
            {t('common.delete')}
          </Button>
        </div>
      </div>
      {kit.description ? <div className='text-12px text-t-secondary'>{kit.description}</div> : null}
      <MemberTags label={t('mcp.kits.skills')} empty={t('mcp.kits.none')} hasItems={kit.skills.length > 0}>
        {kit.skills.map((skill) => (
          <Tag key={skill} size='small'>
            {skill}
          </Tag>
        ))}
      </MemberTags>
      <MemberTags
        label={t('mcp.kits.mcps')}
        empty={t('mcp.kits.none')}
        hasItems={kit.mcps.length + kit.mcp_templates.length > 0}
      >
        {kit.mcps.map((member) => (
          <Tag key={member.instance_id} size='small' color={member.missing ? 'red' : 'green'}>
            {member.missing ? t('mcp.kits.missingInstance', { id: member.instance_id }) : member.instance_name}
          </Tag>
        ))}
        {kit.mcp_templates.map((template) => (
          <Tag key={template} size='small' color='orange'>
            {t('mcp.kits.needsInstance', { template })}
          </Tag>
        ))}
      </MemberTags>
      <MemberTags label={t('mcp.kits.attachedAt')} empty={t('mcp.kits.notAttached')} hasItems={levels.length > 0}>
        {levels.map((entry) => (
          <Tag key={entry.level} size='small' color='purple'>
            {t('mcp.kits.levelCount', { level: t(`mcp.kits.level.${entry.level}`), count: entry.count })}
          </Tag>
        ))}
      </MemberTags>
    </li>
  );
};

const KitsSection: React.FC = () => {
  const { t } = useTranslation();
  const isMobile = useIsMobileLayout();
  const { kits, error, isLoading, reload } = useKitList();
  const { attachments } = useKitAttachments(ALL_ATTACHMENTS);
  const { deleteKit } = useKitActions();
  const [editing, setEditing] = useState<{ kit: KitResponse | null } | null>(null);
  const [modal, modalContextHolder] = Modal.useModal();

  const projects = useStandardProjects(null);
  const projectNames = useMemo(
    () =>
      new Map(projects.flatMap((project) => (project.project_id ? [[project.project_id, project.name] as const] : []))),
    [projects]
  );
  const levelsByKit = useMemo(
    () => new Map(kits.map((kit) => [kit.id, kitAttachmentLevels(kit.id, attachments, kit.project_id)])),
    [kits, attachments]
  );

  const confirmDelete = (kit: KitResponse) => {
    modal.confirm?.({
      title: t('mcp.kits.deleteConfirmTitle', { name: kit.name }),
      content: t('mcp.kits.deleteConfirmContent'),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        try {
          await deleteKit(kit.id);
          Message.success(t('mcp.kits.deleted'));
        } catch (deleteError) {
          Message.error(describeKitError(t, deleteError));
        }
      },
    });
  };

  return (
    <section aria-labelledby='kits-section-title' data-testid='kits-section'>
      {modalContextHolder}
      <div className='flex flex-wrap items-center gap-8px mb-4px'>
        <h3 id='kits-section-title' className='m-0 text-14px font-medium text-t-primary'>
          {t('mcp.kits.title')}
        </h3>
        <Button
          size='small'
          type='outline'
          icon={<Plus theme='outline' size={14} />}
          className={`ms-auto ${touchClass(isMobile)}`}
          onClick={() => setEditing({ kit: null })}
        >
          {t('mcp.kits.create')}
        </Button>
      </div>
      <p className='m-0 mb-12px text-12px text-t-secondary'>{t('mcp.kits.description')}</p>
      {error ? <MarketErrorNotice message={describeKitError(t, error)} onRetry={() => void reload()} /> : null}
      {isLoading ? (
        <div className='text-13px text-t-secondary'>{t('mcp.kits.loading')}</div>
      ) : kits.length === 0 && !error ? (
        <div className='text-13px text-t-secondary'>{t('mcp.kits.empty')}</div>
      ) : (
        <ul className='m-0 p-0 list-none flex flex-col gap-8px' aria-label={t('mcp.kits.title')}>
          {kits.map((kit) => (
            <KitCard
              key={kit.id}
              kit={kit}
              projectName={kit.project_id ? projectNames.get(kit.project_id) : undefined}
              levels={levelsByKit.get(kit.id) ?? []}
              onEdit={() => setEditing({ kit })}
              onDelete={() => confirmDelete(kit)}
            />
          ))}
        </ul>
      )}
      <Divider className='my-16px' />
      <h4 className='m-0 mb-4px text-13px font-medium text-t-primary'>{t('mcp.kits.attach.globalTitle')}</h4>
      <p className='m-0 mb-10px text-12px text-t-secondary'>{t('mcp.kits.attach.globalHint')}</p>
      <KitAttachPanel level='global' targetId='' />
      <KitEditModal visible={editing !== null} kit={editing?.kit ?? null} onClose={() => setEditing(null)} />
    </section>
  );
};

export default KitsSection;
