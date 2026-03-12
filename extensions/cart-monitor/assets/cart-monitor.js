/**
 * CheckoutMaxx Cart Monitor — Phase 1 Discovery
 *
 * Intercepts all cart-related network activity on the Shopify storefront.
 * Runs on every page (cart page, product pages, collection pages) because
 * cart drawers can open anywhere.
 *
 * Phase 1: logs to console + beacons to /api/cart/log for inspection.
 * Phase 2 will replace the beacon target with the real ingest endpoint.
 */

(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────
  var script = document.currentScript ||
    document.querySelector('script[data-shop]');

  var CONFIG = {
    shopDomain: script && script.dataset && script.dataset.shop
      ? script.dataset.shop
      : window.location.hostname,
    logUrl: script && script.dataset && script.dataset.logUrl
      ? script.dataset.logUrl
      : null,
    debug: true,
  };

  // ── Session ID ────────────────────────────────────────────────────────
  function getSessionId() {
    var id = sessionStorage.getItem('_cmx_sid');
    if (!id) {
      id = 'cart_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
      sessionStorage.setItem('_cmx_sid', id);
    }
    return id;
  }

  // ── Cart Token ────────────────────────────────────────────────────────
  var cartToken = null;

  function extractCartToken(responseData) {
    if (responseData && responseData.token) {
      cartToken = responseData.token;
    }
  }

  // ── Event Builder ─────────────────────────────────────────────────────
  function buildEvent(type, payload) {
    return {
      eventType: type,
      shopDomain: CONFIG.shopDomain,
      sessionId: getSessionId(),
      cartToken: cartToken,
      occurredAt: new Date().toISOString(),
      url: window.location.href,
      payload: payload,
    };
  }

  // ── Logger ────────────────────────────────────────────────────────────
  function logEvent(event) {
    if (CONFIG.debug) {
      console.group('[CheckoutMaxx Cart]', event.eventType);
      console.log('Session:', event.sessionId);
      console.log('Cart token:', event.cartToken);
      console.log('Payload:', event.payload);
      console.groupEnd();
    }

    if (CONFIG.logUrl) {
      navigator.sendBeacon(CONFIG.logUrl, JSON.stringify(event));
    }
  }

  // ── Payload Parsers ───────────────────────────────────────────────────
  function parseRequestBody(body) {
    if (!body) return null;

    try {
      return { format: 'json', data: JSON.parse(body) };
    } catch (e) {}

    try {
      var params = new URLSearchParams(body);
      var obj = {};
      params.forEach(function(v, k) { obj[k] = v; });
      return { format: 'form', data: obj };
    } catch (e) {}

    return { format: 'raw', data: String(body) };
  }

  // ── Cart Event Classifier ─────────────────────────────────────────────
  function classifyCartEvent(url, requestBody, responseData, status) {
    var path;
    try {
      path = new URL(url, window.location.origin).pathname;
    } catch (e) {
      path = url;
    }
    var req = parseRequestBody(requestBody);

    // ── Item Added ──────────────────────────────────────────────────────
    if (path.indexOf('/cart/add') !== -1) {
      // Dawn single-add returns the item directly {product_id, ...}
      // Multi-add returns {items: [...]}
      // Both formats need to be handled
      var rawItems = responseData
        ? (responseData.items
            ? responseData.items
            : (responseData.product_id ? [responseData] : []))
        : [];

      // For single-add, cartValue/itemCount aren't in the response —
      // read from the global cart state fetched at init
      return {
        type: 'cart_item_added',
        data: {
          success: status >= 200 && status < 300,
          itemsAdded: rawItems.map(function(i) {
            return {
              productId: i.product_id,
              variantId: i.variant_id,
              productTitle: i.product_title,
              variantTitle: i.variant_title,
              price: i.price,
              quantity: i.quantity,
              sku: i.sku,
            };
          }),
          // These are present on multi-add response, absent on single-add
          cartValue: responseData && responseData.total_price != null ? responseData.total_price : null,
          cartItemCount: responseData && responseData.item_count != null ? responseData.item_count : null,
          cartToken: responseData && responseData.token ? responseData.token : cartToken,
          errorMessage: status >= 400 ? (responseData && responseData.description) : null,
        },
      };
    }

    // ── Item Removed / Quantity Changed ─────────────────────────────────
    if (path.indexOf('/cart/change') !== -1) {
      var qty = (req && req.data && req.data.quantity !== undefined)
        ? parseInt(req.data.quantity, 10)
        : null;
      return {
        type: qty === 0 ? 'cart_item_removed' : 'cart_item_changed',
        data: {
          // Dawn sends line (1-based index) or key, not id/variant_id directly
          variantId: req && req.data && (req.data.id || req.data.variant_id || null),
          lineIndex: req && req.data && req.data.line ? parseInt(req.data.line, 10) : null,
          lineKey: req && req.data && req.data.key,
          newQuantity: qty,
          cartValue: responseData && responseData.total_price,
          cartItemCount: responseData && responseData.item_count,
          cartToken: responseData && responseData.token,
          lineItems: ((responseData && responseData.items) || []).map(function(i) {
            return {
              productId: i.product_id,
              variantId: i.variant_id,
              productTitle: i.product_title,
              price: i.price,
              quantity: i.quantity,
            };
          }),
        },
      };
    }

    // ── Bulk Update ──────────────────────────────────────────────────────
    if (path.indexOf('/cart/update') !== -1) {
      return {
        type: 'cart_bulk_updated',
        data: {
          cartValue: responseData && responseData.total_price,
          cartItemCount: responseData && responseData.item_count,
          cartToken: responseData && responseData.token,
          updates: req && req.data && (req.data.updates || req.data),
        },
      };
    }

    // ── Cart Cleared ─────────────────────────────────────────────────────
    if (path.indexOf('/cart/clear') !== -1) {
      return {
        type: 'cart_cleared',
        data: { cartToken: responseData && responseData.token },
      };
    }

    // ── Discount Applied / Failed ────────────────────────────────────────
    if (
      path.indexOf('/discount/apply') !== -1 ||
      path.indexOf('/discount/remove') !== -1 ||
      path.indexOf('/cart/apply_coupon') !== -1 ||
      path.indexOf('/discount') !== -1
    ) {
      var code =
        (req && req.data && (req.data.discount || req.data.code || req.data.coupon)) ||
        (path.split('/discount/')[1] || '').split('?')[0] ||
        null;

      var success = status >= 200 && status < 300 &&
        !(responseData && (responseData.error || responseData.errors));

      var errorRaw =
        (responseData && (responseData.error || responseData.errors || responseData.message)) ||
        null;

      var failureReason = null;
      if (!success && errorRaw) {
        var msg = String(errorRaw).toLowerCase();
        if (msg.indexOf('expired') !== -1 || msg.indexOf('no longer valid') !== -1) {
          failureReason = 'expired';
        } else if (msg.indexOf('minimum') !== -1 || msg.indexOf('subtotal') !== -1) {
          failureReason = 'minimum_not_met';
        } else if (msg.indexOf('not applicable') !== -1 || msg.indexOf('not eligible') !== -1) {
          failureReason = 'product_ineligible';
        } else if (msg.indexOf('usage') !== -1 || msg.indexOf('limit') !== -1 || msg.indexOf('already been used') !== -1) {
          failureReason = 'usage_limit_reached';
        } else if (msg.indexOf('not found') !== -1 || msg.indexOf('invalid') !== -1 || msg.indexOf('does not exist') !== -1) {
          failureReason = 'invalid_code';
        } else if (msg.indexOf('customer') !== -1 || msg.indexOf('once per') !== -1) {
          failureReason = 'customer_usage_limit';
        } else {
          failureReason = 'unknown';
        }
      }

      return {
        type: success ? 'cart_coupon_applied' : 'cart_coupon_failed',
        data: {
          code: code,
          success: success,
          failureReason: failureReason,
          errorRaw: errorRaw,
          statusCode: status,
          cartValue: responseData && responseData.total_price,
          cartValueAfterDiscount: (responseData && responseData.total_discounts)
            ? responseData.total_price - responseData.total_discounts
            : null,
          discountAmount: responseData && responseData.total_discounts,
          cartItemCount: responseData && responseData.item_count,
          lineItems: ((responseData && responseData.items) || []).map(function(i) {
            return {
              productId: i.product_id,
              variantId: i.variant_id,
              productTitle: i.product_title,
              price: i.price,
              quantity: i.quantity,
            };
          }),
          rawResponse: responseData,
        },
      };
    }

    // ── Cart Fetched ─────────────────────────────────────────────────────
    if (path.indexOf('/cart.js') !== -1 || path === '/cart') {
      return {
        type: 'cart_fetched',
        data: {
          cartToken: responseData && responseData.token,
          cartValue: responseData && responseData.total_price,
          cartItemCount: responseData && responseData.item_count,
          hasDiscount: !!(responseData && responseData.cart_level_discount_applications && responseData.cart_level_discount_applications.length),
          appliedDiscounts: (responseData && responseData.cart_level_discount_applications) || [],
        },
      };
    }

    // ── Unknown cart endpoint ────────────────────────────────────────────
    return {
      type: 'cart_unknown_endpoint',
      data: { path: path, status: status, requestBody: req, responseData: responseData },
    };
  }

  // ── Fetch Interceptor ─────────────────────────────────────────────────
  var _originalFetch = window.fetch;

  window.fetch = function (input, init) {
    var url = typeof input === 'string'
      ? input
      : (input instanceof Request ? input.url : String(input));

    var isCartEndpoint =
      url.indexOf('/cart/') !== -1 ||
      url.indexOf('/cart.js') !== -1 ||
      url.indexOf('/discount/') !== -1 ||
      url.indexOf('/discount') !== -1;

    if (!isCartEndpoint) {
      return _originalFetch(input, init);
    }

    var requestBody = (init && init.body && typeof init.body === 'string')
      ? init.body
      : null;

    return _originalFetch(input, init).then(function(response) {
      var clone = response.clone();
      clone.json().then(function(responseData) {
        extractCartToken(responseData);
        var classified = classifyCartEvent(url, requestBody, responseData, response.status);
        logEvent(buildEvent(classified.type, classified.data));
      }).catch(function() {
        logEvent(buildEvent('cart_non_json_response', { url: url, status: response.status }));
      });
      return response;
    }, function(err) {
      logEvent(buildEvent('cart_fetch_error', { url: url, error: err.message }));
      throw err;
    });
  };

  // ── XHR Interceptor ───────────────────────────────────────────────────
  var _originalOpen = XMLHttpRequest.prototype.open;
  var _originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._cmx_url = url;
    this._cmx_method = method;
    return _originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    var self = this;
    var url = this._cmx_url || '';
    var isCartEndpoint =
      url.indexOf('/cart/') !== -1 ||
      url.indexOf('/cart.js') !== -1 ||
      url.indexOf('/discount/') !== -1 ||
      url.indexOf('/discount') !== -1;

    if (isCartEndpoint) {
      this._cmx_requestBody = body;

      this.addEventListener('load', function() {
        try {
          var responseData = JSON.parse(self.responseText);
          extractCartToken(responseData);
          var classified = classifyCartEvent(url, self._cmx_requestBody, responseData, self.status);
          logEvent(buildEvent(classified.type, classified.data));
        } catch (e) {
          logEvent(buildEvent('cart_xhr_parse_error', { url: url, status: self.status }));
        }
      });

      this.addEventListener('error', function() {
        logEvent(buildEvent('cart_xhr_error', { url: url }));
      });
    }

    return _originalSend.apply(this, arguments);
  };

  // ── Checkout Navigation Capture ───────────────────────────────────────
  document.addEventListener('click', function (e) {
    var target = e.target.closest('a, button');
    if (!target) return;

    var href = target.href || '';
    var isCheckoutLink =
      href.indexOf('/checkout') !== -1 ||
      target.getAttribute('name') === 'checkout' ||
      target.getAttribute('data-checkout') !== null ||
      target.getAttribute('data-cart-checkout') !== null ||
      // Dawn: submit button inside a cart form — but only if it's a submit type
      // (quantity +/- are type="button", checkout is type="submit" with name="checkout")
      (target.tagName === 'BUTTON' && target.type === 'submit' &&
        target.form && target.form.action && target.form.action.indexOf('/cart') !== -1 &&
        (target.name === 'checkout' || target.getAttribute('aria-label') === 'checkout'));

    if (isCheckoutLink) {
      logEvent(buildEvent('cart_checkout_clicked', {
        cartToken: cartToken,
        cartValue: null,
        triggerElement: target.tagName,
        triggerText: target.innerText ? target.innerText.trim().slice(0, 50) : null,
      }));
    }
  });

  // ── Page Visibility — Cart Abandonment Signal ─────────────────────────
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && cartToken) {
      logEvent(buildEvent('cart_page_hidden', { cartToken: cartToken }));
    }
  });

  // ── Init ──────────────────────────────────────────────────────────────
  fetch('/cart.js')
    .then(function(r) { return r.json(); })
    .then(function(cart) {
      if (cart && cart.token) {
        cartToken = cart.token;
        if (CONFIG.debug) {
          console.log('[CheckoutMaxx Cart] Initialised. Cart token:', cartToken);
        }
      }
    })
    .catch(function() {});

})();
