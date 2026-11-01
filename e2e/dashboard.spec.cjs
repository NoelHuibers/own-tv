const { test, expect, remote, focused } = require('./fixtures.cjs');

const open = (page, mode) => page.goto('/index.html?preview=' + mode);

test.describe('preview modes', () => {
  test('sample data fills every widget and labels itself as a preview', async ({ page }) => {
    await open(page, 'sample');
    await expect(page.locator('#banner')).toContainText('Nothing is read from a TV');
    await expect(page.locator('#apps .card')).toHaveCount(7);
    const shelf = page.locator('#shelf');
    await expect(shelf).toContainText('Weather');
    await expect(shelf).toContainText('Sample City');
    await expect(shelf).toContainText('Sample · Film night');
    await expect(shelf).toContainText('46 °C');
  });

  test('an unconfigured TV shows setup prompts, not invented values', async ({ page }) => {
    await open(page, 'empty');
    const shelf = page.locator('#shelf');
    await expect(shelf).toContainText('Add your city');
    await expect(shelf).toContainText('Connect calendar');
    await expect(shelf).not.toContainText('°C');
  });

  test('a failing bridge degrades every live widget to unavailable', async ({ page }) => {
    await open(page, 'error');
    await expect(page.locator('#top')).toContainText('Preview · failing bridge');
    const shelf = page.locator('#shelf');
    await expect(shelf.getByText('unavailable')).not.toHaveCount(0);
    await expect(page.locator('#apps .card')).toHaveCount(7);
  });
});

test.describe('remote control', () => {
  test('the D-pad moves focus and Back returns to the first app', async ({ page }) => {
    await open(page, 'sample');
    await expect.poll(() => focused(page)).toBe('plate:youtube');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => focused(page)).not.toBe('plate:youtube');
    expect(await focused(page)).toMatch(/^plate:/);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => focused(page)).not.toMatch(/^plate:/);
    await remote(page, 'back');
    await expect.poll(() => focused(page)).toBe('plate:youtube');
  });

  test('the blue key opens settings with its sections and Back closes them', async ({ page }) => {
    await open(page, 'sample');
    await expect.poll(() => focused(page)).toBe('plate:youtube');
    await remote(page, 'blue');
    await expect(page.locator('#sheet')).toBeVisible();
    await expect.poll(() => focused(page)).toBe('nav:apps');
    for (const section of ['apps', 'widgets', 'appearance', 'language', 'weather', 'calendar', 'backup', 'about']) {
      await expect(page.locator(`[data-fid="nav:${section}"]`)).toBeVisible();
    }
    await remote(page, 'back');
    await expect(page.locator('#sheet')).toBeHidden();
  });

  test('the weather app opens from its widget and Back leaves it', async ({ page }) => {
    await open(page, 'sample');
    await page.locator('#shelf [data-action="open-weather"]').first().click();
    const weather = page.locator('#weather-app');
    await expect(weather).toBeVisible();
    await expect(weather).toContainText('Sample data · no TV data');
    await expect(weather).toContainText('7 days');
    await remote(page, 'back');
    await expect(weather).toBeHidden();
  });
});

test.describe('languages and layout', () => {
  test('German is built in and switches the whole dashboard', async ({ page }) => {
    await open(page, 'sample');
    await remote(page, 'blue');
    await page.locator('[data-fid="nav:language"]').click();
    await page.locator('[data-action="lang-set"][data-arg="de"]').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await remote(page, 'back');
    await remote(page, 'back');
    await expect(page.locator('#top')).toContainText('Vorschau · Beispieldaten');
  });

  test('a right-to-left locale mirrors the layout', async ({ page }) => {
    await open(page, 'sample');
    await remote(page, 'blue');
    await page.locator('[data-fid="nav:language"]').click();
    await page.locator('.locale-picker input').fill('ar-EG');
    await page.locator('[data-action="locale-apply"]').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar-EG');
  });

  test('the dashboard fits the screen without scrolling sideways', async ({ page }) => {
    await open(page, 'sample');
    await expect(page.locator('#apps .card')).toHaveCount(7);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
