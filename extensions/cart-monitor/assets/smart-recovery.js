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

  console.log('[CMX Recovery] script loaded, CONFIG:', CONFIG);

  var _inflight = false;
  var _observer = null;
  var _debounceTimer = null;
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
    if (found) {
      console.log('[CMX Recovery] findErrorContainer: found via selector, el:', found, 'text:', found.textContent && found.textContent.trim());
      return found;
    }

    // 2. DOM traversal fallback — walk up from the discount input and search
    //    nearby subtrees for an error/alert element.
    var input = findInput();
    if (!input) {
      console.log('[CMX Recovery] findErrorContainer: no input found either');
      return null;
    }

    var node = input;
    for (var depth = 0; depth < 3; depth++) {
      var parent = node.parentNode;
      if (!parent) break;
      var sibling = parent.querySelector('.field__message--error, [role="alert"], .cart-discount__error');
      if (sibling && sibling !== input) {
        console.log('[CMX Recovery] findErrorContainer: found via DOM traversal at depth', depth, sibling);
        return sibling;
      }
      node = parent;
    }

    console.log('[CMX Recovery] findErrorContainer: no container found');
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
  // We ALWAYS inject our own element appended directly to <body>.
  // Never write into Shopify's cart section elements — morph.js will
  // immediately overwrite anything we put there on the next cart re-render.

  function removeExistingBanner() {
    var old = document.getElementById('cmx-recovery-banner');
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  function render(resp) {
    console.log('[CMX Recovery] render called, resp:', resp);
    if (resp.action === 'show_nothing' || !resp.action) {
      console.log('[CMX Recovery] render: action is show_nothing or missing — not rendering');
      return;
    }

    if (resp.code) {
      _recoveryCodes[resp.code.toUpperCase()] = true;
    }

    if (_observer) _observer.disconnect();
    removeExistingBanner();

    // Build our own banner appended to <body> — Shopify's morph.js never
    // touches direct body children that it didn't put there.
    var banner = document.createElement('div');
    banner.id = 'cmx-recovery-banner';
    banner.setAttribute('role', 'alert');
    banner.setAttribute('aria-live', 'polite');
    banner.style.cssText = [
      'position:fixed',
      'bottom:24px',
      'left:50%',
      'transform:translateX(-50%)',
      'z-index:2147483647',
      'background:#fff3cd',
      'border:1.5px solid #e6a817',
      'border-radius:10px',
      'padding:12px 20px',
      'font-size:14px',
      'color:#7a4f00',
      'box-shadow:0 4px 16px rgba(0,0,0,0.18)',
      'max-width:92vw',
      'text-align:center',
      'cursor:default',
    ].join(';');

    // Close button
    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = '\u00d7';
    close.setAttribute('aria-label', 'Dismiss');
    close.style.cssText = 'float:right;margin-left:12px;background:none;border:none;font-size:18px;cursor:pointer;color:#7a4f00;line-height:1;padding:0;';
    close.addEventListener('click', removeExistingBanner);
    banner.appendChild(close);

    if (resp.action === 'show_code' && resp.code) {
      var msg = document.createElement('span');
      msg.textContent = "That code didn\u2019t work \u2014 try ";
      banner.appendChild(msg);

      var pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'cmx-code-pill';
      pill.textContent = resp.code;
      pill.style.cssText = 'background:#e6a817;color:#fff;border:none;border-radius:5px;padding:3px 10px;font-weight:700;font-size:13px;cursor:pointer;letter-spacing:0.05em;margin:0 4px;';
      pill.addEventListener('click', function () {
        if (navigator.clipboard) navigator.clipboard.writeText(resp.code);
        pill.textContent = 'Copied!';
        setTimeout(function () { pill.textContent = resp.code; }, 2000);
      });
      banner.appendChild(pill);

      if (resp.expiresInMinutes) {
        var exp = document.createElement('span');
        exp.textContent = ' \u2014 valid for ' + resp.expiresInMinutes + ' mins';
        banner.appendChild(exp);
      }
      console.log('[CMX Recovery] render: showed recovery code', resp.code);
    } else {
      var reason = resp._resolvedReason || 'invalid';
      var text = ({
        expired: "That code has expired.",
        min_not_met: "Add more to your cart to use this code.",
        usage_limit: "That code has been fully redeemed.",
        wrong_collection: "That code only works on certain products.",
        already_used: "You\u2019ve already used this code.",
        invalid: "That code didn\u2019t work.",
      })[reason] || "That code didn\u2019t work.";
      var msgEl = document.createElement('span');
      msgEl.textContent = text;
      banner.appendChild(msgEl);
      console.log('[CMX Recovery] render: showed explanation for reason', reason);
    }

    document.body.appendChild(banner);
    console.log('[CMX Recovery] render: banner injected into body');

    // Auto-dismiss after 12 seconds
    setTimeout(removeExistingBanner, 12000);

    // Reconnect observer after DOM settles
    setTimeout(function () {
      if (_observer) _observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }, 500);
  }

  // ── API call ───────────────────────────────────────────────────────────────

  function callApi(detail) {
    if (_inflight) {
      console.log('[CMX Recovery] callApi: skipped — request already inflight');
      return;
    }

    var code = (detail.code || '').toUpperCase();
    if (_recoveryCodes[code]) {
      console.log('[CMX Recovery] callApi: skipped — code already in recovery set:', code);
      return;
    }

    _inflight = true;
    console.log('[CMX Recovery] callApi: sending request to', CONFIG.recoveryUrl, 'payload:', detail);

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
        console.log('[CMX Recovery] API response status:', r.status);
        if (!r.ok) {
          console.warn('[CMX Recovery] API returned non-ok status:', r.status);
          return null;
        }
        return r.json();
      })
      .then(function (data) {
        console.log('[CMX Recovery] API response data:', data);
        if (data) render(data);
      })
      .catch(function (err) {
        console.warn('[CMX Recovery] API fetch error:', err);
      })
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
    console.log('[CMX Recovery] triggerIfInvalidCode: checking /cart.js for code', code);
    fetch('/cart.js')
      .then(function(r) { return r.json(); })
      .then(function(cart) {
        var codes = cart.discount_codes || [];
        console.log('[CMX Recovery] triggerIfInvalidCode: cart.discount_codes:', codes);
        var match = null;
        for (var i = 0; i < codes.length; i++) {
          if (codes[i].code && codes[i].code.toUpperCase() === code.toUpperCase()) {
            match = codes[i];
            break;
          }
        }
        if (match) {
          console.log('[CMX Recovery] triggerIfInvalidCode: matched discount entry:', match);
          if (match.applicable === false) {
            console.log('[CMX Recovery] triggerIfInvalidCode: code is NOT applicable, firing callApi');
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
          } else {
            console.log('[CMX Recovery] triggerIfInvalidCode: code IS applicable (valid discount) — no recovery needed');
          }
        } else {
          console.log('[CMX Recovery] triggerIfInvalidCode: code not found in cart.discount_codes');
        }
      })
      .catch(function(err) {
        console.warn('[CMX Recovery] triggerIfInvalidCode: /cart.js fetch failed', err);
      });
  }

  // ── MutationObserver fallback ──────────────────────────────────────────────

  function handleMutation() {
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

    console.log('[CMX Recovery] observer triggered, container:', el, 'text:', t, 'isFailureText:', isFailureText, 'isAppliedText:', isAppliedText);

    var input = findInput();
    var code = input ? input.value.trim() : _lastInputValue;
    // If DOM shows "Code applied: X", extract the code from the text if input is empty
    if (!code && isAppliedText) {
      var m = t.match(/(?:code applied|applied)[:\s]+([A-Z0-9_\-]+)/i);
      if (m) code = m[1];
      console.log('[CMX Recovery] observer: extracted code from text:', code);
    }
    if (!code) {
      console.log('[CMX Recovery] observer: no code found in input or text, skipping');
      return;
    }
    if (_recoveryCodes[code.toUpperCase()]) {
      console.log('[CMX Recovery] observer: code already recovered, skipping:', code);
      return;
    }

    console.log('[CMX Recovery] observer: processing code', code);

    var sid = sessionStorage.getItem('_cmx_sid') || ('cart_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9));

    if (isAppliedText && !isFailureText) {
      // "Code applied" — need to verify it's actually not giving a discount
      triggerIfInvalidCode(code, sid);
    } else {
      callApi({ code: code, failureReason: 'unknown', cartValue: 0, lineItems: [], sessionId: sid, attemptsThisSession: 1 });
    }
  }

  function watchErrors() {
    console.log('[CMX Recovery] watchErrors: setting up MutationObserver');
    _observer = new MutationObserver(function () {
      // Debounce: wait 150ms after last mutation before processing
      // Prevents storm of calls during Shopify's morph.js DOM updates
      if (_debounceTimer) clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(handleMutation, 150);
    });
    _observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    console.log('[CMX Recovery] watchErrors: MutationObserver active');

    document.addEventListener('change', function (e) {
      var input = findInput();
      if (input && e.target === input) _lastInputValue = input.value.trim();
    }, true);
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  window.addEventListener('cmx:coupon_failed', function (e) {
    console.log('[CMX Recovery] cmx:coupon_failed event received:', e.detail);
    callApi(e.detail);
  });

  if (document.readyState === 'loading') {
    console.log('[CMX Recovery] DOMContentLoaded not yet fired, waiting');
    document.addEventListener('DOMContentLoaded', watchErrors);
  } else {
    watchErrors();
  }

})();
