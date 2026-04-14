/**
 * CouponMaxx Smart Recovery — storefront script
 */
(function () {
  'use strict';

  // Prevent duplicate execution if script loads twice
  if (window._cmxRecoveryLoaded) return;
  window._cmxRecoveryLoaded = true;

  var script = document.currentScript || document.querySelector('script[data-recovery-url]');

  var CONFIG = {
    shopDomain: script && script.dataset.shop ? script.dataset.shop : window.location.hostname,
    recoveryUrl: script && script.dataset.recoveryUrl
      ? script.dataset.recoveryUrl
      : 'https://couponmaxx.vercel.app/api/couponmaxx/cx',
  };

  var _inflight = false;
  var _observer = null;
  var _lastInputValue = '';
  var _recoveryCodes = {};

  // Known error element selectors across common Shopify themes.
  // Dawn uses id="${inputId}-error" pattern; others use class-based selectors.
  var ERROR_SELECTORS = [
    '#CartDiscountCode-error',
    '#CartDiscountCode-CartDrawer-error',
    '[data-cart-discount-errors]',
    '.cart-discount__error',
    '#CartDiscountCode-CartDrawer ~ .field__message--error',
    '#CartDiscountCode ~ .field__message--error',
    '[id*="DiscountCode"] + .field__message--error',
    '[id*="discount"] + .field__message--error',
    '.discount-field ~ p.error',
    '.discount__message--error',
    '[data-discount-error]',
    'input[name="discount"] ~ p[role="alert"]',
  ];

  var INPUT_SELECTORS = [
    '#CartDiscountCode-CartDrawer', '#CartDiscountCode',
    '[name="discount"]', '[data-discount-input]', '[id*="DiscountCode"]',
  ];

  function findFirst(s) {
    for (var i = 0; i < s.length; i++) { var el = document.querySelector(s[i]); if (el) return el; }
    return null;
  }
  function findInput() { return findFirst(INPUT_SELECTORS); }

  function findErrorContainer() {
    // 1. Try known selectors first
    var found = findFirst(ERROR_SELECTORS);
    if (found) return found;

    // 2. DOM traversal fallback — walk up from the discount input and search
    //    nearby subtrees for an error/alert element. Handles themes where the
    //    error <p> is a sibling of a wrapping <div> rather than the input itself.
    var input = findInput();
    if (!input) return null;

    var node = input;
    for (var depth = 0; depth < 3; depth++) {
      var parent = node.parentNode;
      if (!parent) break;
      var sibling = parent.querySelector('.field__message--error, [role="alert"], .cart-discount__error');
      if (sibling && sibling !== input) return sibling;
      node = parent;
    }

    return null;
  }

  // ── Clean up any stale recovery messages ───────────────────────────────────

  function cleanupOldMessages() {
    var old = document.querySelectorAll('.cmx-recovery-active');
    for (var i = 0; i < old.length; i++) {
      old[i].classList.remove('cmx-recovery-active');
      old[i].innerHTML = '';
      // If we created this element as a fallback, remove it entirely
      if (old[i].id === 'cmx-recovery-msg' && old[i].parentNode) {
        old[i].parentNode.removeChild(old[i]);
      }
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function render(resp) {
    if (resp.action === 'show_nothing' || !resp.action) return;

    if (resp.code) {
      _recoveryCodes[resp.code.toUpperCase()] = true;
    }

    var container = findErrorContainer();

    // Last-resort fallback: create a <p> adjacent to the discount form.
    // Uses the theme's own CSS class so it inherits styling automatically.
    if (!container) {
      var input = findInput();
      if (!input) return;
      var fallback = document.createElement('p');
      fallback.className = 'field__message--error';
      fallback.id = 'cmx-recovery-msg';
      fallback.setAttribute('role', 'alert');
      fallback.setAttribute('aria-live', 'polite');
      var anchor = input.closest('form') || input.parentNode;
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(fallback, anchor.nextSibling);
      } else {
        input.parentNode.insertBefore(fallback, input.nextSibling);
      }
      container = fallback;
    }

    if (_observer) _observer.disconnect();

    cleanupOldMessages();

    container.classList.add('cmx-recovery-active');

    // Force the container visible — themes hide it when empty via CSS or attributes
    container.removeAttribute('hidden');
    container.removeAttribute('aria-hidden');
    container.setAttribute('aria-live', 'polite');
    if (window.getComputedStyle(container).display === 'none') {
      container.style.display = 'block';
    }

    if (resp.action === 'show_code' && resp.code) {
      container.textContent = '';
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
        container.appendChild(document.createTextNode(' valid for ' + resp.expiresInMinutes + ' mins only'));
      }
    } else {
      var reason = resp._resolvedReason || 'invalid';
      container.textContent = ({
        expired: "That code has expired.",
        min_not_met: "Add more to your cart to use this code.",
        usage_limit: "That code has been fully redeemed.",
        wrong_collection: "That code only works on certain products.",
        already_used: "You\u2019ve already used this code.",
        invalid: "That code didn\u2019t work.",
      })[reason] || "That code didn\u2019t work.";
    }

    // Reconnect observer after DOM settles
    setTimeout(function () {
      if (_observer) _observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }, 500);
  }

  // ── API call ───────────────────────────────────────────────────────────────

  function callApi(detail) {
    if (_inflight) return;

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
      .then(function (r) {
        if (!r.ok) return null;
        return r.json();
      })
      .then(function (data) { if (data) render(data); })
      .catch(function () { /* recovery endpoint not available — silent */ })
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
      var el = findErrorContainer();
      if (!el || el.classList.contains('cmx-recovery-active')) return;
      var t = el.textContent && el.textContent.trim();
      if (!t) return;
      var lo = t.toLowerCase();
      if (lo.indexOf('discount') === -1 && lo.indexOf('coupon') === -1 && lo.indexOf('promo') === -1 && lo.indexOf('cannot be applied') === -1) return;

      var input = findInput();
      var code = input ? input.value.trim() : _lastInputValue;
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
