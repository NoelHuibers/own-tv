// Every test fails on uncaught page errors, console errors or CSP violations.
import { test as base, expect, type Page } from '@playwright/test';

export { expect };

export const test = base.extend({
  page: async ({ page }, use) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') {
        problems.push(`console error: ${m.text()}`);
      }
    });
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) =>
        console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`),
      );
    });
    await use(page);
    expect(problems, 'no errors in the page').toEqual([]);
  },
});

// The TV remote's keys, as webOS reports them
const KEYS = { back: 461, red: 403, yellow: 405, blue: 406 } as const;

export async function remote(page: Page, key: keyof typeof KEYS): Promise<void> {
  await page.evaluate(
    (keyCode) =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { keyCode, bubbles: true, cancelable: true }),
      ),
    KEYS[key],
  );
}

export const focused = (page: Page): Promise<string | null> =>
  page.evaluate(() => document.activeElement?.getAttribute('data-fid') ?? null);
