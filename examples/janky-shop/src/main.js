import { renderCatalog } from './catalog.js';
import { drawHero } from './hero-gl.js';
import { followScroll } from './sticky-header.js';
import { startTicker } from './ticker.js';
import { setupCart } from './cart.js';

const products = renderCatalog(document.querySelector('[data-grid]'));
drawHero(document.querySelector('[data-hero]'));
followScroll(document.querySelectorAll('.card'));
startTicker(document.querySelector('[data-ticker]'));
setupCart(products);
