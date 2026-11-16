/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Kits for one project or one conversation, in a modal. A project: its own kit
 * (C28), the shared kits attached to it and what its conversations get. A
 * conversation: "What this conversation gets" and its attachments.
 */

import { Modal, Tabs } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import KitAttachPanel from './KitAttachPanel';
import KitEffectivePanel from './KitEffectivePanel';
import ProjectKitPanel from './ProjectKitPanel';

export type KitLevelTarget =
  | { level: 'project'; projectId: string; name: string }
  | { level: 'conversation'; conversationId: string; projectId?: string | null; initialTab?: 'attach' | 'effective' };

const KitLevelModal: React.FC<{ target: KitLevelTarget | null; onClose: () => void }> = ({ target, onClose }) => {
  const { t } = useTranslation();
  const title =
    target?.level === 'project'
      ? t('mcp.kits.levelModal.projectTitle', { name: target.name })
      : t('mcp.kits.levelModal.conversationTitle');

  return (
    <Modal
      visible={target !== null}
      title={title}
      footer={null}
      onCancel={onClose}
      unmountOnExit
      autoFocus={false}
      style={{ maxWidth: 'calc(100vw - 32px)', width: 640 }}
    >
      {target?.level === 'project' ? (
        <Tabs defaultActiveTab='kit' data-testid='kit-level-project'>
          <Tabs.TabPane key='kit' title={t('mcp.kits.projectKit.title')}>
            <ProjectKitPanel projectId={target.projectId} projectName={target.name} />
          </Tabs.TabPane>
          <Tabs.TabPane key='shared' title={t('mcp.kits.levelModal.sharedTab')}>
            <div className='flex flex-col gap-8px'>
              <p className='m-0 text-12px text-t-secondary'>{t('mcp.kits.levelModal.projectHint')}</p>
              <KitAttachPanel level='project' targetId={target.projectId} />
            </div>
          </Tabs.TabPane>
          <Tabs.TabPane key='effective' title={t('mcp.kits.effective.projectTitle')}>
            <KitEffectivePanel query={{ project_id: target.projectId }} />
          </Tabs.TabPane>
        </Tabs>
      ) : null}
      {target?.level === 'conversation' ? (
        <Tabs defaultActiveTab={target.initialTab ?? 'effective'} data-testid='kit-level-conversation'>
          <Tabs.TabPane key='effective' title={t('mcp.kits.effective.title')}>
            <KitEffectivePanel query={{ conversation_id: target.conversationId }} />
          </Tabs.TabPane>
          <Tabs.TabPane key='attach' title={t('mcp.kits.levelModal.attachTab')}>
            <div className='flex flex-col gap-8px'>
              <p className='m-0 text-12px text-t-secondary'>{t('mcp.kits.levelModal.conversationHint')}</p>
              <KitAttachPanel level='conversation' targetId={target.conversationId} projectId={target.projectId} />
            </div>
          </Tabs.TabPane>
        </Tabs>
      ) : null}
    </Modal>
  );
};

export default KitLevelModal;
