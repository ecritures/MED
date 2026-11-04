// Gallery under the large photo: three square photos at a time; with more than three,
// the arrows move one photo on or back. Without JavaScript the row simply scrolls sideways.
for (const gallery of document.querySelectorAll(".h-gallery")) {
  const track = gallery.querySelector(".h-gallery-track");
  const nav = gallery.querySelector(".h-gallery-nav");
  if (nav) {
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

  // Clicking a photo opens it large on this page, with the author, the licence and a link to Commons.
  if (typeof HTMLDialogElement !== "function") continue; // very old browsers: the link goes to Commons
  const dialog = document.createElement("dialog");
  dialog.className = "h-lightbox";
  dialog.innerHTML = `<figure>
    <button type="button" class="h-lightbox-close" aria-label=""><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2 2l12 12M14 2 2 14"/></svg></button>
    <img alt="">
    <figcaption><span class="h-lightbox-credit"></span>
      <a class="h-lightbox-commons" rel="noopener"><svg viewBox="0 0 12 16" width="9" height="12" aria-hidden="true"><path d="M2.5 1.5 9 8l-6.5 6.5"/></svg><span></span></a></figcaption>
  </figure>`;
  const img = dialog.querySelector("img");
  const closeBtn = dialog.querySelector(".h-lightbox-close");
  const commons = dialog.querySelector(".h-lightbox-commons");
  closeBtn.setAttribute("aria-label", gallery.dataset.close || "Close");
  commons.querySelector("span").textContent = gallery.dataset.commons || "Wikimedia Commons";
  closeBtn.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); }); // click beside the photo
  document.body.append(dialog);

  for (const a of track.querySelectorAll("a[data-full]")) {
    a.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return; // opening in a new tab still goes to Commons
      e.preventDefault();
      img.src = a.dataset.full;
      img.alt = a.querySelector("img")?.alt || "";
      dialog.querySelector(".h-lightbox-credit").textContent = a.dataset.credit ? a.dataset.credit + "." : "";
      commons.href = a.href;
      dialog.showModal();
    });
  }
}
