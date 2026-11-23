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
 * Parent mode (up up down down OK, caught by MainActivity) switches all of this off and shows
 * the plain site, for logging in or anything else. The same sequence goes back to kid mode.
 */
(function () {
  'use strict';
  if (window.__mk) return;
  if (location.hostname !== 'meirkids.co.il') return; // e.g. the login site: leave it alone
  var MK = (window.__mk = {});

  var AUTO_LIMIT = 4;          // automatic episodes after the one the kid picked
  var COUNTDOWN_SEC = 5;       // seconds before the next episode starts by itself
  var LONG_PRESS_MS = 3000;    // browser testing only (no app): hold Enter to toggle parent mode
  var SEEK_SEC = 10;
  var IMG_CACHE_DAYS = 7;

  // ---------- small helpers ----------
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function sess(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { return null; } }
  function native(cmd, on) { try { if (window.MKNative && window.MKNative.postMessage) window.MKNative.postMessage(JSON.stringify({ cmd: cmd, on: !!on })); } catch (e) {} }
  function log(msg) { if (!window.__mkDebug) return; try { console.log('[MK] ' + msg); } catch (e) {} }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function shown(e) { return !!(e && e.getClientRects && e.getClientRects().length); }
  // Every move to another screen shows "loading" at once, so the screen is never just empty.
  function go(url) {
    document.documentElement.classList.add('mk-loading');
    location.href = url;
  }
  window.addEventListener('pageshow', function () { document.documentElement.classList.remove('mk-loading'); });
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
  var forcedMode = window.__mkForceKids ? 'kids' : store('mkMode'); // __mkForceKids: emulator test hook
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
    '#mk-root .mk-img{position:relative;width:100%;height:0;padding-top:56.25%;background:#3f2172 center/cover no-repeat}',
    '#mk-root .mk-img span{position:absolute;left:0;top:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;text-align:center;font-size:24px;font-weight:bold;padding:8px;box-sizing:border-box}',
    '#mk-root .mk-name{font-size:22px;padding:8px 12px 4px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#mk-root .mk-sub{font-size:16px;opacity:.75;padding:0 12px 10px}',
    '#mk-root .mk-season{grid-column:1/-1;font-size:26px;font-weight:bold;color:#ffd54a;padding-top:12px}',
    '#mk-root .mk-badge{position:absolute;top:8px;left:8px;background:#27ae60;color:#fff;border-radius:50%;width:36px;height:36px;font-size:24px;display:flex;align-items:center;justify-content:center}',
    '.mk-focus{border-color:#ffd54a!important;transform:scale(1.06);box-shadow:0 0 0 4px rgba(255,213,74,.35),0 12px 30px rgba(0,0,0,.6);z-index:2}',
    'html.mk-player,html.mk-player body{background:#000!important;overflow:hidden!important}',
    'html.mk-player body *{visibility:hidden!important}',
    'html.mk-player .mk-fs,html.mk-player .mk-fs *,html.mk-player #mk-layer,html.mk-player #mk-layer *,html.mk-player #mk-toast{visibility:visible!important}',
    'html.mk-player .mk-fs{position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;z-index:2147482000!important;border:0!important;background:#000!important;pointer-events:none!important;transform:none!important}',
    '#mk-layer{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483100;display:none;align-items:center;justify-content:center;flex-direction:column;direction:rtl;font-family:Arial,Helvetica,sans-serif;color:#fff;pointer-events:none}',
    '#mk-layer.mk-on{display:flex}',
    '#mk-layer .mk-card{background:rgba(27,11,46,.94);border-radius:22px;padding:36px 54px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.7)}',
    '#mk-layer .mk-big{font-size:34px;font-weight:bold;margin-bottom:10px}',
    '#mk-layer .mk-count{font-size:96px;font-weight:bold;color:#ffd54a;line-height:1.1;margin:6px 0 20px}',
    '#mk-layer .mk-btn{display:inline-block;font-size:28px;font-weight:bold;padding:16px 34px;border-radius:14px;background:#5b2a9e;border:5px solid transparent}',
    '#mk-layer .mk-pause{font-size:120px;background:rgba(0,0,0,.45);border-radius:50%;width:200px;height:200px;display:flex;align-items:center;justify-content:center}',
    '#mk-toast{position:fixed;left:50%;bottom:48px;transform:translateX(-50%);z-index:2147483200;background:rgba(0,0,0,.85);color:#fff;font:bold 24px Arial,sans-serif;padding:14px 28px;border-radius:12px;direction:rtl;display:none;visibility:visible!important}',
    '#mk-root.mk-center{display:flex;align-items:center;justify-content:center}',
    '#mk-root .mk-login{text-align:center;max-width:760px;padding:20px}',
    '#mk-root .mk-login h1{font-size:40px;color:#ffd54a;margin:0 0 14px}',
    '#mk-root .mk-login p{font-size:24px;line-height:1.5;opacity:.9;margin:0 0 30px}',
    '#mk-root .mk-login .mk-btn{display:inline-block;font-size:28px;font-weight:bold;padding:16px 36px;border-radius:14px;background:#5b2a9e;border:5px solid transparent}',
    '#mk-banner{position:fixed;bottom:0;left:0;right:0;z-index:2147483200;background:#c0392b;color:#fff;font:bold 20px Arial,sans-serif;padding:10px 20px;text-align:center;direction:rtl}',
    '.cc-window,.cc-banner{display:none!important}',
    'html.mk-boot::before,html.mk-loading::before{content:"";position:fixed;left:50%;top:44%;width:72px;height:72px;margin:-36px 0 0 -36px;box-sizing:border-box;border:8px solid rgba(255,213,74,.25);border-top-color:#ffd54a;border-radius:50%;animation:mk-spin .9s linear infinite;z-index:2147483647}',
    'html.mk-boot::after,html.mk-loading::after{content:"טוען...";position:fixed;left:0;right:0;top:calc(44% + 56px);text-align:center;color:#fff;font:bold 30px Arial,Helvetica,sans-serif;direction:rtl;z-index:2147483647}',
    '@keyframes mk-spin{to{transform:rotate(360deg)}}'
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
    log('focus ' + ((e.querySelector && e.querySelector('.mk-name')) ? e.querySelector('.mk-name').textContent : e.textContent || '').trim().slice(0, 40));
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
    log('key ' + k + ' kids=' + kids + ' layer=' + !!layerActive);
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
    else { store('mkMode', null); toast('מצב ילדים'); }
    setTimeout(function () { location.reload(); }, 800);
  }

  // Called by the app when Back is pressed. Returns 'handled', 'exit' or 'none'.
  MK.back = function () {
    if (!kids) return 'none';
    if (layerActive && layerActive.back) { return layerActive.back() === 'exit' ? 'exit' : 'handled'; }
    if (type === 'home') return 'exit';
    if (type === 'episode') { go(seriesUrl); return 'handled'; }
    go('/');
    return 'handled';
  };

  // ---------- login detection ----------
  // Login state. At TV width the site folds its header into a menu, so the "connected" words
  // are in the page but hidden. Read the page itself, not what is visible, and only call it
  // "logged out" on a clear sign of that.
  function loginSignals() {
    var sig = { connectedText: false, logoutLink: false, loginLink: false };
    var nodes = document.querySelectorAll('a,button,span,div,li');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.children.length > 2) continue;
      var t = (n.textContent || '').trim();
      if (t === 'ניתוק' || t === 'מחובר' || t === 'התנתקות' || t === 'יציאה מהחשבון') sig.connectedText = true;
    }
    sig.logoutLink = !!document.querySelector('a[href*="logout" i],a[href*="logoff" i],a[href*="disconnect" i],[onclick*="logout" i]');
    sig.loginLink = !!document.querySelector('a.menu-login,a[href*="join.meirkids.co.il/login"]');
    return sig;
  }
  function loginState() {
    var sig = loginSignals();
    if (sig.connectedText || sig.logoutLink) return { state: 'in', sig: sig };
    if (sig.loginLink) return { state: 'out', sig: sig };
    return { state: 'unknown', sig: sig }; // no clear sign: carry on as logged in
  }
  function loggedIn() { return loginState().state !== 'out'; }

  // Logged out: our own screen with one button to the login page. The site's own login button is
  // hidden in a menu at TV width, so we do not rely on it. A second button lets a parent go on
  // anyway, so a wrong guess here can never trap anyone in a loop.
  var LOGIN_URL = 'https://join.meirkids.co.il/login.php';
  function showLoginScreen(ls) {
    var root = el('div', 'mk-center');
    root.id = 'mk-root';
    var box = el('div', 'mk-login');
    box.appendChild(el('h1', null, 'צריך להתחבר לחשבון'));
    box.appendChild(el('p', null, 'פעם אחת בלבד, על ידי הורה. אחרי ההתחברות לוחצים על "חזור" בשלט.'));
    var btnLogin = el('div', 'mk-btn mk-focus', 'מעבר להתחברות');
    var btnGo = el('div', 'mk-btn', 'כבר התחברתי, המשך');
    btnGo.style.marginRight = '24px';
    box.appendChild(btnLogin);
    box.appendChild(btnGo);
    var s = ls.sig;
    var diag = el('div', null, 'אבחון: ' + [
      'connected=' + (s.connectedText ? 1 : 0),
      'logout=' + (s.logoutLink ? 1 : 0),
      'login=' + (s.loginLink ? 1 : 0),
      'w=' + window.innerWidth,
      'cookies=' + (document.cookie ? document.cookie.split(';').length : 0)
    ].join(' '));
    diag.style.cssText = 'margin-top:40px;font-size:15px;opacity:.55;direction:ltr';
    box.appendChild(diag);
    root.appendChild(box);
    document.body.appendChild(root);
    html.classList.add('mk-overlay');
    html.classList.remove('mk-boot');
    silenceSite();
    var cur = btnLogin;
    function focusBtn(b) { cur.classList.remove('mk-focus'); cur = b; cur.classList.add('mk-focus'); }
    layerActive = {
      key: function (k) {
        if (k === 'left' || k === 'right' || k === 'up' || k === 'down') { focusBtn(cur === btnLogin ? btnGo : btnLogin); return; }
        if (k !== 'enter') return;
        if (cur === btnLogin) { go(LOGIN_URL); return; }
        sess('mkSkipLogin', '1');
        location.reload();
      },
      back: function () { return 'exit'; }
    };
    log('login screen ' + JSON.stringify(s));
  }

  // Logged out: put the remote's focus on the site's own login button, so a parent presses OK once.
  function focusLoginLink() {
    var nodes = document.querySelectorAll('a,button');
    for (var i = 0; i < nodes.length; i++) {
      var t = (nodes[i].textContent || '').trim();
      if ((t === 'כניסה' || t === 'התחברות' || t === 'התחבר') && shown(nodes[i])) {
        try { nodes[i].focus(); nodes[i].scrollIntoView({ block: 'center' }); } catch (e) {}
        return;
      }
    }
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
  // Pictures. Lazy-loading sites put a placeholder in "src" and the real picture in a data-
  // attribute until the picture scrolls into view. Our screen hides the site, so its pictures
  // never scroll into view: read the real address and skip placeholders.
  var PLACEHOLDER = /placeholder|loading|blank|spacer|transparent|lazy|no-?image|default[-_]?(img|image|thumb)/i;
  function goodUrl(u) {
    if (!u) return '';
    u = String(u).trim();
    if (!u || /^data:/.test(u) || PLACEHOLDER.test(u)) return '';
    try { return new URL(u, location.href).href; } catch (e) { return ''; }
  }
  function firstOfSrcset(v) { return v ? v.split(',')[0].trim().split(' ')[0] : ''; }
  function imgUrl(im) {
    var c = [im.getAttribute('data-src'), im.getAttribute('data-lazy-src'), im.getAttribute('data-original'),
      im.getAttribute('data-lazy'), im.getAttribute('data-url'), firstOfSrcset(im.getAttribute('data-srcset')),
      firstOfSrcset(im.getAttribute('srcset')), im.getAttribute('src'), im.currentSrc];
    for (var i = 0; i < c.length; i++) { var u = goodUrl(c[i]); if (u) return u; }
    return '';
  }
  function imageIn(node) {
    if (!node) return '';
    var imgs = node.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) { var u = imgUrl(imgs[i]); if (u) return u; }
    var all = [node].concat(Array.prototype.slice.call(node.querySelectorAll('*')));
    for (var j = 0; j < all.length; j++) {
      var e = all[j];
      var bg = (e.style && e.style.backgroundImage) || e.getAttribute('data-bg') || e.getAttribute('data-background') || e.getAttribute('data-bg-src') || '';
      var m = bg.match(/url\(["']?(.*?)["']?\)/);
      var u2 = goodUrl(m ? m[1] : (/url\(/.test(bg) ? '' : bg));
      if (u2) return u2;
    }
    return '';
  }

  function cardOf(a, path) {
    var c = a.parentElement;
    for (var up = 0; up < 2 && c && c !== document.body; up++, c = c.parentElement) {
      var links = c.querySelectorAll('a[href]');
      var own = true;
      for (var i = 0; i < links.length; i++) { if (pathOf(links[i].getAttribute('href')) !== path) { own = false; break; } }
      if (!own) return null;
      if (c.querySelector('img') || /url\(/.test(c.getAttribute('style') || '')) return c;
    }
    return null;
  }

  function makeTile(name, sub, img, href) {
    var t = el('div', 'mk-tile');
    var pic = el('div', 'mk-img');
    if (img) pic.style.backgroundImage = 'url("' + img.replace(/"/g, '%22') + '")';
    else pic.appendChild(el('span', null, name));
    t.appendChild(pic);
    t.appendChild(el('div', 'mk-name', name));
    if (sub) t.appendChild(el('div', 'mk-sub', sub));
    t.setAttribute('data-href', href);
    t.mkPic = pic;
    return t;
  }

  // Our screens cover the site, but hidden site videos (the home page banner) would keep
  // streaming in the background. Stop every site video and embedded player, and keep them stopped.
  var silencing = false;
  function silenceSite() {
    if (silencing) return;
    silencing = true;
    function run() {
      Array.prototype.forEach.call(document.querySelectorAll('video,audio'), function (v) {
        try {
          v.pause();
          v.muted = true;
          v.autoplay = false;
          v.preload = 'none';
          if (v.getAttribute('src') || v.querySelector('source')) {
            v.removeAttribute('src');
            Array.prototype.forEach.call(v.querySelectorAll('source'), function (x) { x.parentNode.removeChild(x); });
            v.load();
          }
        } catch (e) {}
      });
      Array.prototype.forEach.call(document.querySelectorAll('iframe'), function (f) {
        if (/youtube|vimeo|player|jwp/i.test(f.getAttribute('src') || '')) f.setAttribute('src', 'about:blank');
      });
    }
    run();
    setInterval(run, 2000);
  }

  function buildRoot(title) {
    silenceSite();
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
      var byPath = {}, list = [];
      var anchors = document.querySelectorAll('a[href]');
      for (var i = 0; i < anchors.length; i++) {
        var a = anchors[i];
        var p = pathOf(a.getAttribute('href'));
        var s = p.split('/').filter(Boolean);
        if (s.length !== 2 || s[1] !== 'v') continue;
        if (!byPath[p]) {
          // The address is the series name, without the like counters and "..." the site adds.
          byPath[p] = { path: p, href: new URL(a.getAttribute('href'), location.href).href, name: s[0].replace(/-/g, ' '), img: '' };
          list.push(byPath[p]);
        }
        var item = byPath[p];
        if (!item.img) item.img = imageIn(a) || imageIn(cardOf(a, p));
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
      log('home tiles=' + tiles.length + ' withImage=' + tiles.filter(function (t) { return !!t.mkPic.style.backgroundImage; }).length);
      nav.items = function () { return tiles; };
      var lastSeries = store('mkLastSeries');
      var start = tiles[0];
      for (var i = 0; i < tiles.length; i++) if (tiles[i].mkPath === lastSeries) start = tiles[i];
      setFocus(start);
      handlers.arrow = move;
      handlers.enter = function () {
        if (!nav.cur) return;
        store('mkLastSeries', nav.cur.mkPath);
        go(nav.cur.getAttribute('data-href'));
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
            t.mkPic.innerHTML = '';
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
      log('series tiles=' + tiles.length + ' withImage=' + eps.filter(function (e) { return !!e.img; }).length + ' seasons=' + hasSeasons);
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
        go(nav.cur.getAttribute('data-href'));
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
    var progress = 0;
    var startedAt = Date.now();

    html.classList.add('mk-player', 'mk-loading');
    html.classList.remove('mk-boot');

    // The site uses more than one player: Vimeo for most series, JW Player for some,
    // and plain HTML5 video elsewhere. Whichever shows up first is used.
    function vimeoAdapter() {
      var f = document.getElementById('vimeo-player');
      if (!f || !window.Vimeo || !window.Vimeo.Player) return null;
      var player = new window.Vimeo.Player(f);
      f.setAttribute('tabindex', '-1');
      try { f.blur(); } catch (e) {}
      return {
        kind: 'vimeo', fsEl: f,
        play: function () { return player.play(); },
        pause: function () { return player.pause(); },
        paused: function () { return player.getPaused(); },
        seekBy: function (sec) {
          return Promise.all([player.getCurrentTime(), player.getDuration()]).then(function (v) {
            return player.setCurrentTime(Math.max(0, Math.min(v[1] - 1, v[0] + sec)));
          });
        },
        on: function (ev, fn) { player.on(ev, fn); },
        watchRemoval: true
      };
    }

    function jwAdapter() {
      if (typeof window.jwplayer !== 'function') return null;
      var p;
      try { p = window.jwplayer(); } catch (e) { return null; }
      if (!p || typeof p.getState !== 'function' || typeof p.getContainer !== 'function') return null;
      var box = p.getContainer();
      if (!box) return null;
      return {
        kind: 'jw', fsEl: box,
        play: function () { try { p.play(true); } catch (e) {} return Promise.resolve(); },
        pause: function () { try { p.pause(true); } catch (e) {} return Promise.resolve(); },
        paused: function () { var st = p.getState(); return Promise.resolve(st !== 'playing' && st !== 'buffering'); },
        seekBy: function (sec) {
          var d = p.getDuration() || 0;
          p.seek(Math.max(0, Math.min(d - 1, (p.getPosition() || 0) + sec)));
          return Promise.resolve();
        },
        on: function (ev, fn) {
          if (ev === 'ended') p.on('complete', fn);
          else if (ev === 'timeupdate') p.on('time', function (d) { fn({ percent: d && d.duration ? d.position / d.duration : 0 }); });
          else p.on(ev, fn);
        },
        state: function () { try { return p.getState(); } catch (e) { return '?'; } }
      };
    }

    function html5Adapter() {
      var v = null;
      Array.prototype.forEach.call(document.querySelectorAll('video'), function (x) { if (!v && (x.currentSrc || x.src || x.querySelector('source'))) v = x; });
      if (!v) return null;
      return {
        kind: 'html5', fsEl: v,
        play: function () { return v.play(); },
        pause: function () { v.pause(); return Promise.resolve(); },
        paused: function () { return Promise.resolve(v.paused); },
        seekBy: function (sec) { v.currentTime = Math.max(0, Math.min((v.duration || 0) - 1, v.currentTime + sec)); return Promise.resolve(); },
        on: function (ev, fn) {
          if (ev === 'timeupdate') v.addEventListener('timeupdate', function () { fn({ percent: v.duration ? v.currentTime / v.duration : 0 }); });
          else v.addEventListener(ev, fn);
        }
      };
    }

    setTimeout(function () { html.classList.remove('mk-loading'); }, 20000);
    (function detect() {
      if (ended) return;
      var a = null;
      try { a = vimeoAdapter() || jwAdapter() || html5Adapter(); } catch (e) { a = null; }
      if (a) { log('player ' + a.kind); wirePlayer(a); return; }
      if (Date.now() - startedAt > 15000) { log('no player found'); noPlayer(); return; }
      setTimeout(detect, 300);
    })();

    // Never leave a kid on a black screen.
    function noPlayer() {
      html.classList.remove('mk-loading');
      var card = el('div', 'mk-card');
      card.appendChild(el('div', 'mk-big', 'הפרק לא נטען'));
      card.appendChild(el('div', 'mk-big', 'חוזרים לרשימת הפרקים...'));
      showLayer(card);
      var back = function () { go(seriesUrl); };
      layerActive = { key: function (k) { if (k === 'enter') back(); }, back: back };
      setTimeout(back, 4000);
    }

    function wirePlayer(p) {
      p.fsEl.classList.add('mk-fs');
      p.on('play', function () { html.classList.remove('mk-loading'); native('setKeepScreenOn', true); showLayer(null); });
      p.on('timeupdate', function () { html.classList.remove('mk-loading'); });
      p.on('pause', function () { native('setKeepScreenOn', false); });
      p.on('ended', function () { onEnded(); });
      p.on('timeupdate', function (d) {
        if (d && typeof d.percent === 'number') progress = d.percent;
        if (progress > 0.85) markWatched(seriesSlug, epId);
      });
      var started = null;
      try { started = p.play(); } catch (e) { started = null; }
      if (started && started.then) started.then(function () { log('play ok'); }, function (e) { log('play failed ' + e); html.classList.remove('mk-loading'); toast('לחצו OK כדי להתחיל', 4000); });
      if (p.state) setTimeout(function () { log('player state after 8s: ' + p.state()); }, 8000);

      if (p.watchRemoval) {
        // The site removes the Vimeo frame at the end and shows its own suggestions. If that happens
        // before we heard "ended", treat it as the end; if it happens early, hook the new player.
        var mo = new MutationObserver(function () {
          if (document.body.contains(p.fsEl)) return;
          mo.disconnect();
          if (progress > 0.9) onEnded();
          else setTimeout(function () {
            if (ended) return;
            var again = vimeoAdapter();
            if (again) { log('player replaced, rewiring'); wirePlayer(again); }
          }, 1000);
        });
        mo.observe(document.body, { childList: true, subtree: true });
      }

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
      html.classList.remove('mk-loading');
      log('episode ended');
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
          var back = function () { go(seriesUrl); };
          layerActive = { key: function (k) { if (k === 'enter') back(); }, back: back };
          setTimeout(back, 3500);
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
            log('auto next, count=' + (auto + 1));
            html.classList.add('mk-loading');
            nextBtn.click();
            // If the click did not navigate, go back to the list rather than sit on a black screen.
            setTimeout(function () { go(seriesUrl); }, 6000);
          }
        }, 1000);
        var toList = function () { clearInterval(timer); go(seriesUrl); };
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
    log('ready type=' + type + ' forcedMode=' + forcedMode + ' loggedIn=' + loggedIn() + ' width=' + window.innerWidth + 'x' + window.innerHeight + ' dpr=' + window.devicePixelRatio);
    if (!kids) {
      html.classList.remove('mk-boot');
      parentBanner('מצב הורים. כדי לחזור למצב ילדים: למעלה, למעלה, למטה, למטה, OK');
      return;
    }
    native('setKidMode', true);
    if ((type === 'home' || type === 'series') && forcedMode !== 'kids' && sess('mkSkipLogin') !== '1') {
      var ls = loginState();
      log('login state ' + ls.state + ' ' + JSON.stringify(ls.sig));
      if (ls.state === 'out') { showLoginScreen(ls); return; }
    }
    if (type === 'home') initHome();
    else if (type === 'series') initSeries();
    else if (type === 'episode') initEpisode();
    else initFallback();
  });
})();
