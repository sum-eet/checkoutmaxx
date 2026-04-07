/**
 * CouponMaxx Smart Recovery — storefront script
 * One line: "That code didn't work? try CODE valid for 15 mins only"
 * Pill copies to clipboard. No auto-apply. No modals.
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
  // Track recovery codes so we don't re-trigger on them
  var _recoveryCodes = {};

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

  // ── Render — one line only ─────────────────────────────────────────────────

  function render(resp) {
    if (resp.action === 'show_nothing' || !resp.action) return;

    // Keep best response
    if (!resp.code && _lastGoodResponse && _lastGoodResponse.code) resp = _lastGoodResponse;
    if (resp.code) {
      _lastGoodResponse = resp;
      _recoveryCodes[resp.code.toUpperCase()] = true;
    }

    var style = resp.displayStyle || CONFIG.style;
    var container = findOrCreateContainer();
    if (!container) return;

    if (_observer) _observer.disconnect();

    container.innerHTML = '';
    container.className = 'cmx-recovery-active cmx-style-' + style;

    if (resp.action === 'show_code' && resp.code) {
      // "That code didn't work? try CODE valid for 15 mins only"
      var text1 = document.createTextNode("That code didn\u2019t work? try ");
      container.appendChild(text1);

      var pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'cmx-code-pill';
      pill.textContent = resp.code;
      pill.addEventListener('click', function () {
        if (navigator.clipboard) navigator.clipboard.writeText(resp.code);
        pill.textContent = 'Copied!';
        setTimeout(function () { pill.textContent = resp.code; }, 2000);
      });
      container.appendChild(pill);

      if (resp.expiresInMinutes) {
        var text2 = document.createTextNode(' valid for ' + resp.expiresInMinutes + ' mins only');
        container.appendChild(text2);
      }
    } else {
      // Hint only — one line
      var reason = resp._resolvedReason || 'invalid';
      var hintText = {
        expired: "That code has expired.",
        min_not_met: "Add more to your cart to use this code.",
        usage_limit: "That code has been fully redeemed.",
        wrong_collection: "That code only works on certain products.",
        already_used: "You\u2019ve already used this code.",
        invalid: "That code didn\u2019t work.",
      }[reason] || "That code didn\u2019t work.";
      container.textContent = hintText;
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

  // ── API call (deduplicated) ────────────────────────────────────────────────

  function callApi(detail) {
    if (_inflight) return;

    // Don't re-trigger on recovery codes we generated
    var code = (detail.code || '').toUpperCase();
    if (_recoveryCodes[code]) return;

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

      // Don't re-trigger on our own recovery codes
      if (_recoveryCodes[code.toUpperCase()]) return;

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
