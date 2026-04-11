/**
 * TestRail C25085 — Billing Spec Upload/Download Includes Account Min/Max
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25085
 *         (Run 175, label Pepi)
 *
 * Read-only: enables Account Min/Max columns, exports the grid to
 * xlsx, and parses the file to verify the columns contain Y/N values.
 * Never modifies billing spec data.
 *
 * Uses the default `page` with tim1 storageState (GW admin).
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { readXlsxSheet } from '@geowealth/e2e-framework/helpers';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BillingSpecificationsGridPage } from '../../../src/pages/billing-specs/BillingSpecificationsGridPage';

const FIRM_CODE = 1;
const ACCOUNT_MIN_FIELD = 'applyMinFeesOnAccountLevelFlag';
const ACCOUNT_MAX_FIELD = 'applyMaxFeesOnAccountLevelFlag';

test('@regression @billing-servicing C25085 Billing Spec Upload/Download Includes Account Min/Max', async ({
  page,
}) => {
  test.slow();

  const gridPage = new BillingSpecificationsGridPage(page);

  await test.step('Open Billing Specifications grid for firm 1', async () => {
    await gridPage.open(FIRM_CODE);
  });

  await test.step('Ensure Account Min and Account Max columns are enabled', async () => {
    await gridPage.grid.openCustomizeColumns();
    await gridPage.grid.setColumnEnabled(ACCOUNT_MIN_FIELD, true);
    await gridPage.grid.setColumnEnabled(ACCOUNT_MAX_FIELD, true);
    await gridPage.grid.confirmAndReload();
    await expect(gridPage.columnHeader('Account Min').first()).toBeVisible({ timeout: 10_000 });
  });

  let exportPath: string;
  await test.step('Export the grid to xlsx', async () => {
    const download = await gridPage.grid.exportXls();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pepi-c25085-'));
    exportPath = path.join(tmpDir, download.suggestedFilename());
    await download.saveAs(exportPath);
  });

  await test.step('Exported xlsx contains Account Min/Max columns with Y/N values', async () => {
    const { headers, rowsByCol } = readXlsxSheet(fs.readFileSync(exportPath));

    expect(headers, 'export must include Account Min header').toContain('Account Min');
    expect(headers, 'export must include Account Max header').toContain('Account Max');

    const minValues = rowsByCol['Account Min'];
    const maxValues = rowsByCol['Account Max'];
    expect(minValues.length, 'expected at least one data row').toBeGreaterThan(0);
    expect(maxValues.length).toBe(minValues.length);

    for (const v of minValues) {
      expect(['Y', 'N'], `Account Min cell value: ${JSON.stringify(v)}`).toContain(v);
    }
    for (const v of maxValues) {
      expect(['Y', 'N'], `Account Max cell value: ${JSON.stringify(v)}`).toContain(v);
    }
  });
});
