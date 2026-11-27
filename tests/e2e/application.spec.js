const { test, expect } = require('@playwright/test');

test('administrator can authenticate and navigate the preserved workflows', async ({ page }) => {
  await page.goto('/');

  const password = process.env.E2E_ADMIN_PASSWORD;
  expect(password, 'E2E_ADMIN_PASSWORD harus dibuat oleh global setup').toBeTruthy();

  await page.getByLabel(/ID Admin/i).fill('e2eadmin');
  await page.getByLabel(/Kata Sandi/i).fill(password);
  await page.getByRole('button', { name: /Masuk/i }).click();

  await expect(page.getByText(/Dashboard/i).first()).toBeVisible();
  await expect(page.getByText(/Total Gardu Trafo/i)).toBeVisible();

  await page.getByText(/Manajemen Trafo/i).first().click();
  await expect(page.getByText(/Manajemen Trafo/i).first()).toBeVisible();

  await page.getByText(/Data Pelanggan/i).first().click();
  await expect(page.getByText(/Data Pelanggan/i).first()).toBeVisible();
});
