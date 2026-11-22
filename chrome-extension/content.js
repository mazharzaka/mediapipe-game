// Assistive YouTube Ad Skipper Content Script
(() => {
  console.log('[Assistive Ad Skipper] Extension active on YouTube.');

  const SKIP_SELECTORS = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    'button[id^="skip-button"]',
    '.ytp-ad-skip-button-container button',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-overlay-close-button',
    'button.ytp-ad-skip-button-text',
    '.videoAdUiSkipButton',
    '.ytp-ad-text.ytp-ad-skip-button-text'
  ];

  function showSkipBanner(text = '✓ تم تخطي الإعلان (Ad Skipped)') {
    let banner = document.getElementById('assistive-skip-toast');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'assistive-skip-toast';
      banner.style.position = 'fixed';
      banner.style.bottom = '24px';
      banner.style.left = '50%';
      banner.style.transform = 'translateX(-50%)';
      banner.style.backgroundColor = '#0f766e';
      banner.style.color = '#ffffff';
      banner.style.padding = '12px 24px';
      banner.style.borderRadius = '12px';
      banner.style.fontSize = '18px';
      banner.style.fontWeight = 'bold';
      banner.style.zIndex = '999999';
      banner.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';
      banner.style.transition = 'opacity 0.3s ease';
      banner.style.pointerEvents = 'none';
      document.body.appendChild(banner);
    }
    banner.textContent = text;
    banner.style.opacity = '1';
    clearTimeout(banner._hideTimer);
    banner._hideTimer = setTimeout(() => {
      banner.style.opacity = '0';
    }, 1800);
  }

  function trySkipAd() {
    let clicked = false;

    for (const selector of SKIP_SELECTORS) {
      const buttons = document.querySelectorAll(selector);
      for (const btn of buttons) {
        if (btn && typeof btn.click === 'function' && btn.offsetParent !== null) {
          btn.click();
          clicked = true;
          console.log('[Assistive Ad Skipper] Clicked button:', selector);
        }
      }
    }

    // Also close pop-up ad overlays if present
    const closeOverlayBtns = document.querySelectorAll('.ytp-ad-overlay-close-button');
    for (const btn of closeOverlayBtns) {
      if (btn && typeof btn.click === 'function') {
        btn.click();
        clicked = true;
      }
    }

    // Try fast-forwarding unskippable ads if video element is an ad
    const adContainer = document.querySelector('.ad-showing, .ad-interrupting');
    if (adContainer) {
      const video = document.querySelector('video.html5-main-video');
      if (video && isFinite(video.duration) && video.duration > 0 && !isNaN(video.currentTime)) {
        try {
          video.currentTime = video.duration - 0.1;
          clicked = true;
        } catch {}
      }
    }

    if (clicked) {
      showSkipBanner();
    }
    return clicked;
  }

  // Keyboard shortcut listener: Ctrl + Shift + X
  window.addEventListener(
    'keydown',
    (e) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      if (isCtrlOrCmd && e.shiftKey && (e.key === 'X' || e.key === 'x' || e.code === 'KeyX')) {
        e.preventDefault();
        e.stopPropagation();
        const success = trySkipAd();
        console.log('[Assistive Ad Skipper] Ctrl+Shift+X triggered. Skip result:', success);
        if (!success) {
          showSkipBanner('⚠️ جاري البحث عن زرار التخطي...');
        }
      }
    },
    true
  );

  // Proactive observer: Automatically skip when the button appears on DOM
  const observer = new MutationObserver(() => {
    const isAd = document.querySelector('.ad-showing, .ad-interrupting');
    if (isAd) {
      trySkipAd();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
