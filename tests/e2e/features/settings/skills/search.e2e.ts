/**
 * Skills Hub E2E Tests - Search (P1), library layout (C33 / TASK-119)
 *
 * - TC-S-02: The search filters the library to one de-duplicated Results section
 * - TC-S-03: A search without matches shows the empty state
 *
 * Removed with the external-sources UI: TC-S-12, TC-S-13 (external search).
 */

import { test, expect } from '../../../fixtures';
import {
  goToSkillsHub,
  refreshSkillsHub,
  importSkillViaBridge,
  deleteSkillViaBridge,
  searchMySkills,
  createTempExternalSource,
  createTestSkill,
  cleanupTestSkills,
  skillCardSelector,
} from '../../../helpers/skillsHub';
import * as path from 'path';

test.describe('Skills Hub - Search (P1)', () => {
  test.beforeEach(async ({ page }) => {
    await goToSkillsHub(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupTestSkills(page);
  });

  test('TC-S-02: should filter the library by search keyword', async ({ page }) => {
    const stamp = Date.now();
    const skill1 = `E2E-Test-Search-Alpha-${stamp}`;
    const skill2 = `E2E-Test-Search-Beta-${stamp}`;
    const skill3 = `E2E-Test-Other-${stamp}`;
    const tempSource = createTempExternalSource('tc-s-02');
    try {
      for (const name of [skill1, skill2, skill3]) {
        createTestSkill(tempSource.path, name, `Skill ${name}`);
        await importSkillViaBridge(page, path.join(tempSource.path, name));
      }
      await refreshSkillsHub(page);

      await searchMySkills(page, `Search-Alpha-${stamp}`);
      const results = page.locator('[data-testid="library-section"][data-section-key="results"]');
      await expect(results).toBeVisible();
      await expect(results.locator(skillCardSelector(skill1))).toHaveCount(1);
      await expect(page.locator(skillCardSelector(skill2))).toHaveCount(0);
      await expect(page.locator(skillCardSelector(skill3))).toHaveCount(0);

      await searchMySkills(page, `Search-`);
      await expect(results.locator(skillCardSelector(skill1))).toHaveCount(1);
      await expect(results.locator(skillCardSelector(skill2))).toHaveCount(1);
      await expect(page.locator(skillCardSelector(skill3))).toHaveCount(0);

      await searchMySkills(page, '');
      await expect(page.locator(skillCardSelector(skill3)).first()).toBeVisible();
    } finally {
      for (const name of [skill1, skill2, skill3]) await deleteSkillViaBridge(page, name);
      tempSource.cleanup();
    }
  });

  test('TC-S-03: should show empty state when search has no match', async ({ page }) => {
    await searchMySkills(page, `no-such-skill-${Date.now()}`);
    await expect(page.locator('[data-testid="library-card"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="library-empty"]').first()).toBeVisible();
  });
});
