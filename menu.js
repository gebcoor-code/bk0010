// A drop-down menu from a button (Files ▾, Disks ▾ of File Commander), drawn as a compact usel list.
// UnrealMenu.attach(button, [[label, note, fn], ...], { within: element })
//   label: the item; note: a dim word after it ('' for none); fn: what the item does
//   within: the window the menu stays inside (default: the button's .fwin / [role=dialog] / [data-usel-window], else the screen)
// Closes on a click elsewhere, Esc, a resize; a second click on the same button closes it too.
(function () {
  'use strict';
  let pop = null;
  function close() { if (!pop) return; pop.btn.classList.remove('open'); pop.remove(); pop = null; }
  function attach(btn, items, o = {}) {
    btn.classList.add('menubtn');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const was = pop && pop.btn === btn; close(); if (was) return;
      const p = document.createElement('div'); p.className = 'usel-pop compact'; p.btn = btn; p.setAttribute('role', 'menu');
      for (const [t, d, fn] of items) {
        const it = document.createElement('div'); it.className = 'usel-it'; it.textContent = t; it.setAttribute('role', 'menuitem');
        if (d) { const s = document.createElement('span'); s.className = 'd'; s.textContent = d; it.appendChild(s); }
        it.addEventListener('click', (ev) => { ev.stopPropagation(); close(); fn(); });
        it.addEventListener('pointermove', () => { p.querySelectorAll('.hot').forEach((x) => x.classList.remove('hot')); it.classList.add('hot'); });
        p.appendChild(it);
      }
      document.body.appendChild(p); pop = p; btn.classList.add('open');
      const win = o.within || btn.closest('[data-usel-window], .fwin, [role="dialog"]');
      const r = btn.getBoundingClientRect(), h = p.offsetHeight, w = p.offsetWidth;
      const wr = win ? win.getBoundingClientRect() : { left: 0, right: innerWidth, bottom: innerHeight };
      const wl = Math.max(wr.left, 0) + 4, wrr = Math.min(wr.right, innerWidth) - 4, wb = Math.min(wr.bottom, innerHeight) - 4;
      p.style.left = Math.max(wl, Math.min(r.left, wrr - w)) + 'px'; // from the button's left, moved left at the window's right edge
      p.style.top = (r.bottom + 2 + h <= wb ? r.bottom + 2 : Math.max(4, r.top - 2 - h)) + 'px'; // down when it fits, else up
    });
  }
  document.addEventListener('pointerdown', (e) => { if (pop && !pop.contains(e.target) && !pop.btn.contains(e.target)) close(); }, true);
  window.addEventListener('keydown', (e) => { if (pop && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }, true); // before any window's own Esc
  new MutationObserver(() => { if (pop && !pop.btn.getClientRects().length) close(); }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
  window.addEventListener('resize', close);
  window.UnrealMenu = { attach, close, isOpen: () => !!pop };
})();
