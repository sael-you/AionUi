/**
 * Skills Hub E2E Tests - Boards Rendering (P1), library layout (C33 / TASK-119)
 *
 * - TC-S-27: Extension skills: the Imported source filter shows exactly them
 * - TC-S-28: Auto-injected builtin skills: the Active tab's "Always on" group
 */

import { test, expect } from '../../../fixtures';
import { goToSkillsHub, getMySkills, getAutoSkills, openSkillsTab } from '../../../helpers/skillsHub';
import { takeScreenshot } from '../../../helpers/screenshots';

test.describe('Skills Hub - Boards Rendering (P1)', () => {
  test.beforeEach(async ({ page }) => {
    await goToSkillsHub(page);
  });

  test('TC-S-27: should show extension skills under the Imported filter', async ({ page }) => {
    const extensionSkills = (await getMySkills(page)).filter((s) => s.source === 'extension');
    await page.locator('[data-testid="library-sources"] input[value="imported"]').check({ force: true });
    await page.waitForTimeout(300);

    const cards = page.locator('[data-testid="library-card"]');
    const ids = new Set(await cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-card-id'))));
    expect([...ids].toSorted()).toEqual(extensionSkills.map((s) => s.name).toSorted());
    if (extensionSkills.length === 0) {
      await expect(page.locator('[data-testid="library-empty"]').first()).toBeVisible();
    }
    await takeScreenshot(page, 'skills-hub/tc-s-27/01-imported-filter.png');
  });

  test('TC-S-28: should list auto-injected skills in the Always on group of the Active tab', async ({ page }) => {
    const autoSkills = await getAutoSkills(page);
    await openSkillsTab(page, 'active');
    const group = page.locator('[data-testid="library-section"][data-section-key="alwaysOn"]');
    if (autoSkills.length === 0) {
      await expect(group).toHaveCount(0);
      return;
    }
    await expect(group).toBeVisible();
    // Folded by default; the header opens it.
    const toggle = group.locator('[data-testid="library-section-toggle"]');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    const names = await group
      .locator('[data-testid="library-card"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-card-id')));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(autoSkills.map((s) => s.name)).toContain(name);
    await takeScreenshot(page, 'skills-hub/tc-s-28/01-always-on.png');
  });
});
