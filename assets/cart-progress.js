(() => {
  const SELECTORS = {
    root: '[data-cart-progress]',
    message: '[data-cart-progress-message]',
    fill: '[data-cart-progress-fill]',
    dot: (index) => `[data-cart-progress-dot="${index}"]`,
    label: (index) => `[data-cart-progress-label="${index}"]`,
  };

  const state = {
    initialized: false,
    busyGift: false,
    observer: null,
    renderQueued: false,
  };

  function parseIntegerList(value) {
    return (value || '')
      .split(',')
      .map((v) => parseInt(v.trim(), 10))
      .filter((v) => Number.isFinite(v));
  }

  function readConfig(root) {
    const thresholds = parseIntegerList(root.getAttribute('data-thresholds'));
    const maxThreshold = parseInt(root.getAttribute('data-max-threshold'), 10);
    const giftVariantId = parseInt(root.getAttribute('data-gift-variant-id'), 10);

    return {
      thresholds: thresholds.length ? thresholds : [10000, 15000, 20000],
      maxThreshold: Number.isFinite(maxThreshold) ? maxThreshold : 20000,
      giftVariantId: Number.isFinite(giftVariantId) && giftVariantId > 0 ? giftVariantId : null,
    };
  }

  function getLocale() {
    return document.documentElement.lang || navigator.language || 'en';
  }

  function formatMoney(cents, currency) {
    const safeCents = Number.isFinite(cents) ? cents : 0;
    const safeCurrency = currency || 'USD';
    const amount = safeCents / 100;
    return new Intl.NumberFormat(getLocale(), {
      style: 'currency',
      currency: safeCurrency,
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(amount);
  }

  async function fetchCart() {
    const response = await fetch('/cart.js', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Failed to fetch cart');
    return response.json();
  }

  function getGiftLinePrice(cart, giftVariantId) {
    if (!giftVariantId || !cart?.items?.length) return 0;
    return cart.items
      .filter((item) => item.variant_id === giftVariantId)
      .reduce((sum, item) => sum + (item.final_line_price || 0), 0);
  }

  function computeView(cart, config) {
    const currency = cart?.currency || cart?.presentment_currency || 'USD';
    const giftLinePrice = getGiftLinePrice(cart, config.giftVariantId);
    const totalCentsRaw = cart?.total_price || 0;
    const totalCentsForThresholds = Math.max(0, totalCentsRaw - giftLinePrice);

    const progressRatio = Math.max(0, Math.min(1, totalCentsForThresholds / config.maxThreshold));
    const fillPercent = progressRatio * 100;

    const [t1, t2, t3] = config.thresholds;

    const unlocked = [
      totalCentsForThresholds >= t1,
      totalCentsForThresholds >= t2,
      totalCentsForThresholds >= t3,
    ];

    let message = '';
    if (totalCentsForThresholds < t1) {
      message = `Spend ${formatMoney(t1 - totalCentsForThresholds, currency)} more to unlock free shipping.`;
    } else if (totalCentsForThresholds < t2) {
      message = `Free shipping unlocked! Spend ${formatMoney(t2 - totalCentsForThresholds, currency)} more for 20% off.`;
    } else if (totalCentsForThresholds < t3) {
      message = `Free shipping + 20% off unlocked! Spend ${formatMoney(t3 - totalCentsForThresholds, currency)} more for a free gift.`;
    } else {
      message = 'All rewards unlocked! Free shipping, 20% off, and your free gift.';
    }

    const hasGiftInCart = !!config.giftVariantId && cart.items?.some((i) => i.variant_id === config.giftVariantId);

    return {
      currency,
      totalCentsForThresholds,
      fillPercent,
      unlocked,
      message,
      shouldHaveGift: !!config.giftVariantId && totalCentsForThresholds >= t3,
      hasGiftInCart,
    };
  }

  function updateDom(root, view, config) {
    const messageEl = root.querySelector(SELECTORS.message);
    if (messageEl) messageEl.textContent = view.message;

    const fillEl = root.querySelector(SELECTORS.fill);
    if (fillEl) fillEl.style.width = `${view.fillPercent}%`;

    const trackEl = root.querySelector('.cart-progress__track');
    if (trackEl) trackEl.setAttribute('aria-valuenow', String(view.totalCentsForThresholds));
    if (trackEl) trackEl.setAttribute('aria-valuemax', String(config.maxThreshold));

    for (let i = 0; i < 3; i += 1) {
      const dot = root.querySelector(SELECTORS.dot(i));
      const label = root.querySelector(SELECTORS.label(i));
      if (dot) dot.classList.toggle('is-active', !!view.unlocked[i]);
      if (label) label.classList.toggle('is-active', !!view.unlocked[i]);
    }
  }

  async function addGift(variantId) {
    const body = JSON.stringify({
      items: [
        {
          id: variantId,
          quantity: 1,
          properties: {
            _auto_gift: 'true',
          },
        },
      ],
    });

    const response = await fetch(window?.routes?.cart_add_url || '/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    });
    if (!response.ok) throw new Error('Failed to add gift');
    return response.json();
  }

  async function removeGift(cart, variantId) {
    const giftLineIndexes = (cart.items || [])
      .map((item, index) => ({ item, line: index + 1 }))
      .filter(({ item }) => item.variant_id === variantId)
      .map(({ line }) => line);

    for (const line of giftLineIndexes) {
      const body = JSON.stringify({ line, quantity: 0 });
      const response = await fetch(window?.routes?.cart_change_url || '/cart/change.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
      });
      if (!response.ok) throw new Error('Failed to remove gift');
      await response.json();
    }
  }

  async function syncGift(view, config) {
    if (!config.giftVariantId) return;
    if (state.busyGift) return;

    if (view.shouldHaveGift && !view.hasGiftInCart) {
      state.busyGift = true;
      try {
        await addGift(config.giftVariantId);
        if (typeof publish === 'function' && typeof PUB_SUB_EVENTS !== 'undefined' && PUB_SUB_EVENTS?.cartUpdate) {
          publish(PUB_SUB_EVENTS.cartUpdate, { source: 'cart-progress' });
        }
      } finally {
        state.busyGift = false;
      }
    }

    if (!view.shouldHaveGift && view.hasGiftInCart) {
      state.busyGift = true;
      try {
        const cart = await fetchCart();
        await removeGift(cart, config.giftVariantId);
        if (typeof publish === 'function' && typeof PUB_SUB_EVENTS !== 'undefined' && PUB_SUB_EVENTS?.cartUpdate) {
          publish(PUB_SUB_EVENTS.cartUpdate, { source: 'cart-progress' });
        }
      } finally {
        state.busyGift = false;
      }
    }
  }

  async function render() {
    const root = document.querySelector(SELECTORS.root);
    if (!root) return false;

    const config = readConfig(root);
    const cart = await fetchCart();
    const view = computeView(cart, config);
    updateDom(root, view, config);
    await syncGift(view, config);
    return true;
  }

  function queueRender() {
    if (state.renderQueued) return;
    state.renderQueued = true;

    const run = async () => {
      try {
        const didRender = await render();
        if (!didRender) {
          setTimeout(async () => {
            try {
              await render();
            } catch (e) {
              void e;
            }
          }, 250);
        }
      } catch (e) {
        void e;
      } finally {
        state.renderQueued = false;
      }
    };

    requestAnimationFrame(run);
  }

  function attachListeners() {
    document.addEventListener('cart:updated', () => queueRender());

    if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined' && PUB_SUB_EVENTS?.cartUpdate) {
      subscribe(PUB_SUB_EVENTS.cartUpdate, (event) => {
        if (event?.source === 'cart-progress') return;
        queueRender();
      });
    }
  }

  function observeCartDrawer() {
    if (state.observer) return;
    const target = document.querySelector('cart-drawer') || document.body;
    if (!target) return;

    state.observer = new MutationObserver(() => {
      if (document.querySelector(SELECTORS.root)) queueRender();
    });

    state.observer.observe(target, { childList: true, subtree: true });
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    attachListeners();
    observeCartDrawer();
    queueRender();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.CartProgress = {
    render: queueRender,
  };
})();
