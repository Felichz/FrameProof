// The product grid.
const NAMES = ['Ceramic mug', 'Linen napkin', 'Oak spoon', 'Brass hook', 'Wool throw', 'Clay planter', 'Glass carafe', 'Cotton tote', 'Walnut board', 'Paper lamp', 'Copper pot', 'Rattan basket'];
const COLORS = ['#e76f51', '#f4a261', '#e9c46a', '#2a9d8f', '#264653', '#8ab17d', '#b56576', '#6d597a'];

export function makeProducts(n = 360) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `${NAMES[i % NAMES.length]} no. ${i + 1}`,
    maker: `Studio ${String.fromCharCode(65 + (i % 26))}`,
    price: 9 + ((i * 37) % 120) + 0.99,
    color: COLORS[i % COLORS.length],
    stock: (i * 13) % 40,
  }));
}

/** Every product's price label and its rank by price, worked out up front on a sorted copy of the catalog. */
export function formatPrices(products) {
  const byPrice = [...products].sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
  const rank = new Map(byPrice.map((p, i) => [p.id, i]));
  return new Map(products.map((p) => [p.id, { label: `$${p.price.toFixed(2)}`, rank: rank.get(p.id) }]));
}

export function renderCatalog(grid) {
  const products = makeProducts();
  const prices = formatPrices(products);
  const html = products
    .map(
      (p) => `<article class="card" data-id="${p.id}">
  <div class="swatch" style="background: linear-gradient(135deg, ${p.color}, #fff6)"></div>
  <h3 class="title">${p.name}</h3>
  <p class="meta">${p.maker} · ${p.stock} left</p>
  <div class="row"><span class="badge" style="width: 40px"></span><strong>${prices.get(p.id).label}</strong><button type="button" class="add" data-add="${p.id}">Add</button></div>
</article>`,
    )
    .join('');
  grid.innerHTML = html;
  return products;
}
