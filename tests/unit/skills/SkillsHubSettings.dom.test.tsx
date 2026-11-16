import React from 'react';
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for SkillsHubSettings component (SK3 in N4a).
 * Shallow verification: module import + basic structure.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAvailableSkills: vi.fn(),
  getSkillPaths: vi.fn(),
  getSkillImportLimits: vi.fn(),
  listSkillImportHistory: vi.fn(),
  importSkills: vi.fn(),
  deleteSkill: vi.fn(),
  showOpen: vi.fn(),
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  messageWarning: vi.fn(),
  modalConfirm: vi.fn(),
}));

const searchParamsMock = vi.hoisted(() => ({
  current: new URLSearchParams(),
  setSearchParams: vi.fn(),
  pathname: '/settings/capabilities',
  state: undefined as unknown,
  navigate: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listAvailableSkills: { invoke: mocks.listAvailableSkills },
      getSkillPaths: { invoke: mocks.getSkillPaths },
      getSkillImportLimits: { invoke: mocks.getSkillImportLimits },
      listSkillImportHistory: { invoke: mocks.listSkillImportHistory },
      importSkills: { invoke: mocks.importSkills },
      deleteSkill: { invoke: mocks.deleteSkill },
    },
    dialog: {
      showOpen: { invoke: mocks.showOpen },
    },
  },
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: {
      ...actual.Message,
      error: mocks.messageError,
      success: mocks.messageSuccess,
      warning: mocks.messageWarning,
    },
    Modal: {
      ...actual.Modal,
      confirm: mocks.modalConfirm,
    },
  };
});

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: searchParamsMock.pathname, state: searchParamsMock.state }),
  useNavigate: () => searchParamsMock.navigate,
  useSearchParams: () => [searchParamsMock.current, searchParamsMock.setSearchParams],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'settings.skillsHub.importError': 'Error importing skill',
        'settings.skillsHub.importPartialSuccess':
          'Imported {{successCount}} skill(s), {{failureCount}} failed: {{failures}}',
        'settings.skillsHub.importErrors.SKILL_IMPORT_FILE_TOO_LARGE':
          'A file in this skill is over the size limit. Remove the large file and try again.',
      };
      const template = translations[k] ?? (typeof options?.defaultValue === 'string' ? options.defaultValue : k);
      return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(options?.[key] ?? ''));
    },
    i18n: { language: 'en' },
  }),
}));

// The library layout (C33) has its own tests; here only what the page hands it and how its callbacks act.
const library = vi.hoisted(() => ({ props: null as null | SkillsLibraryProps }));
vi.mock('@/renderer/pages/settings/SkillsSettings/SkillsLibrary', () => ({
  default: (props: SkillsLibraryProps) => {
    library.props = props;
    return (
      <div data-testid='skills-library-stub'>
        <p>{props.description}</p>
        {props.headerActions}
      </div>
    );
  },
}));

import type { SkillsLibraryProps } from '@/renderer/pages/settings/SkillsSettings/SkillsLibrary';
import SkillsHubSettings from '@/renderer/pages/settings/SkillsSettings/SkillsHubSettings';

describe('SkillsHubSettings', () => {
  // The import action is now a TalkToButlerButton: open the menu, then click
  // "Import Skills" (the manual item) to run the manual import.
  const triggerManualImport = async () => {
    fireEvent.click(screen.getByTestId('btn-add-skill'));
    const marker = await screen.findByTestId('btn-add-skill-manual');
    fireEvent.click((marker.closest('[role="menuitem"]') ?? marker) as HTMLElement);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    library.props = null;
    searchParamsMock.current = new URLSearchParams();
    searchParamsMock.pathname = '/settings/capabilities';
    searchParamsMock.state = undefined;
    mocks.listAvailableSkills.mockResolvedValue([]);
    mocks.getSkillPaths.mockResolvedValue({
      user_skills_dir: '/tmp/user-skills',
      builtin_skills_dir: '/tmp/builtin-skills',
    });
    mocks.getSkillImportLimits.mockResolvedValue({
      max_file_bytes: 12 * 1024 * 1024,
      max_total_bytes: 64 * 1024 * 1024,
    });
    mocks.listSkillImportHistory.mockResolvedValue([]);
  });

  it('exports a component (smoke)', () => {
    expect(SkillsHubSettings).toBeDefined();
    expect(typeof SkillsHubSettings).toBe('function');
  });

  it('has display name or name property (structure check)', () => {
    expect(SkillsHubSettings.displayName || SkillsHubSettings.name).toBeTruthy();
  });

  it('can be instantiated as JSX element (shallow)', () => {
    const element = <SkillsHubSettings />;
    expect(element.type).toBe(SkillsHubSettings);
  });

  it('shows backend import failure detail for manual imports', async () => {
    mocks.showOpen.mockResolvedValue(['/tmp/huge-skill']);
    mocks.importSkills.mockRejectedValue(
      Object.assign(new Error('wrapped import failure'), {
        name: 'BackendHttpError',
        status: 400,
        code: 'SKILL_IMPORT_FILE_TOO_LARGE',
      })
    );

    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(mocks.listAvailableSkills).toHaveBeenCalled());
    await triggerManualImport();

    await waitFor(() =>
      expect(mocks.messageError).toHaveBeenCalledWith(
        'A file in this skill is over the size limit. Remove the large file and try again.'
      )
    );
  });

  it('shows partial import warning and refreshes after batch import partial success', async () => {
    mocks.showOpen.mockResolvedValue(['/tmp/parent-pack']);
    mocks.importSkills.mockResolvedValue({
      skill_name: 'sample-alpha',
      skill_names: ['sample-alpha'],
      failed: [{ source_name: 'beta-skill', code: 'SKILL_IMPORT_FILE_TOO_LARGE' }],
    });

    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(mocks.listAvailableSkills).toHaveBeenCalled());
    const initialFetchCount = mocks.listAvailableSkills.mock.calls.length;
    await triggerManualImport();

    await waitFor(() =>
      expect(mocks.messageWarning).toHaveBeenCalledWith(
        'Imported 1 skill(s), 1 failed: beta-skill: A file in this skill is over the size limit. Remove the large file and try again.'
      )
    );
    await waitFor(() => expect(mocks.listAvailableSkills.mock.calls.length).toBeGreaterThan(initialFetchCount));
  });

  it('renders import history failure detail in the secondary view', async () => {
    searchParamsMock.pathname = '/settings/skills/import-history';
    mocks.listSkillImportHistory.mockResolvedValue([
      {
        id: 'record-1',
        operation_id: 'operation-1',
        source_label: 'parent-pack',
        source_name: 'beta-skill',
        status: 'failed',
        error_code: 'SKILL_IMPORT_FILE_TOO_LARGE',
        error_path: 'movie.bin',
        actual_bytes: 11 * 1024 * 1024,
        limit_bytes: 10 * 1024 * 1024,
        created_at: 1_700_000_000_000,
      },
    ]);

    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(screen.getByTestId('skill-import-history-page')).toBeInTheDocument());
    expect(screen.getByText('parent-pack')).toBeInTheDocument();
    expect(screen.getByText(/beta-skill/)).toBeInTheDocument();
    expect(screen.getAllByText(/movie\.bin/).length).toBeGreaterThan(0);
  });

  it('renders import history entry point when history is empty', async () => {
    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(screen.getByTestId('btn-open-import-history')).toBeInTheDocument());
    expect(screen.queryByText('No import records yet.')).not.toBeInTheDocument();
  });

  it('renders import history as a secondary view without search or category filters', async () => {
    searchParamsMock.pathname = '/settings/skills/import-history';
    mocks.listSkillImportHistory.mockResolvedValue([
      {
        id: 'record-1',
        operation_id: 'operation-1',
        source_label: 'parent-pack',
        source_name: 'beta-skill',
        status: 'failed',
        error_code: 'SKILL_IMPORT_FILE_TOO_LARGE',
        error_path: 'movie.bin',
        actual_bytes: 11 * 1024 * 1024,
        limit_bytes: 10 * 1024 * 1024,
        created_at: 1_700_000_000_000,
      },
    ]);

    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(screen.getByTestId('skill-import-history-page')).toBeInTheDocument());
    expect(screen.queryByTestId('my-skills-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('input-search-my-skills')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Failed' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Success' })).not.toBeInTheDocument();
  });

  it('shows concise repair instructions for failed import history records', async () => {
    searchParamsMock.pathname = '/settings/skills/import-history';
    mocks.listSkillImportHistory.mockResolvedValue([
      {
        id: 'record-1',
        operation_id: 'operation-1',
        source_label: 'parent-pack',
        source_name: 'beta-skill',
        status: 'failed',
        error_code: 'SKILL_IMPORT_FILE_TOO_LARGE',
        error_path: 'movie.bin',
        actual_bytes: 11 * 1024 * 1024,
        limit_bytes: 10 * 1024 * 1024,
        created_at: 1_700_000_000_000,
      },
    ]);

    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(screen.getByTestId('skill-import-history-page')).toBeInTheDocument());
    expect(screen.getByText('Repair: remove the oversized file and import again')).toBeInTheDocument();
    expect(screen.getAllByText(/movie\.bin/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/11 MB/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/10 MB/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Latest 5')).not.toBeInTheDocument();
  });

  it('does not expose technical error details in import history', async () => {
    searchParamsMock.pathname = '/settings/skills/import-history';
    mocks.listSkillImportHistory.mockResolvedValue([
      {
        id: 'record-1',
        operation_id: 'operation-1',
        source_label: 'parent-pack',
        source_name: 'beta-skill',
        status: 'failed',
        error_code: 'SKILL_IMPORT_FILE_TOO_LARGE',
        error_path: 'movie.bin',
        actual_bytes: 11 * 1024 * 1024,
        limit_bytes: 10 * 1024 * 1024,
        created_at: 1_700_000_000_000,
      },
    ]);

    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(screen.getByTestId('skill-import-history-page')).toBeInTheDocument());
    expect(screen.queryByText('Technical info')).not.toBeInTheDocument();
    expect(screen.queryByText('SKILL_IMPORT_FILE_TOO_LARGE')).not.toBeInTheDocument();
  });

  it('shows specific repair instructions for known non-size import errors', async () => {
    searchParamsMock.pathname = '/settings/skills/import-history';
    mocks.listSkillImportHistory.mockResolvedValue([
      {
        id: 'record-zip',
        operation_id: 'operation-zip',
        source_label: 'broken.zip',
        source_name: 'broken.zip',
        status: 'failed',
        error_code: 'SKILL_IMPORT_INVALID_ZIP',
        created_at: 1_700_000_000_000,
      },
    ]);

    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(screen.getByTestId('skill-import-history-page')).toBeInTheDocument());
    expect(screen.getByText('Repair: create the zip again and import it')).toBeInTheDocument();
    expect(screen.queryByText('Repair: update the skill files and import again')).not.toBeInTheDocument();
  });

  it('hands the library every skill except the ones generated for scheduled tasks', async () => {
    mocks.listAvailableSkills.mockResolvedValue([
      {
        name: 'cron',
        description: 'Auto.',
        location: '/b/cron/SKILL.md',
        is_auto_inject: true,
        is_custom: false,
        source: 'builtin',
      },
      {
        name: 'officecli',
        description: 'Official.',
        location: '/b/officecli/SKILL.md',
        is_auto_inject: false,
        is_custom: false,
        source: 'builtin',
      },
      { name: 'sample-single', description: 'Mine.', location: '/u/sample-single', is_custom: true, source: 'custom' },
      { name: 'job-generated', description: 'Cron.', location: '/c/job-generated', is_custom: false, source: 'cron' },
    ]);

    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() =>
      expect(library.props?.skills.map((s) => s.name)).toEqual(['cron', 'officecli', 'sample-single'])
    );
  });

  it('opens on the project of ?project= and passes the highlight deep link (C28)', async () => {
    searchParamsMock.current = new URLSearchParams('project=proj-tb&highlight=officecli');

    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(library.props?.initialProjectId).toBe('proj-tb'));
    expect(library.props?.highlightName).toBe('officecli');
    library.props?.onHighlightDone();
    expect(searchParamsMock.setSearchParams).toHaveBeenCalledWith({}, { replace: true });
  });

  it('does not expose the local skills directory path on the skills page', async () => {
    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(mocks.listAvailableSkills).toHaveBeenCalled());
    expect(screen.queryByText('/tmp/user-skills')).not.toBeInTheDocument();
  });

  it('surfaces server-provided size limits in the page description', async () => {
    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(mocks.getSkillImportLimits).toHaveBeenCalled());
    expect(await screen.findByText(/12 MB per file and 64 MB per skill/)).toBeInTheDocument();
  });

  describe('delete and batch delete (library callbacks)', () => {
    const confirmed = async () => {
      // Modal.confirm is mocked; invoke the onOk callback the page passed in.
      await waitFor(() => expect(mocks.modalConfirm).toHaveBeenCalled());
      const config = mocks.modalConfirm.mock.calls.at(-1)?.[0] as { onOk?: () => Promise<void> | void };
      await config.onOk?.();
    };

    beforeEach(() => {
      mocks.deleteSkill.mockResolvedValue(undefined);
    });

    it('deletes one skill after confirmation and reloads the list', async () => {
      render(<SkillsHubSettings withWrapper={false} />);
      await waitFor(() => expect(library.props).not.toBeNull());
      const before = mocks.listAvailableSkills.mock.calls.length;

      library.props?.onDelete('skill-alpha');
      await confirmed();

      await waitFor(() => expect(mocks.deleteSkill).toHaveBeenCalledWith({ skill_name: 'skill-alpha' }));
      await waitFor(() => expect(mocks.messageSuccess).toHaveBeenCalledWith('Skill deleted'));
      await waitFor(() => expect(mocks.listAvailableSkills.mock.calls.length).toBeGreaterThan(before));
    });

    it('deletes the selected skills after one confirmation and ends batch mode', async () => {
      render(<SkillsHubSettings withWrapper={false} />);
      await waitFor(() => expect(library.props).not.toBeNull());
      const done = vi.fn();

      library.props?.onBatchDelete(['skill-alpha', 'skill-beta'], done);
      await confirmed();

      await waitFor(() => expect(mocks.deleteSkill).toHaveBeenCalledTimes(2));
      expect(mocks.messageSuccess).toHaveBeenCalledWith('Deleted 2 skill(s)');
      expect(done).toHaveBeenCalled();
    });

    it('reports a partial batch failure', async () => {
      mocks.deleteSkill.mockImplementation(({ skill_name }: { skill_name: string }) =>
        skill_name === 'skill-beta' ? Promise.reject(new Error('boom')) : Promise.resolve(undefined)
      );
      render(<SkillsHubSettings withWrapper={false} />);
      await waitFor(() => expect(library.props).not.toBeNull());

      library.props?.onBatchDelete(['skill-alpha', 'skill-beta'], vi.fn());
      await confirmed();

      await waitFor(() => expect(mocks.messageWarning).toHaveBeenCalledWith('Deleted 1 skill(s), 1 failed'));
    });

    it('an empty selection asks nothing', () => {
      render(<SkillsHubSettings withWrapper={false} />);
      library.props?.onBatchDelete([], vi.fn());
      expect(mocks.modalConfirm).not.toHaveBeenCalled();
    });
  });
});
