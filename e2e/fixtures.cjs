// Every test fails on uncaught page errors, console errors or CSP violations.
const base = require('@playwright/test');

const test = base.test.extend({
  page: async ({ page }, use) => {
    const problems = [];
    page.on('pageerror', (e) => problems.push('page error: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') problems.push('console error: ' + m.text()); });
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => console.error('CSP violation: ' + e.violatedDirective + ' ' + e.blockedURI));
    });
    await use(page);
    base.expect(problems, 'no errors in the page').toEqual([]);
  },
});

// The TV remote's keys, as webOS reports them
const KEYS = { back: 461, red: 403, yellow: 405, blue: 406 };
async function remote(page, key) {
  await page.evaluate((code) => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: code, bubbles: true, cancelable: true })), KEYS[key]);
}
const focused = (page) => page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-fid'));

module.exports = { test, expect: base.expect, remote, focused };
