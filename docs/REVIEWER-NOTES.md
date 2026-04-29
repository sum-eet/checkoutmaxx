# CouponMaxx — Reviewer Notes

**Reference:** Shopify App Review 107252
**App:** CouponMaxx — Coupon Analytics
**Pricing:** Free (no charges, no subscription)

## No login credentials required

CouponMaxx is a Shopify-embedded app and uses Shopify OAuth for authentication. No separate username/password is needed.

## Install + access

1. From the Partner Dashboard, choose **Test on development store** for CouponMaxx.
2. Pick (or create) a development store.
3. Approve the requested scopes: `read_orders`, `read_checkouts`, `write_pixels`, `read_customer_events`, `read_analytics`, `write_discounts`.
4. After install, the app opens at `/couponmaxx/sessions` inside the Shopify admin.

## How to test the core feature

1. In the dev store, open the storefront.
2. Add any product to the cart and proceed to checkout.
3. Apply (or attempt to apply) any discount code at checkout — for example a valid code, an invalid code, or one with minimum-spend rules.
4. Within ~30 seconds, return to the embedded app:
   - **Sessions** tab: the cart session appears with the events that occurred (cart viewed, discount applied/rejected, checkout started, etc.).
   - **Discounts** tab: aggregated KPIs for discount-code usage and rejection reasons.
   - **Diagnostics** tab: per-shop install/health checks.

## Extensions included

- **Web pixel** (`checkout-monitor`) — analytics-only, captures checkout events.
- **Theme app extension** (`cart-monitor`) — instruments the storefront cart for coupon-failure tracking.
- **Checkout UI extension** (`checkout-recovery`) — renders a customer-facing "Claim" button that applies a configurable discount code.

The app contains **no admin UI extensions, admin actions, or admin links**.

## Pricing

CouponMaxx is currently free. The embedded **Billing** route exists only to display a "free plan, no charges" notice; there is no purchase flow, plan selector, or upgrade button anywhere in the merchant UI.

## Contact

For any questions during review, reach out at **support@drwater.store**.
