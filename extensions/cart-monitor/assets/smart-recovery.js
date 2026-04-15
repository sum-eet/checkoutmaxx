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

  // Known error/message element selectors across common Shopify themes.
  // Ordered: most specific first, generic fallbacks last.
  var ERROR_SELECTORS = [
    // Dawn (Shopify default) — id-based error elements
    '#CartDiscountCode-error',
    '#CartDiscountCode-CartDrawer-error',
    '[data-cart-discount-errors]',

    // Dawn / Refresh — "code applied" display (accepted but may not apply)
    '.cart__discount-code',
    '[data-discount-code-display]',

    // Debut / Brooklyn / Narrative
    '.cart__discount-error',
    '.cart-discount__error',
    '.cart-discount__message',

    // Craft / Crave / Spotlight
    '.cart__coupon-error',
    '.field__message--error',
    '.form__message--error',

    // Announce / Colorblock / Origin — attribute wildcard
    '[class*="discount"][class*="error"]',
    '[class*="coupon"][class*="error"]',
    '[class*="promo"][class*="error"]',

    // Generic role-based (works on most custom themes)
    '[role="alert"]',
    '.alert--error',
    '.error-message',
    '.notice--error',
    '.errors',

    // Sibling patterns — error is adjacent to input
    '#CartDiscountCode-CartDrawer ~ .field__message--error',
    '#CartDiscountCode ~ .field__message--error',
    '[id*="DiscountCode"] + .field__message--error',
    '[id*="discount"] + .field__message--error',
    '.discount-field ~ p.error',
    '.discount__message--error',
    '[data-discount-error]',
    'input[name="discount"] ~ p[role="alert"]',
    'input[name="discount"] ~ .errors',
  ];

  var INPUT_SELECTORS = [
    '#CartDiscountCode-CartDrawer', '#CartDiscountCode',
    '[name="discount"]', '[data-discount-input]',
    '[id*="DiscountCode"]', '[id*="discount_code"]',
    '.cart__discount-input',
    'input[placeholder*="discount" i]',
    'input[placeholder*="coupon" i]',
    'input[placeholder*="promo" i]',
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

    // Last-resort fallback: inject a recovery message element near the discount area.
    // Try multiple insertion points before resorting to a sticky banner.
    if (!container) {
      var input = findInput();
      var fallback = document.createElement('p');
      fallback.className = 'field__message--error cmx-recovery-injected';
      fallback.id = 'cmx-recovery-msg';
      fallback.setAttribute('role', 'alert');
      fallback.setAttribute('aria-live', 'polite');

      var inserted = false;

      if (input) {
        // 1. Try: after the discount form element
        var discountForm = input.closest('form');
        if (discountForm && discountForm.parentNode) {
          discountForm.parentNode.insertBefore(fallback, discountForm.nextSibling);
          inserted = true;
        }
        // 2. Try: after the input's immediate parent
        if (!inserted && input.parentNode && input.parentNode.parentNode) {
          input.parentNode.parentNode.insertBefore(fallback, input.parentNode.nextSibling);
          inserted = true;
        }
        // 3. Try: directly after the input
        if (!inserted && input.parentNode) {
          input.parentNode.insertBefore(fallback, input.nextSibling);
          inserted = true;
        }
      }

      // 4. Try: before the checkout button (visible on all themes)
      if (!inserted) {
        var checkoutBtn = document.querySelector('[name="checkout"], .cart__ctas, .cart-checkout-button, [data-cart-checkout]');
        if (checkoutBtn && checkoutBtn.parentNode) {
          checkoutBtn.parentNode.insertBefore(fallback, checkoutBtn);
          inserted = true;
        }
      }

      // 5. Last resort: sticky banner pinned to bottom of viewport
      if (!inserted) {
        fallback.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:99999;background:#fff;border:1px solid #c44;border-radius:8px;padding:10px 16px;font-size:13px;color:#c44;box-shadow:0 4px 12px rgba(0,0,0,0.15);max-width:90vw;';
        document.body.appendChild(fallback);
        inserted = true;
      }

      if (!inserted) return;
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

  // ── Cart.js verification ───────────────────────────────────────────────────
  // Used when DOM text says "Code applied: X" — verify the code is actually
  // applicable:false before triggering recovery (avoids false positives).

  function triggerIfInvalidCode(code, sid) {
    if (!code) return;
    if (_recoveryCodes[code.toUpperCase()]) return;
    fetch('/cart.js')
      .then(function(r) { return r.json(); })
      .then(function(cart) {
        var codes = cart.discount_codes || [];
        var match = null;
        for (var i = 0; i < codes.length; i++) {
          if (codes[i].code && codes[i].code.toUpperCase() === code.toUpperCase()) {
            match = codes[i];
            break;
          }
        }
        if (match && match.applicable === false) {
          callApi({
            code: code,
            failureReason: 'unknown',
            cartValue: cart.total_price || 0,
            lineItems: (cart.items || []).map(function(i) {
              return { productId: i.product_id, variantId: i.variant_id,
                       productTitle: i.product_title, price: i.price, quantity: i.quantity };
            }),
            sessionId: sid,
            attemptsThisSession: 1,
          });
        }
      })
      .catch(function() {});
  }

  // ── MutationObserver fallback ──────────────────────────────────────────────

  function watchErrors() {
    _observer = new MutationObserver(function () {
      var el = findErrorContainer();
      if (!el || el.classList.contains('cmx-recovery-active')) return;
      var t = el.textContent && el.textContent.trim();
      if (!t) return;
      var lo = t.toLowerCase();

      // Match failure messages AND "Code applied: X" (applied but may not give discount)
      var isFailureText =
        lo.indexOf('discount') !== -1 ||
        lo.indexOf('coupon') !== -1 ||
        lo.indexOf('promo') !== -1 ||
        lo.indexOf('cannot be applied') !== -1 ||
        lo.indexOf('promotion applied') !== -1;

      var isAppliedText = lo.indexOf('code applied') !== -1 || lo.indexOf('applied:') !== -1;

      if (!isFailureText && !isAppliedText) return;

      var input = findInput();
      var code = input ? input.value.trim() : _lastInputValue;
      // If DOM shows "Code applied: X", extract the code from the text if input is empty
      if (!code && isAppliedText) {
        var m = t.match(/(?:code applied|applied)[:\s]+([A-Z0-9_\-]+)/i);
        if (m) code = m[1];
      }
      if (!code) return;
      if (_recoveryCodes[code.toUpperCase()]) return;

      var sid = sessionStorage.getItem('_cmx_sid') || ('cart_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9));

      if (isAppliedText && !isFailureText) {
        // "Code applied" — need to verify it's actually not giving a discount
        triggerIfInvalidCode(code, sid);
      } else {
        callApi({ code: code, failureReason: 'unknown', cartValue: 0, lineItems: [], sessionId: sid, attemptsThisSession: 1 });
      }
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
