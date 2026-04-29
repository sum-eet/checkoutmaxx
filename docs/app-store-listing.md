# CouponMaxx — App Store Listing Content

## App name
CouponMaxx — Coupon Analytics

---

## Introduction (91/100 chars)
Track every coupon attempt, understand cart behavior, and recover lost discounts at checkout.

---

## App details (~490/500 chars)
CouponMaxx gives merchants full visibility into how discounts perform — not just successful redemptions, but every failed attempt and abandoned cart.

The Sessions tab shows every cart visit: products added, coupon codes tried, whether the customer reached checkout or left.

The Discounts tab shows aggregate stats: coupons tried today, failure rates by code, and cart values at failure.

The Checkout Recovery extension lets you configure a discount code that appears in checkout, giving shoppers one click to claim it.

---

## Features (5)

1. Session-level tracking — see every cart visit and coupon attempts (65/80)
2. Coupon failure analytics — know which discount codes are failing and why (73/80)
3. Live KPI dashboard — claims, cart views, and checkout starts at a glance (73/80)
4. Checkout recovery prompts — configure a discount code that appears in checkout (77/80)
5. Works entirely inside Shopify admin — no external dashboards or logins needed (77/80)

---

## App card subtitle (56/62 chars)
Track coupon failures & recover lost revenue at checkout

---

## Search terms
- Coupon Tracking
- Cart Analytics
- Discount Recovery
- Checkout Optimization
- Abandoned Cart

---

## Pricing — Free plan
Display name: Free
Top features:
1. Session-level cart and coupon tracking
2. Coupon failure analytics and KPI dashboard
3. Checkout recovery prompts
4. No usage limits during beta

---

## Image alt texts

Screenshot 1: See every cart session — device, products, coupon attempts, and order status
Screenshot 2: Full session timeline — every event from browse to checkout
Screenshot 3: Coupon KPIs and per-attempt failure detail at a glance
Screenshot 4: Checkout recovery prompt — one-click discount claim at checkout

Feature media alt text: Find which coupons are failing and recover lost revenue

---

## Testing instructions
Install the app on a development store. The app automatically installs a cart monitoring pixel.

Test store login:
  URL: 20aprtest.myshopify.com/admin
  Email: sameersheth152@gmail.com
  Password: testingaccount101
  (Staff account with admin access — no two-factor authentication)

After install:
1. Open the app — Sessions tab loads automatically
2. Visit the storefront and browse products, add items to cart
3. In the cart, enter a discount code (valid or invalid — any code works to generate data)
4. Return to the app — cart session appears in Sessions within 1-2 minutes
5. Open the session to see the full timeline: cart events, coupon attempts, checkout status
6. Switch to the Discounts tab to see KPI cards and per-code failure stats

Checkout Recovery extension (optional test):
The app includes a checkout UI extension "CouponMaxx Checkout Recovery". This is a merchant-configured feature — not an advertisement. To test it:
1. In Shopify admin, go to Settings > Checkout > Customize
2. Find the CouponMaxx Checkout Recovery block
3. Configure a discount code (must be an active code in your store)
4. Open checkout with items in cart — the "Looking for a discount?" prompt appears
5. Click "Claim" to apply the configured code

The extension is merchant-controlled and applies a discount the merchant has explicitly configured. No external accounts required.

---

## Support
- Support email: sk200435@gmail.com
- Privacy policy: https://couponmaxx.vercel.app/privacy

---

## Before submitting — checklist
- [x] Test store: 20aprtest.myshopify.com
- [x] Staff credentials filled in
- [ ] Verify CouponMaxx is installed on 20aprtest store
- [ ] Browse storefront + apply a coupon code so reviewer sees data immediately
- [ ] Confirm LUCKYCHECKOUT100 (or another active code) is configured in Checkout Recovery extension settings
