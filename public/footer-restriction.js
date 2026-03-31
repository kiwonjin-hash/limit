<script>
(function () {
  const API_BASE = 'https://limit-em2e.onrender.com';

  function getIdentity() {
    return {
      memberHash: window.MEMBER_HASH || '',
      memberUid: window.MEMBER_UID || ''
    };
  }

  async function collectIdentity() {
    try {
      const identity = getIdentity();
      if (!identity.memberHash) return;

      await fetch(API_BASE + '/api/imweb/collect-identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(identity)
      });
    } catch (e) {
      console.error('collectIdentity error:', e);
    }
  }

  async function checkRestriction() {
    try {
      const identity = getIdentity();

      if (!identity.memberHash && !identity.memberUid) {
        return {
          blocked: false,
          warningOnly: false,
          blockPurchase: false,
          blockPickup: false
        };
      }

      const res = await fetch(API_BASE + '/api/imweb/check-restriction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(identity)
      });

      if (!res.ok) {
        return {
          blocked: false,
          warningOnly: false,
          blockPurchase: false,
          blockPickup: false
        };
      }

      return await res.json();
    } catch (e) {
      console.error('checkRestriction error:', e);
      return {
        blocked: false,
        warningOnly: false,
        blockPurchase: false,
        blockPickup: false
      };
    }
  }

  function blockPurchaseButton() {
    document.querySelectorAll('._btn_buy').forEach(el => {
      el.style.pointerEvents = 'none';
      el.style.opacity = '0.35';
      el.style.cursor = 'not-allowed';
      el.textContent = '구매 제한';
      el.removeAttribute('onclick');
      el.setAttribute('href', 'javascript:;');
    });
  }

  function blockCartOrderButton() {
    document.querySelectorAll('._btn_order, a[onclick*="SITE_SHOP_CART.OMS_addOrderWithCart"]').forEach(el => {
      el.style.pointerEvents = 'none';
      el.style.opacity = '0.35';
      el.style.cursor = 'not-allowed';
      el.textContent = '주문 제한';
      el.removeAttribute('onclick');
      el.setAttribute('href', 'javascript:;');
    });
  }

  function blockPaymentSubmitButton() {
    document.querySelectorAll('form[action*="/backpg/payment/oms/OMS_payment.cm"] button[type="submit"]').forEach(el => {
      el.style.pointerEvents = 'none';
      el.style.opacity = '0.35';
      el.style.cursor = 'not-allowed';
      el.textContent = '결제 제한';
      el.disabled = true;
    });
  }

  function ensureRestrictionStyles() {
    const styleId = 'restriction-notice-style';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .restriction-top-notice {
        position: sticky;
        top: 0;
        z-index: 9999;
        width: 100%;
        box-sizing: border-box;
        padding: 12px 16px;
        background: #111;
        color: #fff;
        border-bottom: 1px solid rgba(255,255,255,0.12);
        font-size: 14px;
        line-height: 1.45;
      }
      .restriction-top-notice strong {
        display: block;
        margin-bottom: 4px;
        font-size: 14px;
      }
      .restriction-top-notice.warning-only {
        background: #111;
        color: #fff;
        border-bottom: 1px solid rgba(255,255,255,0.12);
      }
      .restriction-modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.55);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        box-sizing: border-box;
      }
      .restriction-modal {
        width: min(100%, 420px);
        background: #171717;
        color: #fff;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 14px;
        padding: 20px;
        box-sizing: border-box;
        box-shadow: 0 18px 40px rgba(0,0,0,0.35);
      }
      .restriction-modal h3 {
        margin: 0 0 10px;
        font-size: 18px;
      }
      .restriction-modal p {
        margin: 0 0 14px;
        font-size: 14px;
        line-height: 1.55;
        color: #ddd;
      }
      .restriction-modal button {
        width: 100%;
        padding: 11px 14px;
        border: 0;
        border-radius: 10px;
        background: #2d2d2d;
        color: #fff;
        cursor: pointer;
        font-size: 14px;
      }
    `;
    document.head.appendChild(style);
  }

  function getRestrictionMessage(result) {
    const restrictedItems = [];

    if (result.blockPurchase) restrictedItems.push('주문 진행');
    if (result.blockPickup) restrictedItems.push('방문수령');

    const joined = restrictedItems.join(' 및 ');

    if (restrictedItems.length === 2) {
      return {
        title: '일부 서비스 이용 제한',
        body: `현재 해당 계정은 ${joined} 이용이 제한되어 있습니다. 자세한 사항은 고객센터로 문의해 주세요.`
      };
    }

    if (result.blockPurchase) {
      return {
        title: '주문 진행 제한',
        body: '현재 해당 계정은 주문 진행이 제한되어 있습니다. 자세한 사항은 고객센터로 문의해 주세요.'
      };
    }

    if (result.blockPickup) {
      return {
        title: '방문수령 이용 제한',
        body: '현재 해당 계정은 방문수령 이용이 제한되어 있으며 배송으로만 주문 가능합니다.'
      };
    }

    return {
      title: '이용 제한 안내',
      body: '현재 일부 서비스 이용이 제한되어 있습니다. 자세한 사항은 고객센터로 문의해 주세요.'
    };
  }

  function getWarningMessage(result) {
    return {
      title: '이용 안내',
      body: result.reason
        ? result.reason
        : '현재 계정에 안내 사항이 있습니다. 자세한 사항은 고객센터로 문의해 주세요.'
    };
  }

  // 실제 차단 상태: 상단 배너 + 팝업
  function showRestrictionNotice(result) {
    ensureRestrictionStyles();

    const message = getRestrictionMessage(result);

    let topNotice = document.getElementById('restriction-top-notice');
    if (!topNotice) {
      topNotice = document.createElement('div');
      topNotice.id = 'restriction-top-notice';
      topNotice.className = 'restriction-top-notice';
      document.body.prepend(topNotice);
    }
    topNotice.innerHTML = `<strong>${message.title}</strong><div>${message.body}</div>`;

    const popupKey = `restriction-popup-shown:${window.MEMBER_HASH || window.MEMBER_UID || 'guest'}`;
    if (sessionStorage.getItem(popupKey)) return;
    sessionStorage.setItem(popupKey, '1');

    const backdrop = document.createElement('div');
    backdrop.id = 'restriction-modal-backdrop';
    backdrop.className = 'restriction-modal-backdrop';
    backdrop.innerHTML = `
      <div class="restriction-modal" role="dialog" aria-modal="true" aria-labelledby="restriction-modal-title">
        <h3 id="restriction-modal-title">${message.title}</h3>
        <p>${message.body}</p>
        <button type="button" id="restriction-modal-close">확인</button>
      </div>
    `;

    const close = () => backdrop.remove();

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close();
    });

    document.body.appendChild(backdrop);
    const closeButton = document.getElementById('restriction-modal-close');
    if (closeButton) {
      closeButton.addEventListener('click', close);
    }
  }

  // 경고 전용 상태: 상단 배너만 (팝업/버튼 차단 없음)
  function showWarningOnlyNotice(result) {
    ensureRestrictionStyles();

    const message = getWarningMessage(result);

    let topNotice = document.getElementById('restriction-top-notice');
    if (!topNotice) {
      topNotice = document.createElement('div');
      topNotice.id = 'restriction-top-notice';
      topNotice.className = 'restriction-top-notice warning-only';
      document.body.prepend(topNotice);
    }
    topNotice.innerHTML = `<strong>${message.title}</strong><div>${message.body}</div>`;
  }

  function forceNormalShippingSelection() {
    const candidates = Array.from(document.querySelectorAll('.dropdown-item a, .dropdown-item button, .dropdown-item, a, button'));
    const deliveryTarget = candidates.find(el => {
      const onclick = el.getAttribute && (el.getAttribute('onclick') || '');
      const text = (el.textContent || '').trim();
      return onclick.includes("'normal'") || onclick.includes('"normal"') || text === '택배';
    });

    if (deliveryTarget && !window.__forcingNormalShipping) {
      try {
        window.__forcingNormalShipping = true;
        deliveryTarget.click();
      } catch (e) {
      } finally {
        setTimeout(() => {
          window.__forcingNormalShipping = false;
        }, 100);
      }
    }
  }

  function keepPickupRestricted() {
    blockPickupOption();
    forceNormalShippingSelection();
  }

  function blockPickupOption() {
    const styleId = 'pickup-restriction-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .pickup-restricted-item {
          display: none !important;
          pointer-events: none !important;
        }
        .pickup-restricted-link {
          pointer-events: none !important;
          opacity: 0.45 !important;
          cursor: not-allowed !important;
        }
      `;
      document.head.appendChild(style);
    }

    document.querySelectorAll('.dropdown-item').forEach(item => {
      const text = (item.textContent || '').trim();
      const onclick = item.getAttribute('onclick') || '';
      const isVisit = text === '방문수령' || text.includes('방문수령') || onclick.includes("'visit'") || onclick.includes('"visit"');
      if (!isVisit) return;

      item.classList.add('pickup-restricted-item');
      item.setAttribute('data-restricted-pickup', 'true');
      item.setAttribute('aria-hidden', 'true');

      item.querySelectorAll('a, button').forEach(control => {
        control.classList.add('pickup-restricted-link');
        control.removeAttribute('onclick');
        if (control.tagName === 'A') {
          control.setAttribute('href', 'javascript:;');
        }
      });
    });

    document.querySelectorAll('a[onclick*="\'visit\'"], a[onclick*="\"visit\""], button[onclick*="\'visit\'"], button[onclick*="\"visit\""]').forEach(control => {
      control.classList.add('pickup-restricted-link');
      control.removeAttribute('onclick');
      if (control.tagName === 'A') {
        control.setAttribute('href', 'javascript:;');
      }
      const item = control.closest('.dropdown-item');
      if (item) {
        item.classList.add('pickup-restricted-item');
      }
    });

    document.querySelectorAll('.dropdown-toggle, .dropdown_button, .shipping_type, .delivery_type').forEach(toggle => {
      const text = (toggle.textContent || '').trim();
      if (text.includes('방문수령')) {
        const textNode = Array.from(toggle.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        if (textNode) {
          textNode.textContent = textNode.textContent.replace('방문수령', '택배');
        }
      }
    });

    document.querySelectorAll('input, select, option').forEach(el => {
      const value = String(el.value || '');
      if (value.toLowerCase() === 'visit') {
        try {
          el.value = 'normal';
          el.setAttribute('value', 'normal');
        } catch (e) {}
      }
    });
  }

  function preventRestrictedPickupClick(event) {
    const target = event.target.closest('.dropdown-item, a, button');
    if (!target) return;

    const onclick = target.getAttribute && (target.getAttribute('onclick') || '');
    const text = (target.textContent || '').trim();
    const isVisit = text === '방문수령' || text.includes('방문수령') || onclick.includes("'visit'") || onclick.includes('"visit"');

    if (!isVisit) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    keepPickupRestricted();
    return false;
  }

  function startRestrictionObserver(result) {
    if (window.__restrictionObserverStarted) return;
    window.__restrictionObserverStarted = true;

    const observer = new MutationObserver(() => {
      if (result.blockPurchase) {
        blockPurchaseButton();
        blockCartOrderButton();
        blockPaymentSubmitButton();
      }

      if (result.blockPickup) {
        keepPickupRestricted();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true
    });

    if (result.blockPickup && !window.__restrictedPickupClickBound) {
      window.__restrictedPickupClickBound = true;
      document.addEventListener('click', preventRestrictedPickupClick, true);
      document.addEventListener('mousedown', preventRestrictedPickupClick, true);
      document.addEventListener('mouseup', preventRestrictedPickupClick, true);
      document.addEventListener('touchstart', preventRestrictedPickupClick, true);
      window.setInterval(keepPickupRestricted, 700);
    }
  }

  async function applyRestriction() {
    const result = await checkRestriction();

    // 경고만 표시: 상단 배너만, 버튼 차단/팝업/옵저버 없음
    if (result.warningOnly) {
      showWarningOnlyNotice(result);
      return;
    }

    if (!result.blocked) return;

    showRestrictionNotice(result);

    if (result.blockPurchase) {
      blockPurchaseButton();
      blockCartOrderButton();
      blockPaymentSubmitButton();
    }

    if (result.blockPickup) {
      keepPickupRestricted();
    }
    startRestrictionObserver(result);
  }

  async function initRestriction() {
    await collectIdentity();
    await applyRestriction();
  }

  document.addEventListener('DOMContentLoaded', initRestriction);
  window.addEventListener('load', initRestriction);

  setTimeout(initRestriction, 300);
  setTimeout(initRestriction, 1000);
  setTimeout(initRestriction, 2000);
})();
</script>
