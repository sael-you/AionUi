/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What conversations of the project get (C42): the effective set of
 * `kits/effective`, grouped by where it comes from (this project, a kit,
 * Global), as read-only library cards (C33). Nothing is edited here: "Manage"
 * and every card open the Skills / Tools / Rules / Servers page with the
 * project as its scope.
 */

import { Button, Tag } from '@arco-design/web-react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { KitEffectiveItem } from '@/common/config/storage';
import LibraryCard from '@/renderer/components/settings/SettingsModal/library/LibraryCard';
import LibrarySection from '@/renderer/components/settings/SettingsModal/library/LibrarySection';
import type { CategoryVisualId } from '@/renderer/components/settings/SettingsModal/library/categoryVisual';
import { useKitEffective } from '@/renderer/hooks/mcp/market/useKits';
import { useRuleList } from '@/renderer/pages/settings/RulesSettings/useRules';
import { useServerList } from '@/renderer/pages/settings/ServersSettings/useServers';
import { EmptyBlock, ErrorBlock, LoadingBlock, Panel } from './ProjectParts';
import { KIT_KINDS, groupKitBySource, kitCounts, managePath, type KitKind, type KitSourceGroup } from './projectModel';

const KIND_VISUAL: Record<KitKind, CategoryVisualId> = {
  skill: 'developer',
  mcp: 'data',
  rule: 'docs',
  server: 'backend',
};

/** MCP status → the dot colour (a status colour, always next to its label). */
const MCP_DOT: Record<string, string> = {
  active: 'var(--success)',
  dormant: 'var(--warning)',
  revoked: 'var(--danger)',
};

const KitTab: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { effective, error, isLoading, reload } = useKitEffective(projectId ? { project_id: projectId } : null);
  const { rules } = useRuleList();
  const { servers } = useServerList();
  const ruleNames = useMemo(() => new Map(rules.map((rule) => [rule.id, rule.name])), [rules]);
  const serverNames = useMemo(() => new Map(servers.map((server) => [server.id, server.name])), [servers]);

  if (error) return <ErrorBlock error={error} onRetry={() => void reload()} />;
  if (isLoading || !effective) return <LoadingBlock rows={6} />;

  const groups = groupKitBySource(effective);
  const counts = kitCounts(effective);
  const nameOf = (item: KitEffectiveItem): string =>
    item.mcp?.instance_name ||
    (item.kind === 'rule' ? ruleNames.get(item.item_ref) : undefined) ||
    (item.kind === 'server' ? serverNames.get(item.item_ref) : undefined) ||
    item.item_ref;
  const sourceTitle = (group: KitSourceGroup): string =>
    group.source === 'kit'
      ? t('conversation.projectPage.kit.source.kit', { name: group.kitName ?? '' })
      : group.source === 'other'
        ? t(`mcp.kits.level.${group.key}`, { defaultValue: group.key })
        : t(`conversation.projectPage.kit.source.${group.source}`);

  return (
    <div className='flex flex-col gap-12px' data-testid='project-kit'>
      <Panel testId='project-kit-manage'>
        <p className='m-0 text-13px text-t-secondary'>{t('conversation.projectPage.kit.intro')}</p>
        <div className='flex flex-wrap gap-8px'>
          {KIT_KINDS.map((kind) => (
            <Button
              key={kind}
              size='small'
              onClick={() => void navigate(managePath(kind, projectId))}
              data-testid={`project-kit-manage-${kind}`}
            >
              {t(`conversation.projectPage.kit.manage.${kind}`, { n: counts[kind] })}
            </Button>
          ))}
        </div>
      </Panel>

      {groups.length === 0 ? (
        <EmptyBlock text={t('conversation.projectPage.kit.empty')} />
      ) : (
        groups.map((group) => (
          <LibrarySection
            key={group.key}
            sectionKey={`project-kit-${group.key}`}
            title={sourceTitle(group)}
            count={group.items.length}
            visual={group.source === 'global' ? 'global' : group.source === 'project' ? 'project' : undefined}
          >
            {group.items.map((item) => {
              const kind = item.kind as KitKind;
              const status = item.mcp?.status;
              return (
                <LibraryCard
                  key={`${item.kind}:${item.item_ref}`}
                  id={`${item.kind}:${item.item_ref}`}
                  name={nameOf(item)}
                  description={item.mcp && !item.mcp.delivered ? item.mcp.reason : undefined}
                  visual={KIND_VISUAL[kind] ?? 'other'}
                  chips={
                    <>
                      <Tag size='small'>{t(`mcp.kits.kind.${item.kind}`, { defaultValue: item.kind })}</Tag>
                      {status ? (
                        <Tag size='small' data-testid='project-kit-mcp-status'>
                          <span className='inline-flex items-center gap-4px'>
                            <span
                              className='size-6px rd-full shrink-0'
                              style={{ background: MCP_DOT[status] ?? 'var(--color-text-4)' }}
                              aria-hidden='true'
                            />
                            {t(`mcp.market.status.${status}`, { defaultValue: status })}
                          </span>
                        </Tag>
                      ) : null}
                    </>
                  }
                  toggle={null}
                  onOpen={() => void navigate(managePath(kind, projectId))}
                />
              );
            })}
          </LibrarySection>
        ))
      )}
    </div>
  );
};

export default KitTab;
