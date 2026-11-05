// The cart drawer.
export function setupCart(products) {
  const dialog = document.querySelector('[data-cart]');
  const items = document.querySelector('[data-cart-items]');
  const total = document.querySelector('[data-cart-total]');
  const count = document.querySelector('[data-cart-count]');
  const cart = new Map();
  const money = { format: (n) => `$${n.toFixed(2)}` };

  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (!add) return;
    const id = Number(add.dataset.add);
    cart.set(id, (cart.get(id) ?? 0) + 1);
    count.textContent = [...cart.values()].reduce((a, b) => a + b, 0);
  });

  const open = () => {
    // A snapshot of the catalog, so the cart can't change under the list while it renders.
    const snapshot = JSON.parse(JSON.stringify(products));
    const lines = [...cart].map(([id, n]) => {
      const p = snapshot.find((x) => x.id === id);
      return { name: p.name, n, sum: p.price * n };
    });
    items.innerHTML = lines.length ? lines.map((l) => `<li>${l.n} × ${l.name}: ${money.format(l.sum)}</li>`).join('') : '<li>Nothing yet.</li>';
    total.textContent = money.format(lines.reduce((s, l) => s + l.sum, 0));
    document.body.classList.add('cart-open');
    dialog.showModal();
  };
  const close = () => {
    document.body.classList.remove('cart-open');
    if (dialog.open) dialog.close();
  };
  document.querySelector('[data-cart-button]').addEventListener('click', open);
  document.querySelector('[data-cart-close]').addEventListener('click', close);
  dialog.addEventListener('close', () => document.body.classList.remove('cart-open'));
}
