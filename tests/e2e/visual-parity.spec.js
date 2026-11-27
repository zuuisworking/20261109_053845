const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('@playwright/test');
const { PNG } = require('pngjs');
const { default: pixelmatch } = require('pixelmatch');

// Sanitized, data-free fixture derived from the supplied static login screen.
// It contains no customer, guest, or measurement records and is safe for CI.
const staticReference = path.resolve(__dirname, 'fixtures/static-login.html');

test('@visual login preserves the supplied visual identity', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => globalThis.document.fonts?.ready);

  const currentScreenshot = await page.screenshot({
    animations: 'disabled',
    fullPage: false,
  });

  const referencePage = await page.context().newPage();
  await referencePage.setViewportSize(page.viewportSize());
  await referencePage.goto(pathToFileURL(staticReference).href, {
    waitUntil: 'domcontentloaded',
  });
  await referencePage.evaluate(() => globalThis.document.fonts?.ready);
  await referencePage.waitForTimeout(1000);

  const referenceScreenshot = await referencePage.screenshot({
    animations: 'disabled',
    fullPage: false,
  });
  await referencePage.close();

  const current = PNG.sync.read(currentScreenshot);
  const reference = PNG.sync.read(referenceScreenshot);
  expect(current.width).toBe(reference.width);
  expect(current.height).toBe(reference.height);

  const difference = new PNG({ width: current.width, height: current.height });
  const changedPixels = pixelmatch(
    reference.data,
    current.data,
    difference.data,
    current.width,
    current.height,
    { threshold: 0.12, includeAA: false },
  );
  const changedRatio = changedPixels / (current.width * current.height);

  expect(changedRatio).toBeLessThan(0.12);
});
