const fs = require('fs');
const path = require('path');
const { chromium, firefox, webkit } = require('@playwright/test');

async function main() {
  const baseUrl = process.argv[2] || 'http://127.0.0.1:4173';
  const evidenceDir = path.resolve(process.argv[3] || './evidence/phase-4-scenario1');
  const browserName = (process.argv[4] || 'Chromium').toLowerCase();
  const browserLabel = browserName === 'webkit' ? 'WebKit' : browserName[0].toUpperCase() + browserName.slice(1);
  fs.mkdirSync(evidenceDir, { recursive: true });
  const startedAt = new Date();
  const consoleErrors = [];
  let browser;
  try {
    if (browserName === 'chromium') browser = await chromium.launch({ headless: true });
    else if (browserName === 'firefox') browser = await firefox.launch({ headless: true });
    else if (browserName === 'webkit') browser = await webkit.launch({ headless: true });
    else if (browserName === 'edge') browser = await chromium.launch({ headless: true, channel: 'msedge' });
    else throw new Error(`Unsupported browser: ${browserName}`);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Quality at a glance' }).waitFor();
    await page.getByRole('link', { name: 'Create test' }).click();
    await page.getByRole('heading', { name: 'Test builder' }).waitFor();
    await page.getByLabel('Test name').fill('Scenario 1 automated browser proof');
    await page.getByLabel('Preview URL').fill(`${baseUrl}/dashboard`);
    const preview = page.frameLocator('iframe[title="Application preview"]');
    await preview.getByRole('heading', { name: 'Quality at a glance' }).waitFor();
    await page.getByRole('button', { name: 'Pick element' }).click();
    await preview.getByRole('heading', { name: 'Quality at a glance' }).click();
    await page.locator('.selector-result code').waitFor();
    const selector = (await page.locator('.selector-result code').textContent() || '').trim();
    if (!selector || selector.includes('prova-selector-highlight')) throw new Error(`Captured selector is not stable: ${selector}`);
    await page.getByRole('button', { name: 'Save test' }).click();
    await page.getByText('Browser test saved successfully.').waitFor();
    await page.screenshot({ path: path.join(evidenceDir, `scenario-1-${browserName}-test-saved.png`), fullPage: true });
    await page.getByRole('button', { name: 'Run browser test' }).click();
    await page.getByRole('heading', { name: 'Executions' }).waitFor();
    await page.getByText('PASS', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(evidenceDir, `scenario-1-${browserName}-pass.png`), fullPage: true });
    const result = {
      scenario: 1,
      result: 'PASS',
      testName: 'Scenario 1 automated browser proof',
      selector,
      browser: browserLabel,
      consoleErrors,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      details: 'Studio created, saved, and executed a browser test successfully in Chromium.'
    };
    fs.writeFileSync(path.join(evidenceDir, `scenario-1-${browserName}-result.json`), JSON.stringify(result, null, 2));
  } catch (error) {
    const result = {
      scenario: 1,
      result: 'FAILED',
      browser: browserLabel,
      consoleErrors,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      details: error instanceof Error ? error.message : String(error)
    };
    fs.writeFileSync(path.join(evidenceDir, `scenario-1-${browserName}-result.json`), JSON.stringify(result, null, 2));
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
