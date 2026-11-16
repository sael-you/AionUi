/**
 * Skills Hub E2E Tests - Edge Cases (P2), library layout (C33 / TASK-119)
 *
 * - TC-S-23: A highlight param naming a missing skill neither crashes nor highlights anything
 *
 * Removed with the external-sources UI: TC-S-15 (custom source tabs), TC-S-21 (export targets).
 */

import { test, expect } from '../../../fixtures';
import { goToSkillsHub, cleanupTestSkills } from '../../../helpers/skillsHub';

test.describe('Skills Hub - Edge Cases (P2)', () => {
  test.beforeEach(async ({ page }) => {
    await goToSkillsHub(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupTestSkills(page);
  });

  test('TC-S-23: should not crash when URL highlight param references non-existent skill', async ({ page }) => {
    await page.evaluate(() => {
      const [route] = window.location.hash.split('?');
      window.location.hash = `${route}?highlight=NonExistentSkill-12345`;
    });
    await page.waitForTimeout(1500);

    await expect(page.locator('[data-testid="skills-library"]')).toBeVisible();
    await expect(page.locator('[data-testid="library-card"][data-highlighted="true"]')).toHaveCount(0);
    // Nothing matched, so the param is left as it was.
    expect(page.url()).toContain('highlight=');
  });
});
