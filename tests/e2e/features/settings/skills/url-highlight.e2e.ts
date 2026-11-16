/**
 * Skills Hub E2E Tests - URL Highlight (P1), library layout (C33 / TASK-119)
 *
 * - TC-S-22: `?highlight=<name>` opens the Library, highlights that card for ~2 s and clears the param
 */

import { test, expect } from '../../../fixtures';
import {
  goToSkillsHub,
  refreshSkillsHub,
  importSkillViaBridge,
  createTempExternalSource,
  createTestSkill,
  cleanupTestSkills,
  skillCardSelector,
} from '../../../helpers/skillsHub';
import * as path from 'path';

test.describe('Skills Hub - URL Highlight (P1)', () => {
  test.afterEach(async ({ page }) => {
    await cleanupTestSkills(page);
  });

  test('TC-S-22: should highlight skill and scroll to it when URL has highlight param', async ({ page }) => {
    const tempSource = createTempExternalSource('tc-s-22');
    try {
      const skillName = `E2E-Test-Highlight-Target-${Date.now()}`;
      createTestSkill(tempSource.path, skillName, 'Target skill for highlight test');
      expect((await importSkillViaBridge(page, path.join(tempSource.path, skillName))).success).toBe(true);

      await goToSkillsHub(page);
      await refreshSkillsHub(page);
      const targetCard = page.locator(skillCardSelector(skillName)).first();
      await expect(targetCard).toBeVisible({ timeout: 10000 });

      await page.evaluate((name) => {
        const [route] = window.location.hash.split('?');
        window.location.hash = `${route}?highlight=${encodeURIComponent(name)}`;
      }, skillName);

      await expect(targetCard).toHaveAttribute('data-highlighted', 'true', { timeout: 5000 });
      await expect(page.locator('[data-testid="library-tab-library"]')).toHaveAttribute('aria-selected', 'true');
      await expect.poll(() => page.url()).not.toContain('highlight=');

      // The highlight fades after ~2 s.
      await expect(targetCard).not.toHaveAttribute('data-highlighted', 'true', { timeout: 5000 });
    } finally {
      tempSource.cleanup();
    }
  });
});
