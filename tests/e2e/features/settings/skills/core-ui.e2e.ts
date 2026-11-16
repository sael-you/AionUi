/**
 * Skills Hub E2E Tests - Core UI (P0 Priority), library layout (C33 / TASK-119)
 *
 * Test Cases Covered:
 * - TC-S-01: Render the owner's skills as cards in the Library tab
 * - TC-S-05: Delete a custom skill from its drawer with a confirmation modal
 * - TC-S-05b: Batch delete custom skills (Select → cards → Delete)
 * - TC-S-06: No delete action for builtin skills
 *
 * Removed with the external-sources UI (no longer on the page before TASK-119):
 * TC-S-08 (external list), TC-S-10 (import external), TC-S-16 (add custom path), TC-S-19 (export).
 */

import { test, expect } from '../../../fixtures';
import {
  goToSkillsHub,
  refreshSkillsHub,
  getMySkills,
  importSkillViaBridge,
  deleteSkillViaBridge,
  openSkillDrawer,
  createTempExternalSource,
  createTestSkill,
  cleanupTestSkills,
  skillCardSelector,
} from '../../../helpers/skillsHub';
import { takeScreenshot } from '../../../helpers/screenshots';
import * as path from 'path';

test.describe('Skills Hub - Core UI (P0)', () => {
  test.beforeEach(async ({ page }) => {
    await goToSkillsHub(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupTestSkills(page);
  });

  test('TC-S-01: should render custom skills as cards in the Library tab', async ({ page }) => {
    const tempSource = createTempExternalSource('tc-s-01');
    try {
      createTestSkill(tempSource.path, 'E2E-Test-Builtin', 'Builtin-like test skill');
      createTestSkill(tempSource.path, 'E2E-Test-Custom', 'Custom test skill');
      await importSkillViaBridge(page, path.join(tempSource.path, 'E2E-Test-Builtin'));
      await importSkillViaBridge(page, path.join(tempSource.path, 'E2E-Test-Custom'));

      await page.reload();
      await goToSkillsHub(page);

      const builtinCard = page.locator(skillCardSelector('E2E-Test-Builtin')).first();
      const customCard = page.locator(skillCardSelector('E2E-Test-Custom')).first();
      await expect(builtinCard).toBeVisible();
      await expect(customCard).toBeVisible();
      await expect(builtinCard).toContainText('E2E-Test-Builtin');
      await expect(customCard).toContainText('Custom test skill');
      await takeScreenshot(page, 'skills-hub/tc-s-01/01-library-cards.png');

      const testSkills = (await getMySkills(page)).filter((s) => s.name.startsWith('E2E-Test-'));
      expect(testSkills.map((s) => s.name).toSorted()).toEqual(['E2E-Test-Builtin', 'E2E-Test-Custom']);
    } finally {
      await deleteSkillViaBridge(page, 'E2E-Test-Builtin');
      await deleteSkillViaBridge(page, 'E2E-Test-Custom');
      tempSource.cleanup();
    }
  });

  test('TC-S-05: should delete custom skill from its drawer with confirmation modal', async ({ page }) => {
    const skillName = `E2E-Test-Delete-Target-${Date.now()}`;
    const tempSource = createTempExternalSource('tc-s-05');
    try {
      createTestSkill(tempSource.path, skillName, 'Skill to be deleted');
      expect((await importSkillViaBridge(page, path.join(tempSource.path, skillName))).success).toBe(true);
      await refreshSkillsHub(page);

      const targetCard = page.locator(skillCardSelector(skillName)).first();
      await expect(targetCard).toBeVisible();

      await openSkillDrawer(page, skillName);
      await page.click('[data-testid="skill-drawer-delete"]');

      const modal = page.locator('.modal-delete-skill .arco-modal');
      await expect(modal).toBeVisible();
      await expect(modal.locator('.arco-modal-title')).toBeVisible();
      await takeScreenshot(page, 'skills-hub/tc-s-05/01-confirmation-modal.png');

      await modal.locator('.arco-btn-primary').click();
      await expect(modal).not.toBeVisible();
      await page.waitForSelector('.arco-message-success', { timeout: 5000 });
      await page.waitForTimeout(1000);

      await expect(page.locator(skillCardSelector(skillName))).toHaveCount(0);
      expect((await getMySkills(page)).find((s) => s.name === skillName)).toBeUndefined();
    } finally {
      tempSource.cleanup();
    }
  });

  test('TC-S-05b: should batch delete custom skills via Select', async ({ page }) => {
    const stamp = Date.now();
    const skillNames = [`E2E-Test-Batch-A-${stamp}`, `E2E-Test-Batch-B-${stamp}`, `E2E-Test-Batch-C-${stamp}`];
    const tempSource = createTempExternalSource('tc-s-05b');
    try {
      for (const name of skillNames) {
        createTestSkill(tempSource.path, name, 'Skill for batch deletion');
        expect((await importSkillViaBridge(page, path.join(tempSource.path, name))).success).toBe(true);
      }
      await refreshSkillsHub(page);

      await page.click('[data-testid="library-batch-start"]');
      const batchDelete = page.locator('[data-testid="library-batch-delete"]');
      await expect(batchDelete).toBeVisible();
      await expect(batchDelete).toBeDisabled();

      // In batch mode a card's name selects it.
      for (const name of skillNames.slice(0, 2)) {
        await page.locator(skillCardSelector(name)).first().locator('[data-testid="library-card-open"]').click();
      }
      await expect(batchDelete).toBeEnabled();
      await takeScreenshot(page, 'skills-hub/tc-s-05b/01-two-selected.png');

      await batchDelete.click();
      const modal = page.locator('.modal-delete-skill .arco-modal');
      await expect(modal).toBeVisible();
      await modal.locator('.arco-btn-primary').click();
      await expect(modal).not.toBeVisible();
      await page.waitForSelector('.arco-message-success', { timeout: 5000 });
      await page.waitForTimeout(1000);

      await expect(page.locator('[data-testid="library-batch-bar"]')).not.toBeVisible();
      await expect(page.locator(skillCardSelector(skillNames[0]))).toHaveCount(0);
      await expect(page.locator(skillCardSelector(skillNames[1]))).toHaveCount(0);
      await expect(page.locator(skillCardSelector(skillNames[2])).first()).toBeVisible();

      const remaining = (await getMySkills(page)).map((s) => s.name);
      expect(remaining).not.toContain(skillNames[0]);
      expect(remaining).not.toContain(skillNames[1]);
      expect(remaining).toContain(skillNames[2]);
    } finally {
      for (const name of skillNames) {
        await deleteSkillViaBridge(page, name);
      }
      tempSource.cleanup();
    }
  });

  test('TC-S-06: should not offer delete for builtin skills', async ({ page }) => {
    const builtinSkills = (await getMySkills(page)).filter((s) => s.source === 'builtin');
    // Env-gated: dev-mode sandboxes may have no builtin skills (they ship with packaged builds).
    if (builtinSkills.length === 0) {
      test.skip(true, 'No builtin skills available in this env — skipping delete visibility check');
      return;
    }
    const first = builtinSkills[0];
    await expect(page.locator(skillCardSelector(first.name)).first()).toBeVisible();

    await openSkillDrawer(page, first.name);
    await expect(page.locator('[data-testid="skill-drawer-delete"]')).toHaveCount(0);
    await takeScreenshot(page, 'skills-hub/tc-s-06/01-builtin-drawer-no-delete.png');
  });
});
