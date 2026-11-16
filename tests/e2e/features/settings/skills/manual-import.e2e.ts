/**
 * Skills Hub E2E Tests - Manual Import (P1), library layout (C33 / TASK-119)
 *
 * - TC-S-29: Add Skill → Import Skills with a mocked folder dialog imports the skill
 */

import { test, expect } from '../../../fixtures';
import {
  goToSkillsHub,
  getMySkills,
  createTempExternalSource,
  createTestSkill,
  cleanupTestSkills,
  skillCardSelector,
} from '../../../helpers/skillsHub';
import * as path from 'path';

test.describe('Skills Hub - Manual Import (P1)', () => {
  test.afterEach(async ({ page }) => {
    await cleanupTestSkills(page);
  });

  test('TC-S-29: should import skill from folder via mocked dialog', async ({ page, electronApp }) => {
    const tempSource = createTempExternalSource('tc-s-29');
    try {
      const skillName = `E2E-Test-Manual-Import-${Date.now()}`;
      createTestSkill(tempSource.path, skillName, 'Manual import test skill');
      const skillPath = path.join(tempSource.path, skillName);

      await goToSkillsHub(page);

      await electronApp.evaluate(({ dialog }, targetPath) => {
        const originalShowOpenDialog = dialog.showOpenDialog;
        dialog.showOpenDialog = () => {
          dialog.showOpenDialog = originalShowOpenDialog;
          return Promise.resolve({ canceled: false, filePaths: [targetPath] });
        };
      }, skillPath);

      // Add Skill is a menu button; "Import Skills" is its manual item.
      await page.click('[data-testid="btn-add-skill"]');
      const manual = page.locator('[data-testid="btn-add-skill-manual"]');
      await expect(manual).toBeVisible();
      await manual.click();

      await expect(page.locator('.arco-message-success')).toBeVisible({ timeout: 10000 });

      await goToSkillsHub(page);
      await expect(page.locator(skillCardSelector(skillName)).first()).toBeVisible();

      const importedSkill = (await getMySkills(page)).find((s) => s.name === skillName);
      expect(importedSkill?.source).toBe('custom');
    } finally {
      tempSource.cleanup();
    }
  });
});
