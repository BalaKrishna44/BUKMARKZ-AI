import { expect, test as setup } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/** Signs in once through the real /login form and saves the cookies for the `authed` project. */
setup('sign in as the E2E test account', async ({ page }) => {
  const email = process.env.E2E_EMAIL, password = process.env.E2E_PASSWORD;
  if (!email || !password) throw new Error('Set E2E_EMAIL and E2E_PASSWORD (a dedicated test account on a staging/preview Supabase project).');
  await page.goto('/login?next=/dashboard');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard**');
  await expect(page.getByRole('search')).toBeVisible();
  mkdirSync('e2e/.auth', { recursive: true });
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
});
