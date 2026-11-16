/**
 * Skills Hub E2E Tests - Refresh / Empty / Tabs (P1), library layout (C33 / TASK-119)
 *
 * - TC-S-04: Coming back to the page shows a newly imported skill
 * - TC-S-07: No E2E skills → no E2E cards, page still renders
 * - TC-S-09b: Active / Library tabs switch with ARIA state
 *
 * Removed with the external-sources UI: TC-S-09 (external source tabs).
 */

import { test, expect } from '../../../fixtures';
import {
  goToSkillsHub,
  refreshSkillsHub,
  getMySkills,
  importSkillViaBridge,
  openSkillsTab,
  createTempExternalSource,
  createTestSkill,
  cleanupTestSkills,
  skillCardSelector,
  E2E_SKILL_CARDS,
} from '../../../helpers/skillsHub';
import * as path from 'path';

test.describe('Skills Hub - Refresh/Empty/Tabs (P1)', () => {
  test.beforeEach(async ({ page }) => {
    await goToSkillsHub(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupTestSkills(page);
  });

  test('TC-S-04: should show a newly imported skill after reloading the page data', async ({ page }) => {
    const tempSource = createTempExternalSource('tc-s-04');
    try {
      const initialSkill = `E2E-Test-Initial-${Date.now()}`;
      createTestSkill(tempSource.path, initialSkill, 'Initial skill');
      expect((await importSkillViaBridge(page, path.join(tempSource.path, initialSkill))).success).toBe(true);
      await refreshSkillsHub(page);
      await expect(page.locator(skillCardSelector(initialSkill)).first()).toBeVisible();

      const newSkill = `E2E-Test-New-Skill-${Date.now()}`;
      createTestSkill(tempSource.path, newSkill, 'Newly added skill');
      expect((await importSkillViaBridge(page, path.join(tempSource.path, newSkill))).success).toBe(true);
      await refreshSkillsHub(page);
      await expect(page.locator(skillCardSelector(newSkill)).first()).toBeVisible();

      const testSkills = (await getMySkills(page)).filter((s) => s.name.startsWith('E2E-Test-'));
      expect(testSkills.length).toBe(2);
    } finally {
      tempSource.cleanup();
    }
  });

  test('TC-S-07: should render without E2E cards when no E2E skills exist', async ({ page }) => {
    await cleanupTestSkills(page);
    await refreshSkillsHub(page);
    await expect(page.locator('[data-testid="skills-library"]')).toBeVisible();
    const testSkills = (await getMySkills(page)).filter((s) => s.name.startsWith('E2E-Test-'));
    expect(testSkills.length).toBe(0);
    await expect(page.locator(E2E_SKILL_CARDS)).toHaveCount(0);
  });

  test('TC-S-09b: should switch between the Active and Library tabs', async ({ page }) => {
    await openSkillsTab(page, 'active');
    await expect(page.locator('[data-testid="library-tab-active"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="library-panel"]')).toHaveAttribute('role', 'tabpanel');
    await openSkillsTab(page, 'library');
    await expect(page.locator('[data-testid="library-tab-active"]')).toHaveAttribute('aria-selected', 'false');
  });
});
