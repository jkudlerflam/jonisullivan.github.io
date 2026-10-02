/*
 * site.js, the behavior of the generated portfolio pages. Mobile menu and top-bar
 * dropdowns (1), lightbox for galleries and image blocks (2a), slideshows (2b),
 * contact form (3), scroll animations (4).
 *
 * Pages are also shown inside the editor's iframe, where the body's innerHTML is
 * replaced many times. Clicks, keys, toggles and submits are therefore handled by
 * listeners bound once on `document`. Only slideshows keep per-element state
 * (counter, thumbnails, autoplay timer). init() sets it up, is safe to call
 * repeatedly, and drops the state of slideshows that have left the document.
 * Editing mode (<html data-editing>) is checked at the moment each event happens.
 */
(function () {
  'use strict';

  // A second copy of this script must not bind a second set of listeners.
  if (window.SiteJS) return;

  var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  // Slideshow: Simple, Slideshow: Full and Slideshow: Reel, and their scrolling tracks.
  var SLIDESHOW = 'section.s-gallery.g-slideshow, section.s-gallery.g-slideshow-full, section.s-gallery.g-reel';
  var TRACK = SLIDESHOW.split(', ').map(function (s) { return s + ' > .g-items'; }).join(', ');

  function editing() { return document.documentElement.hasAttribute('data-editing'); }
  function reducedMotion() { return !!(motionQuery && motionQuery.matches); }
  function isTopbar() { return !!document.body && document.body.classList.contains('layout-topbar'); }
  function hasModifier(e) { return e.altKey || e.ctrlKey || e.metaKey; }
  function toArray(list) { return Array.prototype.slice.call(list); }
  // Targets may be text nodes or nodes from the editor's window, so test nodeType (not instanceof).
  function asElement(n) { return !n ? null : n.nodeType === 1 ? n : n.parentElement || null; }

  /* 1. Mobile menu and top-bar dropdowns ----------------------------------- */

  function setMenu(toggle, open) {
    var id = toggle.getAttribute('aria-controls');
    var nav = (id && document.getElementById(id)) || (toggle.closest('.site-header') || document).querySelector('.nav');
    toggle.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (nav) nav.classList.toggle('open', open);
  }

  // Close the menu if it is open. Returns its toggle, or null.
  function closeMenu() {
    var toggle = document.querySelector('.menu-toggle.open');
    if (toggle) setMenu(toggle, false);
    return toggle;
  }

  // In the top-bar layout, close the open folders that do not contain `keep`
  // (the folder that has just opened, or the element that was clicked).
  function closeFolders(keep) {
    var closed = [];
    if (!isTopbar()) return closed;
    document.querySelectorAll('details.nav-folder[open]').forEach(function (d) {
      if (keep && d.contains(keep)) return;
      d.open = false;
      closed.push(d);
    });
    return closed;
  }

  // Escape peels off one layer at a time, open folders first and then the menu.
  function escapeNav() {
    var active = document.activeElement;
    var folders = closeFolders(null);
    var home = folders.filter(function (d) { return d.contains(active); })[0];
    var summary = home && home.querySelector('summary');
    if (summary) summary.focus();          // focus would otherwise be lost in a closed folder
    if (folders.length) return;
    var toggle = closeMenu();
    if (toggle) toggle.focus();
  }

  /* 2a. Lightbox ------------------------------------------------------------ */

  var LIGHTBOX_CSS = [
    '.lb-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;',
    'background:var(--lb-bg,rgba(255,255,255,.97));color:var(--lb-fg,#111);touch-action:none;touch-action:pinch-zoom}',
    '.lb-figure{margin:0;display:flex;flex-direction:column;align-items:center}',
    '.lb-img{display:block;max-width:92vw;max-height:84vh;width:auto;height:auto;object-fit:contain;opacity:0;',
    '-webkit-user-select:none;user-select:none;-webkit-user-drag:none}',
    '.lb-img.lb-in{opacity:1;transition:opacity .15s ease-out}',
    '.lb-cap{max-width:70ch;margin:.75em 1em 0;font-size:.875rem;line-height:1.4;text-align:center}',
    '.lb-count{position:absolute;top:1rem;left:1.25rem;margin:0;font-size:.875rem;font-variant-numeric:tabular-nums}',
    '.lb-overlay .lb-btn{position:absolute;display:flex;align-items:center;justify-content:center;margin:0;',
    'padding:0;border:0;background:none;color:inherit;font:inherit;line-height:1;cursor:pointer}',
    '.lb-overlay .lb-close{top:0;right:0;width:4rem;height:4rem;font-size:2.25rem}',
    '.lb-overlay .lb-prev,.lb-overlay .lb-next{top:50%;width:4.5rem;height:9rem;margin-top:-4.5rem;font-size:3rem}',
    '.lb-prev{left:0}.lb-next{right:0}',
    '.lb-overlay [hidden]{display:none}',
    '@media (prefers-reduced-motion:reduce){.lb-img.lb-in{transition:none}}'
  ].join('');

  var lb = {
    el: null, img: null, cap: null, count: null, prev: null, next: null, close: null,
    isOpen: false, items: [], index: 0, opener: null, overflow: '',
    token: 0, loading: null, preloads: [], swipe: null, swiped: false
  };

  // The style and the overlay are built on first use, then reused.
  function buildLightbox() {
    if (!document.getElementById('lb-style')) {
      var style = document.createElement('style');
      style.id = 'lb-style';
      style.textContent = LIGHTBOX_CSS;
      (document.head || document.documentElement).appendChild(style);
    }
    if (lb.el) return;
    var holder = document.createElement('div');
    holder.innerHTML =
      '<div class="lb-overlay" role="dialog" aria-modal="true" aria-label="Image viewer">' +
      '<p class="lb-count" aria-live="polite"></p>' +
      '<figure class="lb-figure"><img class="lb-img" alt="" draggable="false">' +
      '<figcaption class="lb-cap" hidden></figcaption></figure>' +
      '<button class="lb-btn lb-prev" type="button" aria-label="Previous image">\u2039</button>' +
      '<button class="lb-btn lb-next" type="button" aria-label="Next image">\u203a</button>' +
      '<button class="lb-btn lb-close" type="button" aria-label="Close">\u00d7</button></div>';
    lb.el = holder.firstChild;
    ['img', 'cap', 'count', 'prev', 'next', 'close'].forEach(function (name) {
      lb[name] = lb.el.querySelector('.lb-' + name);
    });
  }

  // Images that can open in the lightbox: not linked, and not hidden in the editor.
  function enlargeable(el) {
    return !el.closest('a.g-link, a[href]') && !el.closest('.ed-hidden');
  }

  // The images the lightbox steps through after `img` is clicked: every image of
  // its gallery, or, for an image block with "Click to enlarge" on, every such
  // block of the same section. Null when the click should not open the lightbox.
  function lightboxGroup(img) {
    if (!enlargeable(img)) return null;
    var scope = img.closest('section.s-gallery[data-lightbox="1"]');
    var selector = 'img.g-img';
    if (!scope) {
      var block = img.closest('.fe-b[data-lightbox="1"]');
      scope = block && block.closest('section.s-blocks');
      selector = '.fe-b[data-lightbox="1"] img.g-img';
    }
    return scope ? toArray(scope.querySelectorAll(selector)).filter(enlargeable) : null;
  }

  function openLightbox(img, imgs) {
    buildLightbox();
    lb.items = imgs.map(function (el) {
      var item = el.closest('.g-item, .fe-b'), cap = item && item.querySelector('figcaption.g-cap');
      return {
        src: el.getAttribute('data-full') || el.currentSrc || el.src,
        alt: el.getAttribute('alt') || '',
        cap: cap ? cap.innerHTML.trim() : ''
      };
    });
    lb.opener = img;
    lb.prev.hidden = lb.next.hidden = lb.count.hidden = imgs.length < 2;
    if (!lb.isOpen) {
      var root = document.documentElement;
      lb.overflow = root.style.overflow;
      root.style.overflow = 'hidden';
      root.classList.add('lb-open');
      lb.isOpen = true;
    }
    document.body.appendChild(lb.el);
    showImage(imgs.indexOf(img));
    lb.close.focus();
  }

  function closeLightbox() {
    if (!lb.isOpen) return;
    var root = document.documentElement, opener = lb.opener;
    lb.isOpen = false;
    lb.token++;                      // an image still loading must not appear later
    lb.items = lb.preloads = [];
    lb.opener = lb.swipe = null;
    lb.el.remove();                  // kept for reuse, but out of the page while closed
    root.classList.remove('lb-open');
    root.style.overflow = lb.overflow;
    if (!root.getAttribute('style')) root.removeAttribute('style');
    if (opener && opener.isConnected) {
      // Gallery images are not focusable. tabindex -1 lets script (only) focus this one.
      if (!opener.hasAttribute('tabindex')) opener.setAttribute('tabindex', '-1');
      opener.focus({ preventScroll: true });
    }
  }

  // Show item `index` (wrapping around). The new image appears once it has loaded.
  function showImage(index) {
    var n = lb.items.length;
    var i = ((index % n) + n) % n;
    var item = lb.items[i];
    var token = ++lb.token;
    lb.index = i;
    lb.count.textContent = (i + 1) + ' / ' + n;
    lb.img.classList.remove('lb-in');
    lb.loading = new Image();
    lb.loading.onload = lb.loading.onerror = function () {
      if (token !== lb.token) return;          // superseded, or the lightbox was closed
      lb.img.src = item.src;
      lb.img.alt = item.alt;
      lb.cap.innerHTML = item.cap;
      lb.cap.hidden = !item.cap;
      void lb.img.offsetWidth;                 // commit opacity 0 so that the fade runs
      lb.img.classList.add('lb-in');
    };
    lb.loading.src = item.src;
    // Warm the cache for both neighbors. Holding the references keeps the requests alive.
    lb.preloads = [i - 1, i + 1].map(function (j) {
      var pre = new Image();
      pre.src = lb.items[(j + n) % n].src;
      return pre;
    });
  }

  function step(delta) {
    if (lb.items.length > 1) showImage(lb.index + delta);
  }

  function lightboxKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeLightbox();
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !hasModifier(e)) {
      e.preventDefault();
      step(e.key === 'ArrowLeft' ? -1 : 1);
    } else if (e.key === 'Tab') {
      // Trap focus by cycling through the dialog's visible buttons (and any caption links).
      var stops = toArray(lb.el.querySelectorAll('button, a[href]'))
        .filter(function (el) { return !el.closest('[hidden]'); });
      var i = stops.indexOf(document.activeElement);
      e.preventDefault();
      if (stops.length) stops[e.shiftKey ? (i > 0 ? i - 1 : stops.length - 1) : (i + 1) % stops.length].focus();
    }
  }

  function lightboxClick(t) {
    if (lb.swiped) { lb.swiped = false; return; }   // the click that ends a mouse swipe
    if (t.closest('.lb-close')) closeLightbox();
    else if (t.closest('.lb-prev')) step(-1);
    else if (t.closest('.lb-next')) step(1);
    else if (!t.closest('.lb-img, .lb-cap')) closeLightbox();   // the backdrop
  }

  /* 2b. Slideshows ---------------------------------------------------------- */

  // Slideshow: Simple and Full show one slide at a time (each slide is as wide as
  // the track); Slideshow: Reel shows several, each as wide as its image. In all
  // three the track scrolls sideways and slides snap into place, so one set of
  // functions handles them: a slide's position is where it starts in the track.
  var slideshows = new Map();      // section -> state, see setupSlideshow()

  function rendered(el) { return el.getClientRects().length > 0; }   // not display:none

  function slideItems(track) {
    return toArray(track.children).filter(function (el) { return el.classList.contains('g-item') && rendered(el); });
  }

  // Where each slide starts, in the track's scroll coordinates.
  function slideOffsets(track) {
    var origin = track.getBoundingClientRect().left - track.scrollLeft;
    return slideItems(track).map(function (el) {
      return el.offsetParent === track ? el.offsetLeft : el.getBoundingClientRect().left - origin;
    });
  }

  // The slide nearest the scroll position (i of n), with the data to move from it.
  function slidePosition(track) {
    var offsets = slideOffsets(track);
    var x = track.scrollLeft, i = 0;
    for (var k = 1; k < offsets.length; k++) if (Math.abs(offsets[k] - x) < Math.abs(offsets[i] - x)) i = k;
    return { i: i, n: offsets.length, offsets: offsets, max: Math.max(0, track.scrollWidth - track.clientWidth) };
  }

  function stateOf(section) {
    return slideshows.get(section) || { section: section, track: section.querySelector(':scope > .g-items') };
  }

  // Scroll to slide `index` (wrapping around).
  function goToSlide(state, index) {
    var track = state.track, pos = track && slidePosition(track);
    if (!pos || !pos.n) return;
    var i = ((index % pos.n) + pos.n) % pos.n;
    state.target = { i: i, t: Date.now() };
    track.scrollTo({ left: Math.min(pos.offsets[i], pos.max), behavior: reducedMotion() ? 'auto' : 'smooth' });
    markThumbs(state, i);
  }

  // Move one slide forward (dir 1) or back (dir -1), wrapping at both ends.
  function slide(section, dir) {
    var state = stateOf(section), track = state.track;
    var pos = track && slidePosition(track);
    if (!pos || pos.n < 2 || !track.clientWidth) return;
    // A click during the previous move continues from where that move is going.
    var moving = !!(state.target && Date.now() - state.target.t < 700);
    var from = moving ? state.target.i : pos.i;
    // A reel cannot scroll its last few images to the start, they all sit at the
    // end: count from the first of them.
    var atEnd = function (k) { return pos.offsets[k] >= pos.max - 2; };
    while (from > 0 && atEnd(from - 1)) from--;
    var scrolledToEnd = !moving && track.scrollLeft >= pos.max - 2;
    var to;
    if (dir > 0) to = from >= pos.n - 1 || atEnd(from) || scrolledToEnd ? 0 : from + 1;
    else to = from <= 0 ? pos.n - 1 : from - 1;
    goToSlide(state, to);
  }

  function updateCount(state) {
    var count = state.section.querySelector('.g-count');
    var pos = slidePosition(state.track);
    var text = pos.n ? (pos.i + 1) + ' / ' + pos.n : '';
    if (count && count.textContent !== text) count.textContent = text;   // no needless DOM writes
    // While a move started by a click is running, its thumbnail stays marked.
    if (!(state.target && Date.now() - state.target.t < 700)) markThumbs(state, pos.i);
  }

  // Slideshow: Simple's thumbnails: mark the current one and keep it in view
  // inside the strip (never scrolling the page).
  function markThumbs(state, i) {
    var strip = state.section.querySelector(':scope > .g-thumbs');
    if (!strip || state.thumb === i) return;
    state.thumb = i;
    var thumbs = toArray(strip.children).filter(rendered);
    thumbs.forEach(function (b, k) {
      b.classList.toggle('on', k === i);
      if (k === i) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
    var cur = thumbs[i];
    if (cur && strip.scrollWidth > strip.clientWidth) {
      var left = cur.offsetLeft - (strip.clientWidth - cur.offsetWidth) / 2;
      strip.scrollTo({ left: Math.max(0, left), behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  }

  function thumbClick(thumb, section) {
    var thumbs = toArray(thumb.parentNode.children).filter(rendered);
    goToSlide(stateOf(section), thumbs.indexOf(thumb));
  }

  function autoplayTick(state) {
    var section = state.section;
    if (!section.isConnected) { teardownSlideshow(state); return; }
    // Hold still in the editor, under reduced motion, behind the lightbox, and
    // while the visitor's pointer or focus is inside the slideshow.
    if (editing() || reducedMotion() || lb.isOpen || document.hidden ||
        section.matches(':hover') || section.contains(document.activeElement)) return;
    slide(section, 1);
  }

  function teardownSlideshow(state) {
    clearInterval(state.timer);
    cancelAnimationFrame(state.raf);
    state.track.removeEventListener('scroll', state.onScroll);
    slideshows.delete(state.section);
  }

  function setupSlideshow(section) {
    var track = section.querySelector('.g-items');
    var seconds = parseFloat(section.getAttribute('data-autoplay'));
    var delay = seconds > 0 && isFinite(seconds) ? Math.max(seconds, 1) * 1000 : 0;
    var state = slideshows.get(section);
    if (state && (state.track !== track || state.delay !== delay)) {
      teardownSlideshow(state);      // the markup or the autoplay setting changed
      state = null;
    }
    if (!track || !section.isConnected) return;
    if (!track.hasAttribute('tabindex')) track.setAttribute('tabindex', '0');
    if (!state) {
      state = { section: section, track: track, delay: delay, raf: 0, timer: 0, target: null, thumb: -1 };
      state.onScroll = function () {  // update the counter at most once per frame
        if (!state.raf) state.raf = requestAnimationFrame(function () { state.raf = 0; updateCount(state); });
      };
      track.addEventListener('scroll', state.onScroll, { passive: true });
      if (delay) state.timer = setInterval(function () { autoplayTick(state); }, delay);
      slideshows.set(section, state);
    }
    updateCount(state);
  }

  /* 3. Contact form --------------------------------------------------------- */

  var sending = new WeakSet();

  function setStatus(form, text) {
    var status = form.querySelector('.form-status');
    if (status) status.textContent = text;
  }

  function sendForm(form, endpoint) {
    var body = new FormData(form);
    var buttons = toArray(form.elements).filter(function (el) { return el.type === 'submit' && !el.disabled; });
    var disable = function (on) { buttons.forEach(function (b) { b.disabled = on; }); };
    sending.add(form);
    disable(true);
    setStatus(form, 'Sending\u2026');
    fetch(endpoint, { method: 'POST', body: body, headers: { Accept: 'application/json' } })
      .then(function (res) { return !!(res && res.ok); }, function () { return false; })
      .then(function (ok) {
        sending.delete(form);
        if (!ok) {
          disable(false);
          setStatus(form, 'Sorry, something went wrong. Please try again or send an email instead.');
          return;
        }
        var active = document.activeElement;
        var done = document.createElement('p');
        done.className = 'form-success';
        done.textContent = form.getAttribute('data-success') || 'Thanks! Your message has been sent.';
        done.tabIndex = -1;
        form.textContent = '';
        form.appendChild(done);
        // The focused button is gone, so hand focus to the message and it gets read out.
        if (!active || active === document.body || form.contains(active)) done.focus();
      });
  }

  /* Delegated listeners, bound once ----------------------------------------- */

  document.addEventListener('click', function (e) {
    var t = asElement(e.target);
    if (!t) return;
    if (lb.isOpen && lb.el.contains(t)) { lightboxClick(t); return; }

    var toggle = t.closest('.menu-toggle');
    if (toggle) setMenu(toggle, !toggle.classList.contains('open'));
    else if (t.closest('.nav a')) closeMenu();
    closeFolders(t);                 // a click outside an open dropdown closes it

    var arrow = t.closest('.g-prev, .g-next');
    var show = arrow && arrow.closest(SLIDESHOW);
    if (show) { slide(show, arrow.classList.contains('g-next') ? 1 : -1); return; }
    var thumb = t.closest('.g-thumb');
    var thumbShow = thumb && thumb.closest(SLIDESHOW);
    if (thumbShow) { thumbClick(thumb, thumbShow); return; }

    var img = t.closest('img.g-img');
    var group = img && !editing() ? lightboxGroup(img) : null;
    if (group && group.length) openLightbox(img, group);
  });

  document.addEventListener('keydown', function (e) {
    if (e.isComposing) return;
    if (lb.isOpen) { lightboxKey(e); return; }
    var t = asElement(e.target);
    if (e.key === 'Escape') {
      escapeNav();
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !hasModifier(e) &&
               t && !t.isContentEditable && t.matches(TRACK)) {
      e.preventDefault();
      slide(t.parentElement, e.key === 'ArrowLeft' ? -1 : 1);
    }
  });

  // `toggle` does not bubble, hence the capture phase.
  document.addEventListener('toggle', function (e) {
    var d = asElement(e.target);
    if (d && d.open && d.matches('details.nav-folder')) closeFolders(d);
  }, true);

  // A lightbox swipe is longer than 50px and more horizontal than vertical.
  document.addEventListener('pointerdown', function (e) {
    if (!lb.isOpen || !lb.el.contains(asElement(e.target))) return;
    lb.swiped = false;
    // A second finger means a pinch, which is not a swipe.
    lb.swipe = e.isPrimary && e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
  });
  document.addEventListener('pointerup', function (e) {
    var s = lb.swipe;
    lb.swipe = null;
    if (!lb.isOpen || !s || s.id !== e.pointerId) return;
    var dx = e.clientX - s.x;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - s.y)) {
      lb.swiped = true;
      step(dx < 0 ? 1 : -1);
    }
  });
  document.addEventListener('pointercancel', function () { lb.swipe = null; });

  document.addEventListener('submit', function (e) {
    var form = asElement(e.target);
    if (!form) return;
    if (editing()) { e.preventDefault(); return; }   // nothing is ever sent from the editor
    var endpoint = form.matches('form.contact-form') ? (form.getAttribute('data-endpoint') || '').trim() : '';
    if (!endpoint || e.defaultPrevented) return;     // without an endpoint the browser submits as usual
    e.preventDefault();
    if (!sending.has(form)) sendForm(form, endpoint);
  });

  /* 4. Scroll animations ----------------------------------------------------- */

  // <body data-anim="fade|rise"> (Site Styles > Animations) fades sections in as
  // they scroll into view. A gallery can pick its own with data-g-anim: "none"
  // keeps it still, "fade" and "scale" animate each image (a slideshow as a
  // whole). Never in the editor, never with reduced motion, and never without
  // this script (the hiding rules need the anim-ready and g-anim-ready classes
  // that only this adds).
  var animObserver = null;
  function setupAnimations() {
    var kind = document.body && document.body.getAttribute('data-anim');
    var root = document.documentElement;
    var allowed = !editing() && !reducedMotion() && ('IntersectionObserver' in window);
    setupGalleryAnimations(allowed);
    if (!allowed || !kind || kind === 'none') {
      root.classList.remove('anim-ready');
      return;
    }
    if (!animObserver) {
      animObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('in-view'); animObserver.unobserve(en.target); }
        });
      }, { rootMargin: '0px 0px -8% 0px' });
    }
    toArray(document.querySelectorAll('.page > .s:not(.in-view)')).forEach(function (s) {
      // Sections already on screen show at once, without a flash. Galleries with
      // their own animation setting do not take part.
      if (s.hasAttribute('data-g-anim') || s.getBoundingClientRect().top < window.innerHeight) s.classList.add('in-view');
      else animObserver.observe(s);
    });
    root.classList.add('anim-ready');
  }

  var imageObserver = null;
  var watchedImages = new Set();     // elements imageObserver is waiting for

  function setupGalleryAnimations(allowed) {
    var root = document.documentElement;
    watchedImages.forEach(function (el) {           // forget images that left the page
      if (el.isConnected) return;
      if (imageObserver) imageObserver.unobserve(el);
      watchedImages.delete(el);
    });
    var galleries = toArray(document.querySelectorAll('section.s-gallery[data-g-anim="fade"], section.s-gallery[data-g-anim="scale"]'));
    if (!allowed || !galleries.length) {
      root.classList.remove('g-anim-ready');
      return;
    }
    if (!imageObserver) {
      imageObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          en.target.classList.add('g-in');
          imageObserver.unobserve(en.target);
          watchedImages.delete(en.target);
        });
      }, { rootMargin: '0px 0px -6% 0px' });
    }
    galleries.forEach(function (gallery) {
      var targets = gallery.matches(SLIDESHOW)
        ? toArray(gallery.querySelectorAll(':scope > .g-items'))
        : toArray(gallery.querySelectorAll('.g-item'));
      targets.forEach(function (el) {
        if (el.classList.contains('g-anim-t')) return;   // set up already
        el.classList.add('g-anim-t');
        var r = el.getBoundingClientRect();
        // Images already on screen show at once, without a flash.
        if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('g-in');
        else { imageObserver.observe(el); watchedImages.add(el); }
      });
    });
    root.classList.add('g-anim-ready');
  }

  /* init -------------------------------------------------------------------- */

  function init(root) {
    root = root || document;
    // Forget slideshows that have left the document (or stopped being slideshows).
    slideshows.forEach(function (state, section) {
      if (!section.isConnected || !section.matches(SLIDESHOW)) teardownSlideshow(state);
    });
    // If the body was replaced under an open lightbox, put the page back in order.
    if (lb.isOpen && !lb.el.isConnected) closeLightbox();
    var found = root.querySelectorAll ? toArray(root.querySelectorAll(SLIDESHOW)) : [];
    if (root.matches && root.matches(SLIDESHOW)) found.unshift(root);
    found.forEach(setupSlideshow);
    setupAnimations();
  }

  window.SiteJS = { init: init };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(document); });
  } else {
    init(document);
  }
})();
