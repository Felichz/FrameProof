// Opening the cart and closing it again, as a shopper does.
export default {
  name: 'open-cart',
  setup: async ({ page, url }) => {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('.card');
  },
  steps: [
    {
      name: 'open',
      act: ({ page }) => page.click('[data-cart-button]'),
      done: ({ page }) => page.waitForSelector('dialog[open]'),
    },
    {
      name: 'close',
      act: ({ page }) => page.keyboard.press('Escape'),
      done: ({ page }) => page.evaluate(() => !document.querySelector('dialog[open]') && !document.body.classList.contains('cart-open')),
    },
  ],
};
