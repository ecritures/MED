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

// Clicking the large photo or a gallery photo opens it large on this page, with the author,
// the licence and a link to Wikimedia Commons. Without JavaScript the link goes to Commons.
const aside = document.querySelector(".h-images");
const photoLinks = aside ? aside.querySelectorAll("a[data-full]") : [];
if (photoLinks.length && typeof HTMLDialogElement === "function") {
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
  closeBtn.setAttribute("aria-label", aside.dataset.close || "Close");
  commons.querySelector("span").textContent = aside.dataset.commons || "Wikimedia Commons";
  closeBtn.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); }); // click beside the photo
  dialog.addEventListener("close", () => img.removeAttribute("src"));
  document.body.append(dialog);

  for (const a of photoLinks) {
    a.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // a new tab still goes to Commons
      e.preventDefault();
      const thumb = a.querySelector("img");
      img.src = thumb?.currentSrc || thumb?.src || ""; // show the small version at once…
      const full = new Image();
      full.onload = () => { if (dialog.open) img.src = full.src; }; // …and swap in the large one when it arrives
      full.src = a.dataset.full;
      img.alt = thumb?.alt || "";
      dialog.querySelector(".h-lightbox-credit").textContent = a.dataset.credit ? a.dataset.credit + "." : "";
      commons.href = a.href;
      dialog.showModal();
    });
  }
}
