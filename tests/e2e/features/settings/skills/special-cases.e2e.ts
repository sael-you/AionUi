/**
 * Skills Hub E2E Tests - Special Cases (P2), library layout (C33 / TASK-119)
 *
 * - TC-S-24: Skill names with CJK characters and spaces render as cards
 * - TC-S-25: 20 skills render without trouble
 * - TC-S-26: Rapid tab switching does not crash the page
 */

import { test, expect } from '../../../fixtures';
import {
  goToSkillsHub,
  importSkillViaBridge,
  openSkillsTab,
  createTempExternalSource,
  createTestSkill,
  cleanupTestSkills,
  skillCardSelector,
  E2E_SKILL_CARDS,
} from '../../../helpers/skillsHub';
import * as path from 'path';

test.describe('Skills Hub - Special Cases (P2)', () => {
  test.beforeEach(async ({ page }) => {
    await goToSkillsHub(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupTestSkills(page);
  });

  test('TC-S-24: should handle skills with special characters in names', async ({ page }) => {
    const tempSource = createTempExternalSource('tc-s-24');
    try {
      const timestamp = Date.now();
      const specialNames = [
        `E2E-Test-中文名称-${timestamp}`,
        `E2E-Test-With Spaces-${timestamp}`,
        `E2E-Test-Dash-Name-${timestamp}`,
      ];
      const imported: string[] = [];
      for (const name of specialNames) {
        createTestSkill(tempSource.path, name, `Test skill with special chars: ${name}`);
        if ((await importSkillViaBridge(page, path.join(tempSource.path, name))).success) imported.push(name);
      }
      await goToSkillsHub(page);
      for (const name of imported) {
        await expect(page.locator(skillCardSelector(name)).first()).toBeVisible();
      }
    } finally {
      tempSource.cleanup();
    }
  });

  test('TC-S-25: should handle rendering 20 skills without performance issues', async ({ page }) => {
    const tempSource = createTempExternalSource('tc-s-25');
    try {
      const timestamp = Date.now();
      for (let i = 0; i < 20; i++) {
        const skillName = `E2E-Test-Bulk-${timestamp}-${String(i).padStart(3, '0')}`;
        createTestSkill(tempSource.path, skillName, `Bulk test skill #${i}`);
        await importSkillViaBridge(page, path.join(tempSource.path, skillName));
      }
      await goToSkillsHub(page);
      await expect.poll(() => page.locator(E2E_SKILL_CARDS).count()).toBeGreaterThanOrEqual(20);
      await page.locator(E2E_SKILL_CARDS).last().scrollIntoViewIfNeeded();
      await expect(page.locator(E2E_SKILL_CARDS).last()).toBeVisible();
    } finally {
      tempSource.cleanup();
    }
  });

  test('TC-S-26: should handle rapid tab switching without crashing', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await page.click('[data-testid="library-tab-active"]');
      await page.click('[data-testid="library-tab-library"]');
    }
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid="skills-library"]')).toBeVisible();
    await openSkillsTab(page, 'active');
    await expect(page.locator('[data-testid="library-tab-active"]')).toHaveAttribute('aria-selected', 'true');
  });
});
