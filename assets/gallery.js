// Gallery under the map: three square photos at a time; with more than three,
// the arrows move three photos on. Without JavaScript the row simply scrolls sideways.
for (const gallery of document.querySelectorAll(".h-gallery")) {
  const track = gallery.querySelector(".h-gallery-track");
  const nav = gallery.querySelector(".h-gallery-nav");
  if (!nav) continue;
  const items = [...track.children];
  const count = gallery.querySelector(".h-gallery-count");
  const [prev, next] = nav.querySelectorAll("button");
  const per = 3;
  let start = 0;
  const show = () => {
    items.forEach((li, i) => (li.hidden = i < start || i >= start + per));
    count.textContent = `${start + 1}–${Math.min(start + per, items.length)} ${gallery.dataset.of} ${items.length}`;
    prev.disabled = start === 0;
    next.disabled = start + per >= items.length;
  };
  prev.addEventListener("click", () => { start = Math.max(0, start - per); show(); });
  next.addEventListener("click", () => { start = Math.min(items.length - 1, start + per); show(); });
  gallery.classList.add("is-paged");
  nav.hidden = false;
  show();
}
