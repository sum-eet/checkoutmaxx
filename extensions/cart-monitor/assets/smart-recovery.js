/**
 * CouponMaxx Smart Recovery — storefront script
 *
 * Listens for the 'cmx:coupon_failed' custom event dispatched by cart-monitor.js.
 * Calls the recovery decision API, then injects an inline recovery message
 * into the coupon error area — replacing Shopify's generic "Enter a valid
 * discount code" message with a contextual, actionable response.
 *
 * No modals. No toasts. No pop-ups.
 */

(function () {
  'use strict';

  var script = document.currentScript ||
    document.querySelector('script[data-recovery-url]');

  var CONFIG = {
    shopDomain: script && script.dataset.shop
      ? script.dataset.shop
      : window.location.hostname,
    recoveryUrl: script && script.dataset.recoveryUrl
      ? script.dataset.recoveryUrl
      : 'https://couponmaxx.vercel.app/api/couponmaxx/recovery/decide',
  };

  // ── Selectors for Shopify coupon error elements ───────────────────────────
  // We try these in order; first match wins. Covers Dawn, Debut, Sense, Craft,
  // and most paid themes. The container receives our recovery message markup.

  var ERROR_SELECTORS = [
    // Dawn 9+ (2024)
    '[data-cart-discount-errors]',
    '.cart-discount__error',
    // Debut / older
    '#CartDiscountCode-CartDrawer ~ .field__message--error',
    '#CartDiscountCode ~ .field__message--error',
    // Generic field error
    '[id*="DiscountCode"] + .field__message--error',
    '[id*="discount"] + .field__message--error',
    // Broad fallback: any error near a discount input
    '.discount-field ~ p.error',
    '.discount__message--error',
    '[data-discount-error]',
  ];

  var FORM_SELECTORS = [
    'form[data-cart-discount-form]',
    'form[action*="discount"]',
    '#cart-discount-form',
    '.cart-discount form',
  ];

  var INPUT_SELECTORS = [
    '#CartDiscountCode-CartDrawer',
    '#CartDiscountCode',
    '[name="discount"]',
    '[data-discount-input]',
    '[id*="DiscountCode"]',
  ];

  // ── DOM helpers ───────────────────────────────────────────────────────────

  function findFirst(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) return el;
    }
    return null;
  }

  function findDiscountInput() {
    return findFirst(INPUT_SELECTORS);
  }

  function findOrCreateErrorContainer() {
    // Try to find the existing Shopify error element
    var existing = findFirst(ERROR_SELECTORS);
    if (existing) return existing;

    // Fallback: inject a container right after the discount input or form
    var anchor = findDiscountInput() || findFirst(FORM_SELECTORS);
    if (!anchor) return null;

    var container = document.createElement('p');
    container.className = 'cmx-recovery-message';
    container.id = 'cmx-recovery-container';
    var parent = anchor.closest('form') || anchor.parentElement;
    if (parent) {
      parent.appendChild(container);
    }
    return container;
  }

  // ── Recovery message renderer ─────────────────────────────────────────────

  function renderRecovery(response) {
    if (response.action === 'show_nothing' || !response.action) return;

    var container = findOrCreateErrorContainer();
    if (!container) return;

    // Clear the Shopify default error text
    container.innerHTML = '';
    container.classList.add('cmx-recovery-active');

    // Line 1: failure explanation
    if (response.line1) {
      var line1 = document.createElement('span');
      line1.className = 'cmx-recovery-line1';
      line1.textContent = response.line1;
      container.appendChild(line1);
    }

    // Line 2: recovery action
    if (response.line2 && response.action !== 'show_nothing') {
      var br = document.createElement('br');
      container.appendChild(br);

      if (response.action === 'show_code' && response.code) {
        var line2 = document.createElement('span');
        line2.className = 'cmx-recovery-line2';
        line2.textContent = response.line2 + ' ';
        container.appendChild(line2);

        // Code pill (tap-to-apply)
        var pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'cmx-code-pill';
        pill.textContent = response.code;
        pill.setAttribute('data-recovery-code', response.code);
        pill.setAttribute('data-recovery-id', response.recoveryId || '');
        pill.addEventListener('click', function () { applyCode(response.code, pill); });
        container.appendChild(pill);

        // Line 3: terms + countdown
        if (response.discountLabel || response.expiresInMinutes) {
          var br2 = document.createElement('br');
          container.appendChild(br2);

          var terms = document.createElement('span');
          terms.className = 'cmx-recovery-terms';
          var termsText = response.discountLabel || '';
          if (response.expiresInMinutes) {
            termsText += (termsText ? ' \u00b7 ' : '') + 'expires in ';
            var span = document.createElement('span');
            span.id = 'cmx-countdown-' + Date.now();
            span.textContent = response.expiresInMinutes + ' min';
            terms.textContent = termsText;
            terms.appendChild(span);
            startCountdown(span, response.expiresInMinutes * 60, container);
          } else {
            terms.textContent = termsText;
          }
          container.appendChild(terms);
        }

      } else {
        // show_hint or show_upsell
        var line2hint = document.createElement('span');
        line2hint.className = 'cmx-recovery-line2';
        line2hint.textContent = response.line2;
        container.appendChild(line2hint);

        if (response.productSuggestion) {
          var br3 = document.createElement('br');
          container.appendChild(br3);
          var link = document.createElement('a');
          link.className = 'cmx-product-link';
          link.href = response.productSuggestion.url;
          var price = (response.productSuggestion.price / 100).toFixed(2);
          link.textContent = response.productSuggestion.title + ' ($' + price + ')';
          container.appendChild(link);
        }
      }
    }

    // Fade in
    container.style.opacity = '0';
    requestAnimationFrame(function () {
      container.style.transition = 'opacity 300ms ease';
      container.style.opacity = '1';
    });
  }

  // ── Auto-apply code to cart ───────────────────────────────────────────────

  function applyCode(code, pill) {
    if (!code) return;

    // Fill the discount input and submit the form, or use the Shopify JS API
    var input = findDiscountInput();
    if (input) {
      input.value = code;

      // Try submitting via the discount form
      var form = input.closest('form');
      if (form) {
        var submitBtn = form.querySelector('[type="submit"]');
        if (submitBtn) {
          pill.textContent = 'Applying\u2026';
          pill.disabled = true;
          submitBtn.click();
          return;
        }
      }
    }

    // Fallback: apply via /cart/update.js
    pill.textContent = 'Applying\u2026';
    pill.disabled = true;

    fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discount: code }),
    })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        var applied = (cart.cart_level_discount_applications || [])
          .some(function (d) { return d.title === code; });
        if (applied) {
          pill.textContent = '\u2713 Applied';
          pill.classList.add('cmx-code-pill--applied');
        } else {
          pill.textContent = code;
          pill.disabled = false;
        }
      })
      .catch(function () {
        pill.textContent = code;
        pill.disabled = false;
      });
  }

  // ── Countdown timer ───────────────────────────────────────────────────────

  function startCountdown(el, totalSeconds, container) {
    var remaining = totalSeconds;

    var interval = setInterval(function () {
      remaining--;
      if (remaining <= 0) {
        clearInterval(interval);
        if (container && container.parentNode) {
          container.classList.add('cmx-recovery-expired');
        }
        el.textContent = '0 min';
        return;
      }
      var mins = Math.floor(remaining / 60);
      var secs = remaining % 60;
      el.textContent = mins > 0
        ? mins + ' min'
        : secs + ' sec';
    }, 1000);
  }

  // ── Recovery API call ─────────────────────────────────────────────────────

  function callRecoveryApi(detail) {
    var payload = {
      shopId: CONFIG.shopDomain,
      sessionId: detail.sessionId,
      failedCode: detail.code || '',
      failureReason: mapFailureReason(detail.failureReason),
      cartValue: detail.cartValue || 0,
      cartItems: (detail.lineItems || []).map(function (item) {
        return {
          productTitle: item.productTitle || '',
          collectionIds: item.collectionIds || [],
          price: item.price || 0,
          quantity: item.quantity || 1,
        };
      }),
      customerName: getCustomerName(),
      attemptsThisSession: detail.attemptsThisSession || 1,
      device: /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
      source: getUtmSource(),
    };

    fetch(CONFIG.recoveryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .then(function (response) {
        renderRecovery(response);
      })
      .catch(function (err) {
        console.warn('[CouponMaxx Smart Recovery] API error:', err);
      });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function mapFailureReason(reason) {
    var map = {
      'unknown':             'invalid',
      'invalid_code':        'invalid',
      'expired':             'expired',
      'minimum_not_met':     'min_not_met',
      'usage_limit_reached': 'usage_limit',
      'customer_usage_limit':'already_used',
      'product_ineligible':  'wrong_collection',
    };
    return map[reason] || 'invalid';
  }

  function getCustomerName() {
    // Shopify exposes customer info via window.ShopifyAnalytics or meta tags
    if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta &&
        window.ShopifyAnalytics.meta.page && window.ShopifyAnalytics.meta.page.customerId) {
      // We have a customer ID but not the name here — name comes from the event detail
      return null;
    }
    return null;
  }

  function getUtmSource() {
    try {
      var stored = sessionStorage.getItem('_cmx_utm');
      if (stored) return JSON.parse(stored).source || null;
    } catch (e) {}
    return new URLSearchParams(window.location.search).get('utm_source');
  }

  // ── MutationObserver fallback ─────────────────────────────────────────────
  // If cart-monitor isn't installed (or fires before smart-recovery loads),
  // we also watch the DOM for Shopify's native error message appearing and
  // replace it ourselves.

  var _lastSeenError = null;
  var _lastInputValue = '';

  function watchForNativeErrors() {
    var observer = new MutationObserver(function () {
      var errorEl = findFirst(ERROR_SELECTORS);
      if (!errorEl) return;

      var text = errorEl.textContent && errorEl.textContent.trim();
      if (!text || text === _lastSeenError) return;
      if (text === '' || errorEl.classList.contains('cmx-recovery-active')) return;

      // Only act on Shopify's generic coupon error strings
      var isShopifyError =
        text.toLowerCase().indexOf('valid discount') !== -1 ||
        text.toLowerCase().indexOf('discount code') !== -1 ||
        text.toLowerCase().indexOf('coupon') !== -1 ||
        text.toLowerCase().indexOf('promo') !== -1;

      if (!isShopifyError) return;

      _lastSeenError = text;

      // Read current input value
      var input = findDiscountInput();
      var code = input ? input.value.trim() : _lastInputValue;

      // Dispatch our own failure event so we don't have to duplicate API call logic
      var sid = sessionStorage.getItem('_cmx_sid') ||
        ('cart_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9));

      callRecoveryApi({
        code: code,
        failureReason: 'unknown',
        cartValue: 0,
        lineItems: [],
        sessionId: sid,
        attemptsThisSession: 1,
      });
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    // Track input value so fallback observer can read the last attempted code
    document.addEventListener('change', function (e) {
      var input = findDiscountInput();
      if (input && e.target === input) {
        _lastInputValue = input.value.trim();
      }
    }, true);
  }

  // ── Listen for cart-monitor events ───────────────────────────────────────

  window.addEventListener('cmx:coupon_failed', function (e) {
    callRecoveryApi(e.detail);
  });

  // Also start the DOM observer as a fallback
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchForNativeErrors);
  } else {
    watchForNativeErrors();
  }

})();
