import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomBytes } from 'node:crypto';
async function tokenFor(email: string) {
  for (let n = 0; n < 80; n++) {
    const list = (await fetch('http://localhost:8025/api/v1/messages').then((r) => r.json())) as {
      messages: { ID: string; To: { Address: string }[] }[];
    };
    for (const m of list.messages.filter((m) => m.To.some((t) => t.Address === email))) {
      const d = (await fetch('http://localhost:8025/api/v1/message/' + m.ID).then((r) =>
        r.json(),
      )) as { Text: string };
      const token = d.Text.match(/\/verify\?token=([A-Za-z0-9_-]+)/)?.[1];
      if (token) return token;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Verification email was not delivered');
}
test('public pages are keyboard accessible and have no automated WCAG AA violations', async ({
  page,
}) => {
  for (const path of ['/', '/login', '/register', '/developers']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(result.violations, JSON.stringify(result.violations)).toEqual([]);
  }
  await page.goto('/');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe(
    'auto',
  );
  const accessibilityTree = await page.locator('main').ariaSnapshot();
  expect(accessibilityTree).toContain('heading');
  expect(accessibilityTree).toContain('link');
  await page.keyboard.press('Tab');
  await expect(page.getByText('Skip to content')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/landing-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/landing-desktop.png', fullPage: true });
});
test('register, verify, create identity, edit private claims, publish and use a passkey', async ({
  page,
  context,
}) => {
  const name = 'e2e' + randomBytes(5).toString('hex'),
    email = name + '@example.test',
    password = 'A-browser-test-password-2026!';
  await page.goto('/register');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create your account' }).click();
  await expect(page.getByRole('status')).toContainText('verification email');
  const token = await tokenFor(email);
  await page.goto('/verify?token=' + token);
  await expect(page.getByRole('status')).toContainText('Email verified');
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.getByLabel('Display name').fill('Browser Test');
  await page.getByLabel(/^Handle/).fill(name);
  await page.getByRole('button', { name: 'Create identity', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tell your story.' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Field', exact: true }).selectOption('core:bio');
  await page.getByLabel('Value', { exact: true }).fill('Private browser biography');
  await page.getByRole('button', { name: 'Save field' }).click();
  await expect(page.getByRole('status')).toContainText('Field saved');
  await page
    .getByRole('combobox', { name: 'Field', exact: true })
    .selectOption('core:display_name');
  await page.getByLabel('Who can see this field?').selectOption('PUBLIC');
  await page.getByLabel('API access', { exact: true }).check();
  await page.getByLabel('Machine representations', { exact: true }).check();
  await page.getByLabel('Search engines', { exact: true }).check();
  await page.getByRole('button', { name: 'Save field' }).click();
  await expect(page.getByRole('status')).toContainText('Field saved');
  await page.getByRole('button', { name: 'Privacy', exact: true }).click();
  await page.getByLabel('Profile visibility').selectOption('PUBLIC');
  await page.getByRole('button', { name: 'Save privacy settings' }).click();
  await expect(page.getByRole('status')).toContainText('Privacy settings saved');
  const publicPage = await context.newPage();
  await publicPage.goto('/u/' + name);
  await expect(
    publicPage.getByRole('heading', { name: 'Browser Test', exact: true }),
  ).toBeVisible();
  expect(await publicPage.content()).not.toContain('Private browser biography');
  await publicPage.close();
  await page.getByRole('button', { name: 'Profile blocks', exact: true }).click();
  for (const title of ['First biography', 'Second biography']) {
    await page.getByLabel('Block title', { exact: true }).fill(title);
    await page.getByLabel('Content', { exact: true }).fill('Saved public block content');
    await page.getByLabel('Enable this block', { exact: true }).check();
    await page.getByLabel('Publish this block', { exact: true }).check();
    await page.getByRole('button', { name: 'Save block', exact: true }).click();
    await expect(page.locator('.list-row').filter({ hasText: title })).toHaveCount(1);
  }
  const blockRows = page
    .locator('.list-row')
    .filter({ has: page.getByRole('button', { name: 'Edit block', exact: true }) });
  await blockRows.nth(1).getByRole('button', { name: 'Move up', exact: true }).click();
  await expect(blockRows.first()).toContainText('Second biography');
  await page.getByRole('button', { name: 'Refresh preview', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Saved profile preview', exact: true });
  await expect(preview).toContainText('Browser Test');
  await expect(preview).not.toContainText('Private browser biography');
  await page.getByRole('combobox', { name: /^Preview width/ }).selectOption('390px');
  await expect(preview).toHaveCSS('width', '390px');
  await page.getByRole('combobox', { name: /^Preview audience/ }).selectOption('OWNER');
  await page.getByRole('button', { name: 'Refresh preview', exact: true }).click();
  await expect(preview).toContainText('Private browser biography');
  const compositionA11y = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(compositionA11y.violations, JSON.stringify(compositionA11y.violations)).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'New identity', exact: true }).click();
  await page.getByLabel('Display name').fill('Browser Organization');
  await page.getByLabel(/^Handle/).fill(name + '_org');
  await page.getByLabel('Identity type').selectOption('ORGANIZATION');
  await page.getByRole('button', { name: 'Create identity', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tell your story.' })).toBeVisible();
  await page.getByRole('button', { name: 'Privacy', exact: true }).click();
  await page.getByLabel('Profile visibility').selectOption('PUBLIC');
  await page.getByRole('button', { name: 'Save privacy settings' }).click();
  await expect(page.getByRole('status')).toContainText('Privacy settings saved');
  const requestOrigin = process.env.TEST_WEB_ORIGIN ?? 'http://localhost:8080';
  const personResponse = await page.request.get(requestOrigin + '/api/v1/profiles/' + name);
  const organizationResponse = await page.request.get(
    requestOrigin + '/api/v1/profiles/' + name + '_org',
  );
  expect(personResponse.ok()).toBeTruthy();
  expect(organizationResponse.ok()).toBeTruthy();
  const person = (await personResponse.json()) as { id: string };
  const organization = (await organizationResponse.json()) as { id: string };
  await page.getByLabel('Active identity').selectOption(person.id);
  await page.getByRole('button', { name: 'Relationships', exact: true }).click();
  await page.getByLabel('Target public handle or identity ID').fill(name + '_org');
  await page.getByRole('combobox', { name: 'Relationship', exact: true }).selectOption('works_at');
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Relationship requested');
  await page.getByLabel('Active identity').selectOption(organization.id);
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Relationship confirmed');
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Relationship revoked');
  await expect(page.getByText('No active relationships yet.', { exact: true })).toBeVisible();
  const relationshipAccessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    relationshipAccessibility.violations,
    JSON.stringify(relationshipAccessibility.violations),
  ).toEqual([]);
  await page.getByLabel('Active identity').selectOption(person.id);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibility.violations, JSON.stringify(accessibility.violations)).toEqual([]);
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Account settings', exact: true }).click();
  await page.getByRole('combobox', { name: /^Language/ }).selectOption('fa');
  await page.getByLabel('IANA timezone').fill('Asia/Tehran');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Language and timezone saved.');
  await expect(page.locator('[data-account-locale="fa"]')).toHaveAttribute('dir', 'rtl');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const rtlAccessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(rtlAccessibility.violations, JSON.stringify(rtlAccessibility.violations)).toEqual([]);
  await page.getByRole('combobox', { name: /^Language/ }).selectOption('en');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.locator('[data-account-locale="en"]')).toHaveAttribute('dir', 'ltr');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.getByRole('button', { name: 'Security', exact: true }).click();
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Add a passkey', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Passkey added');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/login/);
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page).toHaveURL(/dashboard/);
  for (const [identityId, handle] of [
    [person.id, name],
    [organization.id, name + '_org'],
  ]) {
    const deleted = await page.request.delete(requestOrigin + '/api/v1/identities/' + identityId, {
      headers: { Origin: requestOrigin },
      data: { confirmation: handle },
    });
    expect(deleted.ok()).toBeTruthy();
  }
});
test('anonymous dashboard access redirects to sign in', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/login/);
});
