/*
 * MeirKidsTV - kid mode for meirkids.co.il on a TV remote.
 *
 * Runs inside the site (injected by MainActivity). Three screens:
 *   home    "/"                       -> our own grid of series
 *   series  "/<series>/v"             -> our own grid of episodes, by season, oldest first,
 *                                        focus starts on the next episode to watch
 *   episode "/<series>/<ep>/<id>/v"   -> the Vimeo player stretched over the whole screen,
 *                                        autoplay, OK = pause/play, arrows = seek,
 *                                        at the end: 5 second countdown to the next episode,
 *                                        up to 4 automatic episodes after the one the kid chose.
 *
 * Parent mode (hold OK for 3 seconds) switches all of this off and shows the plain site,
 * for logging in or anything else. Hold OK again to go back to kid mode.
 */
(function () {
  'use strict';
  if (window.__mk) return;
  var MK = (window.__mk = {});

  var AUTO_LIMIT = 4;          // automatic episodes after the one the kid picked
  var COUNTDOWN_SEC = 5;       // seconds before the next episode starts by itself
  var LONG_PRESS_MS = 3000;    // hold OK this long to toggle parent mode
  var SEEK_SEC = 10;
  var IMG_CACHE_DAYS = 7;

  // ---------- small helpers ----------
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function sess(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { return null; } }
  function native(fn, arg) { try { if (window.MKNative && window.MKNative[fn]) window.MKNative[fn](arg); } catch (e) {} }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function shown(e) { return !!(e && e.getClientRects && e.getClientRects().length); }
  function onReady(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  function decodePath(p) { try { return decodeURIComponent(p); } catch (e) { return p; } }
  function pathOf(href) { try { return decodePath(new URL(href, location.href).pathname); } catch (e) { return ''; } }

  var segs = decodePath(location.pathname).split('/').filter(Boolean);
  var type = 'other';
  if (segs.length === 0) type = 'home';
  else if (segs.length === 2 && segs[1] === 'v') type = 'series';
  else if (segs.length === 4 && segs[3] === 'v' && /^\d+$/.test(segs[2])) type = 'episode';
  MK.type = type;
  var seriesSlug = segs[0] || '';
  var seriesUrl = '/' + seriesSlug + '/v';

  // mode: 'parent' | 'kids' | null (automatic: kids, unless the site says we are logged out)
  var forcedMode = store('mkMode');
  var kids = forcedMode !== 'parent';

  // ---------- styles ----------
  var CSS = [
    'html.mk-boot{background:#1b0b2e!important}',
    'html.mk-boot body>*:not(#mk-root):not(#mk-layer){visibility:hidden!important}',
    'html.mk-overlay body>*:not(#mk-root):not(#mk-layer):not(#mk-toast){display:none!important}',
    'html.mk-overlay,html.mk-overlay body{overflow:hidden!important;background:#1b0b2e!important}',
    '#mk-root{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483000;background:#1b0b2e;color:#fff;font-family:Arial,Helvetica,sans-serif;direction:rtl;overflow-y:auto;overflow-x:hidden;visibility:visible!important}',
    '#mk-root .mk-title{font-size:30px;font-weight:bold;padding:22px 44px 6px;color:#ffd54a}',
    '#mk-root .mk-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px;padding:18px 44px 80px}',
    '#mk-root .mk-tile{position:relative;border-radius:14px;overflow:hidden;background:#2d1650;border:5px solid transparent;transition:transform .12s ease}',
    '#mk-root .mk-img{width:100%;aspect-ratio:16/9;background:#3f2172 center/cover no-repeat;display:flex;align-items:center;justify-content:center;text-align:center;font-size:24px;font-weight:bold;padding:8px;box-sizing:border-box}',
    '#mk-root .mk-name{font-size:22px;padding:8px 12px 4px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#mk-root .mk-sub{font-size:16px;opacity:.75;padding:0 12px 10px}',
    '#mk-root .mk-season{grid-column:1/-1;font-size:26px;font-weight:bold;color:#ffd54a;padding-top:12px}',
    '#mk-root .mk-badge{position:absolute;top:8px;left:8px;background:#27ae60;color:#fff;border-radius:50%;width:36px;height:36px;font-size:24px;display:flex;align-items:center;justify-content:center}',
    '.mk-focus{border-color:#ffd54a!important;transform:scale(1.06);box-shadow:0 0 0 4px rgba(255,213,74,.35),0 12px 30px rgba(0,0,0,.6);z-index:2}',
    'html.mk-player,html.mk-player body{background:#000!important;overflow:hidden!important}',
    'html.mk-player body *{visibility:hidden!important}',
    'html.mk-player .mk-fs,html.mk-player #mk-layer,html.mk-player #mk-layer *,html.mk-player #mk-toast{visibility:visible!important}',
    'html.mk-player .mk-fs{position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;z-index:2147482000!important;border:0!important;background:#000!important;pointer-events:none!important;transform:none!important}',
    '#mk-layer{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483100;display:none;align-items:center;justify-content:center;flex-direction:column;direction:rtl;font-family:Arial,Helvetica,sans-serif;color:#fff;pointer-events:none}',
    '#mk-layer.mk-on{display:flex}',
    '#mk-layer .mk-card{background:rgba(27,11,46,.94);border-radius:22px;padding:36px 54px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.7)}',
    '#mk-layer .mk-big{font-size:34px;font-weight:bold;margin-bottom:10px}',
    '#mk-layer .mk-count{font-size:96px;font-weight:bold;color:#ffd54a;line-height:1.1;margin:6px 0 20px}',
    '#mk-layer .mk-btn{display:inline-block;font-size:28px;font-weight:bold;padding:16px 34px;border-radius:14px;background:#5b2a9e;border:5px solid transparent}',
    '#mk-layer .mk-pause{font-size:120px;background:rgba(0,0,0,.45);border-radius:50%;width:200px;height:200px;display:flex;align-items:center;justify-content:center}',
    '#mk-toast{position:fixed;left:50%;bottom:48px;transform:translateX(-50%);z-index:2147483200;background:rgba(0,0,0,.85);color:#fff;font:bold 24px Arial,sans-serif;padding:14px 28px;border-radius:12px;direction:rtl;display:none;visibility:visible!important}',
    '#mk-banner{position:fixed;top:0;left:0;right:0;z-index:2147483200;background:#c0392b;color:#fff;font:bold 20px Arial,sans-serif;padding:10px 20px;text-align:center;direction:rtl}',
    '.cc-window,.cc-banner{display:none!important}'
  ].join('\n');

  function addStyle() {
    var s = el('style');
    s.id = 'mk-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  addStyle();
  native('setKidMode', false);
  var html = document.documentElement;
  if (kids && type !== 'other') {
    html.classList.add('mk-boot');
    // Failsafe: never leave the screen blank.
    setTimeout(function () { html.classList.remove('mk-boot'); }, 7000);
  }

  // ---------- toast ----------
  var toastTimer = null;
  function toast(msg, ms) {
    var t = document.getElementById('mk-toast');
    if (!t) { t = el('div'); t.id = 'mk-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.display = 'none'; }, ms || 2500);
  }

  // ---------- spatial focus navigation ----------
  var nav = { items: function () { return []; }, cur: null };
  function rectOf(e) { var r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }
  function setFocus(e) {
    if (!e) return;
    if (nav.cur && nav.cur !== e) nav.cur.classList.remove('mk-focus');
    nav.cur = e;
    e.classList.add('mk-focus');
    try { e.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }); } catch (x) { e.scrollIntoView(); }
  }
  function move(dir) {
    var items = nav.items();
    if (!items.length) return;
    if (!nav.cur || items.indexOf(nav.cur) < 0) { setFocus(items[0]); return; }
    var c = rectOf(nav.cur), best = null, bestScore = Infinity;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it === nav.cur) continue;
      var r = rectOf(it);
      if (!r.w) continue;
      var dx = r.x - c.x, dy = r.y - c.y, primary, secondary;
      if (dir === 'left') { primary = -dx; secondary = Math.abs(dy); }
      else if (dir === 'right') { primary = dx; secondary = Math.abs(dy); }
      else if (dir === 'up') { primary = -dy; secondary = Math.abs(dx); }
      else { primary = dy; secondary = Math.abs(dx); }
      if (primary <= 4) continue;
      var score = primary + secondary * 3;
      if (score < bestScore) { bestScore = score; best = it; }
    }
    if (best) setFocus(best);
  }

  // ---------- key handling ----------
  var enterDownAt = 0;
  var handlers = { enter: null, arrow: null };
  var layerActive = null; // when set, gets every key first

  function keyName(e) {
    switch (e.key || e.keyCode) {
      case 'ArrowLeft': case 37: return 'left';
      case 'ArrowUp': case 38: return 'up';
      case 'ArrowRight': case 39: return 'right';
      case 'ArrowDown': case 40: return 'down';
      case 'Enter': case 13: case ' ': case 32: return 'enter';
      case 'MediaPlayPause': case 179: return 'playpause';
      default: return null;
    }
  }

  // One entry point for all remote keys. In the app, MainActivity catches the keys before the
  // page does and calls this directly. In a normal browser (for testing) the DOM listeners below do it.
  function handleKey(k) {
    if (!kids) return;
    if (layerActive && layerActive.key) { layerActive.key(k); return; }
    if (k === 'enter' || k === 'playpause') { if (handlers.enter) handlers.enter(); return; }
    if (handlers.arrow) handlers.arrow(k);
  }
  MK.key = handleKey;
  MK.toggleParent = function () { toggleParentMode(); };

  if (!window.MKNative) {
    window.addEventListener('keydown', function (e) {
      var k = keyName(e);
      if (!k) return;
      if (k === 'enter') {
        if (!e.repeat && !enterDownAt) enterDownAt = Date.now();
        if (kids) { e.preventDefault(); e.stopPropagation(); }
        return;
      }
      if (!kids) return;
      e.preventDefault(); e.stopPropagation();
      handleKey(k);
    }, true);

    window.addEventListener('keyup', function (e) {
      if (keyName(e) !== 'enter') return;
      var held = enterDownAt ? Date.now() - enterDownAt : 0;
      enterDownAt = 0;
      if (held >= LONG_PRESS_MS) { e.preventDefault(); e.stopPropagation(); toggleParentMode(); return; }
      if (!kids) return;
      e.preventDefault(); e.stopPropagation();
      handleKey('enter');
    }, true);
  }

  function toggleParentMode() {
    if (kids) { store('mkMode', 'parent'); toast('מצב הורים: האתר הרגיל'); }
    else { store('mkMode', 'kids'); toast('מצב ילדים'); }
    setTimeout(function () { location.reload(); }, 800);
  }

  // Called by the app when Back is pressed. Returns 'handled', 'exit' or 'none'.
  MK.back = function () {
    if (!kids) return 'none';
    if (layerActive && layerActive.back) { layerActive.back(); return 'handled'; }
    if (type === 'home') return 'exit';
    if (type === 'episode') { location.href = seriesUrl; return 'handled'; }
    location.href = '/';
    return 'handled';
  };

  // ---------- login detection ----------
  function loggedIn() {
    var nodes = document.querySelectorAll('a,button,span,div');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.children.length > 2) continue;
      var t = (n.textContent || '').trim();
      if ((t === 'ניתוק' || t === 'מחובר') && shown(n)) return true;
    }
    return false;
  }

  function parentBanner(msg) {
    var b = el('div', null, msg);
    b.id = 'mk-banner';
    document.body.appendChild(b);
  }

  // ---------- watched episodes (per series) ----------
  function watchedOf(slug) { try { return JSON.parse(store('mkW:' + slug) || '{}'); } catch (e) { return {}; } }
  function markWatched(slug, id) {
    var w = watchedOf(slug);
    w.ids = w.ids || {};
    w.ids[id] = 1;
    w.last = id;
    store('mkW:' + slug, JSON.stringify(w));
  }

  // ---------- image helpers ----------
  function imageIn(node) {
    if (!node) return '';
    var im = node.querySelector('img');
    if (im) {
      var src = im.getAttribute('data-src') || im.getAttribute('data-original') || im.getAttribute('data-lazy-src') || im.currentSrc || im.getAttribute('src') || '';
      if (!src && im.getAttribute('srcset')) src = im.getAttribute('srcset').split(',')[0].trim().split(' ')[0];
      if (src && !/^data:/.test(src)) return new URL(src, location.href).href;
    }
    var all = [node].concat(Array.prototype.slice.call(node.querySelectorAll('*')));
    for (var i = 0; i < all.length; i++) {
      var bg = (all[i].style && all[i].style.backgroundImage) || all[i].getAttribute('data-bg') || '';
      var m = bg.match(/url\(["']?(.*?)["']?\)/) || (bg && !/url\(/.test(bg) ? [0, bg] : null);
      if (m && m[1]) return new URL(m[1], location.href).href;
    }
    return '';
  }

  function makeTile(name, sub, img, href) {
    var t = el('div', 'mk-tile');
    var pic = el('div', 'mk-img');
    if (img) pic.style.backgroundImage = 'url("' + img.replace(/"/g, '%22') + '")';
    else pic.textContent = name;
    t.appendChild(pic);
    t.appendChild(el('div', 'mk-name', name));
    if (sub) t.appendChild(el('div', 'mk-sub', sub));
    t.setAttribute('data-href', href);
    t.mkPic = pic;
    return t;
  }

  function buildRoot(title) {
    var root = el('div');
    root.id = 'mk-root';
    root.appendChild(el('div', 'mk-title', title));
    var grid = el('div', 'mk-grid');
    root.appendChild(grid);
    document.body.appendChild(root);
    html.classList.add('mk-overlay');
    html.classList.remove('mk-boot');
    return grid;
  }

  function waitFor(test, timeoutMs, cb) {
    var start = Date.now();
    (function tick() {
      var v = null;
      try { v = test(); } catch (e) { v = null; }
      if (v) return cb(v);
      if (Date.now() - start > timeoutMs) return cb(null);
      setTimeout(tick, 250);
    })();
  }

  // ---------- HOME: grid of series ----------
  function initHome() {
    waitFor(function () {
      var seen = {}, list = [];
      var anchors = document.querySelectorAll('a[href]');
      for (var i = 0; i < anchors.length; i++) {
        var a = anchors[i];
        var p = pathOf(a.getAttribute('href'));
        var s = p.split('/').filter(Boolean);
        if (s.length !== 2 || s[1] !== 'v' || seen[p]) continue;
        seen[p] = 1;
        var imgEl = a.querySelector('img');
        var name = (a.getAttribute('title') || (imgEl && imgEl.getAttribute('alt')) || a.textContent || '').trim().replace(/\s+/g, ' ');
        if (!name || name.length > 40) name = s[0].replace(/-/g, ' ');
        list.push({ path: p, href: new URL(a.getAttribute('href'), location.href).href, name: name, img: imageIn(a) });
      }
      return list.length >= 3 ? list : null;
    }, 6000, function (list) {
      if (!list) { initFallback(); return; }
      var grid = buildRoot('ערוץ מאיר לילדים');
      var tiles = list.map(function (s) {
        var t = makeTile(s.name, null, s.img || cachedImage(s.path), s.href);
        t.mkPath = s.path;
        grid.appendChild(t);
        return t;
      });
      nav.items = function () { return tiles; };
      var lastSeries = store('mkLastSeries');
      var start = tiles[0];
      for (var i = 0; i < tiles.length; i++) if (tiles[i].mkPath === lastSeries) start = tiles[i];
      setFocus(start);
      handlers.arrow = move;
      handlers.enter = function () {
        if (!nav.cur) return;
        store('mkLastSeries', nav.cur.mkPath);
        location.href = nav.cur.getAttribute('data-href');
      };
      loadSeriesImages(tiles);
    });
  }

  function cachedImage(path) {
    try {
      var c = JSON.parse(store('mkImg:' + path) || 'null');
      if (c && c.t > Date.now() - IMG_CACHE_DAYS * 864e5) return c.u;
    } catch (e) {}
    return '';
  }

  // Series without a picture on the home page: borrow one from the series page (cached for a week).
  function loadSeriesImages(tiles) {
    var queue = tiles.filter(function (t) { return !t.mkPic.style.backgroundImage; });
    var running = 0;
    function next() {
      if (!queue.length || running >= 3) return;
      var t = queue.shift();
      running++;
      fetch(t.getAttribute('data-href'), { credentials: 'include' })
        .then(function (r) { return r.text(); })
        .then(function (txt) {
          var doc = new DOMParser().parseFromString(txt, 'text/html');
          var u = '';
          var og = doc.querySelector('meta[property="og:image"]');
          if (og && og.getAttribute('content')) u = og.getAttribute('content');
          if (!u) u = imageIn(doc.querySelector('.sets-page-video-item'));
          if (u) {
            u = new URL(u, location.href).href;
            store('mkImg:' + t.mkPath, JSON.stringify({ u: u, t: Date.now() }));
            t.mkPic.textContent = '';
            t.mkPic.style.backgroundImage = 'url("' + u.replace(/"/g, '%22') + '")';
          }
        })
        .catch(function () {})
        .then(function () { running--; next(); });
      next();
    }
    next();
  }

  // ---------- SERIES: grid of episodes ----------
  function initSeries() {
    waitFor(function () {
      var items = document.querySelectorAll('.sets-page-video-item');
      return items.length ? items : null;
    }, 6000, function (items) {
      if (!items) { initFallback(); return; }
      var eps = [], seen = {};
      Array.prototype.forEach.call(items, function (item, idx) {
        var a = item.querySelector('a[href$="/v"]');
        if (!a) return;
        var p = pathOf(a.getAttribute('href'));
        var s = p.split('/').filter(Boolean);
        if (s.length !== 4 || seen[p]) return;
        seen[p] = 1;
        // textContent, not innerText: the page is still hidden while we read it.
        var meta = '', name = '';
        Array.prototype.forEach.call(item.querySelectorAll('*'), function (n) {
          if (n.children.length) return;
          var t = (n.textContent || '').trim().replace(/\s+/g, ' ');
          if (!t) return;
          if (t.indexOf('›') >= 0) { if (!meta) meta = t; }
          else if (!name && t.length > 1 && !/^[\d,.\s]+$/.test(t) && t !== 'צפיות') name = t;
        });
        if (!meta) meta = (item.textContent || '').replace(/\s+/g, ' ');
        var season = (meta.match(/עונה\s*(\d+)/) || [])[1];
        var epNo = (meta.match(/פרק\s*(\d+)/) || [])[1];
        eps.push({
          id: s[2], href: new URL(a.getAttribute('href'), location.href).href,
          name: name || s[1].replace(/-/g, ' '),
          season: season ? +season : 0, ep: epNo ? +epNo : 0, order: idx,
          img: imageIn(item)
        });
      });
      if (!eps.length) { initFallback(); return; }
      // The site lists newest first. For kids, oldest first by season reads naturally.
      eps.sort(function (a, b) {
        if (a.season !== b.season) return a.season - b.season;
        if (a.ep !== b.ep) return a.ep - b.ep;
        return b.order - a.order;
      });
      var title = (document.title || '').split('|')[0].trim() || seriesSlug.replace(/-/g, ' ');
      var grid = buildRoot(title);
      var watched = watchedOf(seriesSlug);
      var tiles = [], lastSeason = null, hasSeasons = eps.some(function (e) { return e.season > 0; });
      eps.forEach(function (e) {
        if (hasSeasons && e.season !== lastSeason) {
          grid.appendChild(el('div', 'mk-season', e.season ? 'עונה ' + e.season : 'מיוחדים'));
          lastSeason = e.season;
        }
        var t = makeTile(e.name, e.ep ? 'פרק ' + e.ep : '', e.img, e.href);
        t.mkId = e.id;
        if (watched.ids && watched.ids[e.id]) t.appendChild(el('div', 'mk-badge', '✓'));
        grid.appendChild(t);
        tiles.push(t);
      });
      nav.items = function () { return tiles; };
      // Start on the episode after the last one watched.
      var start = tiles[0];
      if (watched.last) {
        for (var i = 0; i < tiles.length; i++) {
          if (tiles[i].mkId === watched.last) { start = tiles[i + 1] || tiles[i]; break; }
        }
      }
      setFocus(start);
      handlers.arrow = move;
      handlers.enter = function () {
        if (!nav.cur) return;
        sess('mkAuto', '0'); // the kid chose this one: the automatic-episode counter starts over
        location.href = nav.cur.getAttribute('data-href');
      };
    });
  }

  // ---------- EPISODE: full screen player ----------
  var layer = null;
  function showLayer(content) {
    if (!layer) { layer = el('div'); layer.id = 'mk-layer'; document.body.appendChild(layer); }
    layer.innerHTML = '';
    if (content) { layer.appendChild(content); layer.classList.add('mk-on'); }
    else layer.classList.remove('mk-on');
  }

  function initEpisode() {
    var epId = segs[2];
    var ended = false;
    var player = null;

    html.classList.add('mk-player');
    html.classList.remove('mk-boot');

    var progress = 0;
    var vimeoTries = 0;
    setupVimeo();

    function setupVimeo() {
    if (++vimeoTries > 3) return;
    waitFor(function () {
      var f = document.getElementById('vimeo-player');
      return (f && window.Vimeo && window.Vimeo.Player) ? f : null;
    }, 10000, function (frame) {
      if (!frame) { if (vimeoTries === 1) initHtml5OrFallback(); return; }
      frame.classList.add('mk-fs');
      frame.setAttribute('tabindex', '-1');
      try { frame.blur(); } catch (e) {}
      player = new window.Vimeo.Player(frame);
      player.on('timeupdate', function (d) { if (d && typeof d.percent === 'number') progress = d.percent; });
      wirePlayer({
        play: function () { return player.play(); },
        pause: function () { return player.pause(); },
        paused: function () { return player.getPaused(); },
        seekBy: function (s) {
          return Promise.all([player.getCurrentTime(), player.getDuration()]).then(function (v) {
            return player.setCurrentTime(Math.max(0, Math.min(v[1] - 1, v[0] + s)));
          });
        },
        on: function (ev, fn) { player.on(ev, fn); }
      });
      // If the site removes the player before we heard "ended", treat that as the end.
      var mo = new MutationObserver(function () {
        if (document.getElementById('vimeo-player')) return;
        mo.disconnect();
        if (progress > 0.9) onEnded();
        else setTimeout(function () { if (!ended) { setupVimeo(); } }, 1000); // site swapped the player early: hook the new one
      });
      mo.observe(document.body, { childList: true, subtree: true });
    });
    }

    function initHtml5OrFallback() {
      var v = document.querySelector('video');
      if (!v) { html.classList.remove('mk-player'); initFallback(); return; }
      v.classList.add('mk-fs');
      wirePlayer({
        play: function () { return v.play(); },
        pause: function () { v.pause(); return Promise.resolve(); },
        paused: function () { return Promise.resolve(v.paused); },
        seekBy: function (s) { v.currentTime = Math.max(0, Math.min((v.duration || 0) - 1, v.currentTime + s)); return Promise.resolve(); },
        on: function (ev, fn) {
          if (ev === 'timeupdate') v.addEventListener('timeupdate', function () { fn({ percent: v.duration ? v.currentTime / v.duration : 0 }); });
          else v.addEventListener(ev, fn);
        }
      });
    }

    function wirePlayer(p) {
      p.on('play', function () { native('setKeepScreenOn', true); showLayer(null); });
      p.on('pause', function () { native('setKeepScreenOn', false); });
      p.on('ended', function () { onEnded(); });
      p.on('timeupdate', function (d) { if (d && d.percent > 0.85) markWatched(seriesSlug, epId); });
      var started = p.play();
      if (started && started.catch) started.catch(function () { toast('לחצו OK כדי להתחיל', 4000); });

      handlers.enter = function () {
        p.paused().then(function (isPaused) {
          if (isPaused) { p.play(); showLayer(null); }
          else {
            p.pause();
            showLayer(el('div', 'mk-pause', '❚❚'));
          }
        });
      };
      handlers.arrow = function (k) {
        if (k === 'left') { p.seekBy(-SEEK_SEC); toast('⏪ ' + SEEK_SEC + ' שניות', 1000); }
        else if (k === 'right') { p.seekBy(SEEK_SEC); toast(SEEK_SEC + ' שניות ⏩', 1000); }
      };
    }

    function onEnded() {
      if (ended) return;
      ended = true;
      native('setKeepScreenOn', false);
      markWatched(seriesSlug, epId);
      handlers.enter = null;
      handlers.arrow = null;
      var auto = parseInt(sess('mkAuto') || '0', 10) || 0;

      // The site shows its own "next episode" button a moment after the end.
      waitFor(function () { return document.querySelector('.continue-capsule__next'); }, 2000, function (nextBtn) {
        if (!nextBtn || auto >= AUTO_LIMIT) {
          var card = el('div', 'mk-card');
          card.appendChild(el('div', 'mk-big', nextBtn ? 'זהו להפעם!' : 'זה היה הפרק האחרון'));
          card.appendChild(el('div', 'mk-big', 'חוזרים לרשימת הפרקים...'));
          showLayer(card);
          var go = function () { location.href = seriesUrl; };
          layerActive = { key: function (k) { if (k === 'enter') go(); }, back: go };
          setTimeout(go, 3500);
          return;
        }
        var left = COUNTDOWN_SEC;
        var card2 = el('div', 'mk-card');
        card2.appendChild(el('div', 'mk-big', 'הפרק הבא מתחיל בעוד'));
        var count = el('div', 'mk-count', String(left));
        card2.appendChild(count);
        var btn = el('div', 'mk-btn mk-focus', 'חזרה לרשימת הפרקים');
        card2.appendChild(btn);
        showLayer(card2);
        var timer = setInterval(function () {
          left--;
          count.textContent = String(Math.max(left, 0));
          if (left <= 0) {
            clearInterval(timer);
            sess('mkAuto', String(auto + 1));
            layerActive = null;
            nextBtn.click();
            // If the click did not navigate, go back to the list rather than sit on a black screen.
            setTimeout(function () { location.href = seriesUrl; }, 6000);
          }
        }, 1000);
        var toList = function () { clearInterval(timer); location.href = seriesUrl; };
        layerActive = { key: function (k) { if (k === 'enter') toList(); }, back: toList };
      });
    }
  }

  // ---------- anything else: the site as is, with remote-friendly focus on links ----------
  function initFallback() {
    html.classList.remove('mk-boot', 'mk-overlay', 'mk-player');
    var root = document.getElementById('mk-root');
    if (root) root.remove();
    nav.items = function () {
      return Array.prototype.filter.call(document.querySelectorAll('a[href],button'), function (a) {
        var r = a.getBoundingClientRect();
        return r.width > 30 && r.height > 20 && shown(a);
      });
    };
    handlers.arrow = move;
    handlers.enter = function () { if (nav.cur) nav.cur.click(); };
  }

  // ---------- start ----------
  onReady(function () {
    if (!kids) {
      html.classList.remove('mk-boot');
      parentBanner('מצב הורים. החזקת OK שלוש שניות מחזירה למצב ילדים');
      return;
    }
    if ((type === 'home' || type === 'series') && forcedMode !== 'kids' && !loggedIn()) {
      // Logged out: show the plain site so a parent can log in once.
      kids = false;
      html.classList.remove('mk-boot');
      parentBanner('צריך להתחבר לחשבון פעם אחת. אחרי ההתחברות האפליקציה תעבור למצב ילדים');
      return;
    }
    native('setKidMode', true);
    if (type === 'home') initHome();
    else if (type === 'series') initSeries();
    else if (type === 'episode') initEpisode();
    else initFallback();
  });
})();
