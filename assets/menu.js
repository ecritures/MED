// "Landen" menu: close it when clicking elsewhere or pressing Escape.
const menus = document.querySelectorAll(".nav-menu");
document.addEventListener("click", (e) => {
  for (const m of menus) if (m.open && !m.contains(e.target)) m.open = false;
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  for (const m of menus) if (m.open) { m.open = false; m.querySelector("summary").focus(); }
});
