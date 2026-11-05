// Each card's stock badge grows a little as the page scrolls past it.
export function followScroll(cards) {
  const list = [...cards];
  window.addEventListener('scroll', () => {
    for (const card of list) {
      const top = card.offsetTop;
      const badge = card.querySelector('.badge');
      badge.style.width = `${40 + Math.max(0, Math.min(30, (scrollY + innerHeight - top) / 20))}px`;
    }
  });
}
