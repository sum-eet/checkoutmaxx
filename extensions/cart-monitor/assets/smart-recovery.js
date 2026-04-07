/**
 * CouponMaxx Smart Recovery — storefront script
 * One short line + code pill with copy. No modals, no pop-ups.
 */
(function () {
  'use strict';

  var script = document.currentScript || document.querySelector('script[data-recovery-url]');

  var CONFIG = {
    shopDomain: script && script.dataset.shop ? script.dataset.shop : window.location.hostname,
    recoveryUrl: script && script.dataset.recoveryUrl
      ? script.dataset.recoveryUrl
      : 'https://couponmaxx.vercel.app/api/couponmaxx/recovery/decide',
    style: (script && script.dataset.style) || 'minimal',
  };

  var _inflight = false;
  var _lastGoodResponse = null;
  var _observer = null;
  var _lastInputValue = '';

  var COPY_ICON = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 4v-2a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2h-2v2a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm2 0h4a2 2 0 012 2v4h-1V6a1 1 0 00-1-1H6V4zm-2 2a1 1 0 00-1 1v8a1 1 0 001 1h6a1 1 0 001-1V6a1 1 0 00-1-1H4z"/></svg>';

  // ── Selectors ──────────────────────────────────────────────────────────────

  var ERROR_SELECTORS = [
    '[data-cart-discount-errors]', '.cart-discount__error',
    '#CartDiscountCode-CartDrawer ~ .field__message--error',
    '#CartDiscountCode ~ .field__message--error',
    '[id*="DiscountCode"] + .field__message--error',
    '[id*="discount"] + .field__message--error',
    '.discount-field ~ p.error', '.discount__message--error', '[data-discount-error]',
  ];

  var INPUT_SELECTORS = [
    '#CartDiscountCode-CartDrawer', '#CartDiscountCode',
    '[name="discount"]', '[data-discount-input]', '[id*="DiscountCode"]',
  ];

  var FORM_SELECTORS = [
    'form[data-cart-discount-form]', 'form[action*="discount"]',
    '#cart-discount-form', '.cart-discount form',
  ];

  function findFirst(s) {
    for (var i = 0; i < s.length; i++) { var el = document.querySelector(s[i]); if (el) return el; }
    return null;
  }
  function findInput() { return findFirst(INPUT_SELECTORS); }

  function findOrCreateContainer() {
    var el = findFirst(ERROR_SELECTORS);
    if (el) return el;
    var anchor = findInput() || findFirst(FORM_SELECTORS);
    if (!anchor) return null;
    var c = document.createElement('p');
    c.className = 'cmx-recovery-message';
    c.id = 'cmx-recovery-container';
    (anchor.closest('form') || anchor.parentElement).appendChild(c);
    return c;
  }

  // ── Short failure text ─────────────────────────────────────────────────────

  function failureText(reason, hasCode) {
    if (hasCode) {
      switch (reason) {
        case 'expired': return "That code expired \u2014 try this one:";
        case 'min_not_met': return "Cart minimum not met \u2014 here\u2019s a code:";
        case 'usage_limit': return "That code\u2019s used up \u2014 try this:";
        case 'already_used': return "Already used \u2014 here\u2019s a fresh one:";
        default: return "That code didn\u2019t work \u2014 try this:";
      }
    }
    switch (reason) {
      case 'expired': return "That code has expired.";
      case 'min_not_met': return "Add more to your cart to use this code.";
      case 'usage_limit': return "That code has been fully redeemed.";
      case 'wrong_collection': return "That code only works on certain products.";
      case 'already_used': return "You\u2019ve already used this code.";
      default: return "That code didn\u2019t work.";
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function render(resp) {
    if (resp.action === 'show_nothing' || !resp.action) return;

    // Keep best response
    if (!resp.code && _lastGoodResponse && _lastGoodResponse.code) resp = _lastGoodResponse;
    if (resp.code) _lastGoodResponse = resp;

    var style = resp.displayStyle || CONFIG.style;
    var container = findOrCreateContainer();
    if (!container) return;

    if (_observer) _observer.disconnect();

    var reason = resp._resolvedReason || 'invalid';
    var hasCode = resp.action === 'show_code' && resp.code;
    var text = failureText(reason, hasCode);

    container.innerHTML = '';
    container.className = 'cmx-recovery-active cmx-style-' + style;

    // Text
    var span = document.createElement('span');
    span.className = 'cmx-recovery-text';
    span.textContent = text;
    container.appendChild(span);

    // Code pill
    if (hasCode) {
      var pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'cmx-code-pill';
      pill.innerHTML = resp.code + ' ' + COPY_ICON;
      pill.addEventListener('click', function () { applyCode(resp.code, pill); });
      container.appendChild(pill);

      // Terms line
      if (resp.discountLabel || resp.expiresInMinutes) {
        var terms = document.createElement('span');
        terms.className = 'cmx-recovery-terms';
        var t = resp.discountLabel || '';
        if (resp.expiresInMinutes) t += (t ? ' \u00b7 ' : '') + 'valid ' + resp.expiresInMinutes + ' min';
        terms.textContent = t;
        container.appendChild(terms);
      }
    }

    // Fade in
    container.style.opacity = '0';
    requestAnimationFrame(function () {
      container.style.transition = 'opacity 300ms ease';
      container.style.opacity = '1';
    });

    // Reconnect observer after DOM settles
    setTimeout(function () {
      if (_observer) _observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }, 500);
  }

  // ── Apply code ─────────────────────────────────────────────────────────────

  function applyCode(code, pill) {
    if (!code) return;
    // Copy to clipboard
    if (navigator.clipboard) navigator.clipboard.writeText(code);

    var input = findInput();
    if (input) {
      input.value = code;
      var form = input.closest('form');
      if (form) {
        var btn = form.querySelector('[type="submit"]');
        if (btn) { pill.innerHTML = 'Applying\u2026'; pill.disabled = true; btn.click(); return; }
      }
    }

    // Fallback
    pill.innerHTML = 'Applying\u2026'; pill.disabled = true;
    fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discount: code }),
    })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        var ok = (cart.cart_level_discount_applications || []).some(function (d) { return d.title === code; });
        if (ok) { pill.innerHTML = '\u2713 Applied'; pill.classList.add('cmx-code-pill--applied'); }
        else { pill.innerHTML = code + ' ' + COPY_ICON; pill.disabled = false; }
      })
      .catch(function () { pill.innerHTML = code + ' ' + COPY_ICON; pill.disabled = false; });
  }

  // ── Countdown ──────────────────────────────────────────────────────────────

  function startCountdown(el, secs, container) {
    var r = secs;
    var iv = setInterval(function () {
      r--;
      if (r <= 0) { clearInterval(iv); if (container) container.classList.add('cmx-recovery-expired'); el.textContent = '0 min'; return; }
      el.textContent = r > 60 ? Math.floor(r / 60) + ' min' : r + ' sec';
    }, 1000);
  }

  // ── API call (deduplicated) ────────────────────────────────────────────────

  function callApi(detail) {
    if (_inflight) return;
    _inflight = true;

    fetch(CONFIG.recoveryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopId: CONFIG.shopDomain,
        sessionId: detail.sessionId,
        failedCode: detail.code || '',
        failureReason: mapReason(detail.failureReason),
        cartValue: detail.cartValue || 0,
        cartItems: (detail.lineItems || []).map(function (i) {
          return { productTitle: i.productTitle || '', collectionIds: i.collectionIds || [], price: i.price || 0, quantity: i.quantity || 1 };
        }),
        customerName: null,
        attemptsThisSession: detail.attemptsThisSession || 1,
        device: /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
        source: getUtm(),
      }),
    })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function (e) { console.warn('[CouponMaxx Recovery]', e); })
      .finally(function () { setTimeout(function () { _inflight = false; }, 3000); });
  }

  function mapReason(r) {
    return { unknown: 'invalid', invalid_code: 'invalid', expired: 'expired', minimum_not_met: 'min_not_met',
      usage_limit_reached: 'usage_limit', customer_usage_limit: 'already_used', product_ineligible: 'wrong_collection' }[r] || 'invalid';
  }

  function getUtm() {
    try { var s = sessionStorage.getItem('_cmx_utm'); if (s) return JSON.parse(s).source || null; } catch (e) {}
    return new URLSearchParams(window.location.search).get('utm_source');
  }

  // ── MutationObserver fallback ──────────────────────────────────────────────

  function watchErrors() {
    _observer = new MutationObserver(function () {
      var el = findFirst(ERROR_SELECTORS);
      if (!el || el.classList.contains('cmx-recovery-active')) return;
      var t = el.textContent && el.textContent.trim();
      if (!t) return;
      var lo = t.toLowerCase();
      if (lo.indexOf('discount') === -1 && lo.indexOf('coupon') === -1 && lo.indexOf('promo') === -1 && lo.indexOf('cannot be applied') === -1) return;

      var input = findInput();
      var code = input ? input.value.trim() : _lastInputValue;
      var sid = sessionStorage.getItem('_cmx_sid') || ('cart_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9));
      callApi({ code: code, failureReason: 'unknown', cartValue: 0, lineItems: [], sessionId: sid, attemptsThisSession: 1 });
    });
    _observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    document.addEventListener('change', function (e) {
      var input = findInput();
      if (input && e.target === input) _lastInputValue = input.value.trim();
    }, true);
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  window.addEventListener('cmx:coupon_failed', function (e) { callApi(e.detail); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchErrors);
  else watchErrors();

})();
