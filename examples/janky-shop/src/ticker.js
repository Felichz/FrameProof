// The promo line in the header, nudged so it reads as alive.
export function startTicker(el) {
  let x = 0;
  const step = () => {
    x = (x + 0.2) % 2;
    el.style.transform = `translateX(${x.toFixed(2)}px)`;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
