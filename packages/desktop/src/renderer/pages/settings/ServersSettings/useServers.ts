/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Data of the Servers page (C36): the server list, one server's audit rows and
 * its attachments, and the writes. Attaching reuses the kit attachments API
 * (`item_kind: 'server'`) and its cache, so every kit view stays in step.
 */

import { useCallback } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { ipcBridge } from '@/common';
import type { KitAttachmentResponse, KitLevel, KitOp } from '@/common/config/storage';
import type {
  CreateServerRequest,
  ServerAuditResponse,
  ServerResponse,
  UpdateServerRequest,
} from '@/common/types/platform/serverPools';
import { kitAttachmentsKey, useKitActions } from '@/renderer/hooks/mcp/market/useKits';

export const SERVERS_KEY = 'servers.list';
const auditKey = (serverId: string) => `servers.audit:${serverId}`;
/** Recent rows shown in the drawer. */
export const AUDIT_ROWS = 20;

export const useServerList = () => {
  const { data, error, isLoading, mutate } = useSWR<ServerResponse[]>(SERVERS_KEY, () =>
    ipcBridge.servers.list.invoke()
  );
  return { servers: data ?? [], error: error as unknown, isLoading, reload: mutate };
};

export const useServerAudit = (serverId: string | null) => {
  const { data, error, isLoading } = useSWR<ServerAuditResponse[]>(serverId ? auditKey(serverId) : null, () =>
    ipcBridge.servers.audit.invoke({ server_id: serverId ?? '', limit: AUDIT_ROWS })
  );
  return { rows: data ?? [], error: error as unknown, isLoading };
};

/** Where one server is attached, at any level ("Used in"). */
export const useServerAttachments = (serverId: string | null) => {
  const query = serverId ? { item_kind: 'server' as const, item_ref: serverId } : null;
  const { data, error, isLoading } = useSWR<KitAttachmentResponse[]>(query ? kitAttachmentsKey(query) : null, () =>
    ipcBridge.kits.listAttachments.invoke(query ?? {})
  );
  // An older core ignores the filters: keep only this server's rows either way.
  const rows = (data ?? []).filter((row) => row.item_kind === 'server' && row.item_ref === serverId);
  return { attachments: rows, error: error as unknown, isLoading };
};

export const useServerActions = () => {
  const { mutate } = useSWRConfig();
  const kits = useKitActions();

  const refresh = useCallback(
    async (serverId?: string) => {
      await mutate(SERVERS_KEY);
      if (serverId) await mutate(auditKey(serverId));
    },
    [mutate]
  );

  const create = useCallback(
    async (request: CreateServerRequest) => {
      const server = await ipcBridge.servers.create.invoke(request);
      await refresh();
      return server;
    },
    [refresh]
  );

  const update = useCallback(
    async (id: string, data: UpdateServerRequest) => {
      const server = await ipcBridge.servers.update.invoke({ id, data });
      await refresh(id);
      return server;
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      await ipcBridge.servers.remove.invoke({ id });
      await refresh();
      // Its attachments are gone with it.
      await mutate((key) => typeof key === 'string' && key.startsWith('kits.'));
    },
    [mutate, refresh]
  );

  const test = useCallback(
    async (id: string) => {
      const result = await ipcBridge.servers.test.invoke({ id });
      await mutate(auditKey(id));
      return result;
    },
    [mutate]
  );

  const scanHostKey = useCallback(
    (host: string, port: number) => ipcBridge.servers.scanHostKey.invoke({ host, port }),
    []
  );

  const attach = useCallback(
    (serverId: string, level: KitLevel, targetId: string, op: KitOp) =>
      kits.attach({
        level,
        ...(level === 'global' ? {} : { target_id: targetId }),
        item_kind: 'server',
        item_ref: serverId,
        op,
      }),
    [kits]
  );

  return { create, update, remove, test, scanHostKey, attach, detach: kits.detach };
};
