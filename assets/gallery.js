// Gallery under the large photo: three square photos at a time; with more than three,
// the arrows move one photo on or back. Without JavaScript the row simply scrolls sideways.
for (const gallery of document.querySelectorAll(".h-gallery")) {
  const track = gallery.querySelector(".h-gallery-track");
  const nav = gallery.querySelector(".h-gallery-nav");
  if (!nav) continue;
  const items = [...track.children];
  const count = gallery.querySelector(".h-gallery-count");
  const [prev, next] = nav.querySelectorAll("button");
  const per = 3; // photos in view
  let start = 0;
  const show = () => {
    items.forEach((li, i) => (li.hidden = i < start || i >= start + per));
    count.textContent = `${start + 1}–${Math.min(start + per, items.length)} ${gallery.dataset.of} ${items.length}`;
    prev.disabled = start === 0;
    next.disabled = start + per >= items.length;
  };
  prev.addEventListener("click", () => { start = Math.max(0, start - 1); show(); });
  next.addEventListener("click", () => { start = Math.min(items.length - per, start + 1); show(); });
  gallery.classList.add("is-paged");
  nav.hidden = false;
  show();
}
