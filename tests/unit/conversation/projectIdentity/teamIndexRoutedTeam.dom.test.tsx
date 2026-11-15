/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';

let routeId = 'team-b';
const teamGet = vi.fn();
vi.mock('react-router-dom', () => ({ useParams: () => ({ id: routeId }) }));
vi.mock('@/common', () => ({ ipcBridge: { team: { get: { invoke: (p: { id: string }) => teamGet(p) } } } }));
vi.mock('@/renderer/pages/team/TeamPage', () => ({
  default: ({ team }: { team: { id: string } }) => <div data-testid={`team-page-${team.id}`} />,
}));

import TeamIndex from '@/renderer/pages/team';

const tree = () => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <TeamIndex />
  </SWRConfig>
);

describe('team route renders only the routed team', () => {
  it('renders the team whose id matches the route', async () => {
    routeId = 'team-b';
    teamGet.mockResolvedValue({ id: 'team-b' });
    render(tree());
    await act(async () => {});
    expect(screen.getByTestId('team-page-team-b')).toBeInTheDocument();
  });

  it('does not render (or publish the project of) a team that is not the routed one', async () => {
    routeId = 'team-b';
    teamGet.mockResolvedValue({ id: 'team-a' }); // a stale payload
    render(tree());
    await act(async () => {});
    expect(screen.queryByTestId('team-page-team-a')).toBeNull();
  });
});
