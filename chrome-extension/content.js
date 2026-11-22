// Assistive YouTube Ad Skipper Content Script
// Safe Focus Mode: When Ctrl+Shift+X is triggered during an ad, focuses the Skip Ad button inside .video-ads.
// The host server (nut-js) follows up 150ms later with a physical Key.Enter (isTrusted: true).
(() => {
  console.log(
    "[Assistive Ad Skipper] Extension active on YouTube (Focus + Enter mode).",
  );

  const SKIP_SELECTORS = [
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button",
    "button.ytp-ad-skip-button-modern",
    'button[id^="skip-button"]',
    ".ytp-ad-skip-button-container button",
    ".ytp-ad-skip-button-slot button",
    "button.ytp-ad-skip-button-text",
    ".videoAdUiSkipButton",
    ".ytp-ad-overlay-close-button",
    ".ytp-ad-text.ytp-ad-skip-button-text",
  ];

  /**
   * Corner Toast notification to verify signal reception from mobile
   */
  function showCornerToast(text, durationMs = 1000) {
    let toast = document.getElementById("assistive-corner-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "assistive-corner-toast";
      toast.style.position = "fixed";
      toast.style.top = "16px";
      toast.style.right = "16px";
      toast.style.backgroundColor = "rgba(15, 23, 42, 0.95)";
      toast.style.color = "#38bdf8";
      toast.style.border = "2px solid #0284c7";
      toast.style.padding = "8px 16px";
      toast.style.borderRadius = "8px";
      toast.style.fontSize = "14px";
      toast.style.fontFamily = "system-ui, -apple-system, sans-serif";
      toast.style.fontWeight = "bold";
      toast.style.zIndex = "9999999";
      toast.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.6)";
      toast.style.transition = "opacity 0.2s ease, transform 0.2s ease";
      toast.style.pointerEvents = "none";
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-6px)";
    }, durationMs);
  }

  /**
   * Finds the genuine Skip Ad button inside .video-ads and applies focus() to it
   */
  function focusSkipButton() {
    // 1. Verify that an ad is actually active on the player
    const adPlayer = document.querySelector(
      ".html5-video-player.ad-showing, .ad-showing, .ad-interrupting",
    );
    if (!adPlayer) {
      showCornerToast("No Ad Playing", 1000);
      return false;
    }

    // 2. Search strictly inside .video-ads
    const videoAdsContainer = document.querySelector(".video-ads");
    if (!videoAdsContainer) {
      showCornerToast("No Ad Playing", 1000);
      return false;
    }

    let targetBtn = null;

    // Search known skip button selectors
    for (const selector of SKIP_SELECTORS) {
      const btn = videoAdsContainer.querySelector(selector);
      if (btn && btn.offsetParent !== null) {
        targetBtn = btn;
        break;
      }
    }

    // Fallback: search buttons inside .video-ads containing "Skip" or "تخطي"
    if (!targetBtn) {
      const adButtons = videoAdsContainer.querySelectorAll("button");
      for (const btn of adButtons) {
        if (btn && btn.offsetParent !== null) {
          const text = (btn.innerText || btn.textContent || "")
            .trim()
            .toLowerCase();
          const ariaLabel = (
            btn.getAttribute("aria-label") || ""
          ).toLowerCase();
          if (
            text.includes("skip") ||
            text.includes("تخطي") ||
            ariaLabel.includes("skip") ||
            ariaLabel.includes("تخطي")
          ) {
            targetBtn = btn;
            break;
          }
        }
      }
    }

    if (targetBtn && typeof targetBtn.focus === "function") {
      targetBtn.focus();
      showCornerToast("✓ Skip Ad Focused", 1200);
      console.log("[Assistive Ad Skipper] Focused skip button:", targetBtn);
      return true;
    } else {
      showCornerToast("Ad Playing (Skip button not ready yet)", 1200);
      return false;
    }
  }

  // Keyboard shortcut listener: Ctrl + Shift + X (with capture: true and e.code === 'KeyX' for any layout)
  window.addEventListener(
    "keydown",
    (e) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      if (isCtrlOrCmd && e.shiftKey && e.code === "KeyX") {
        e.preventDefault();
        e.stopPropagation();
        focusSkipButton();
      }
    },
    true,
  );
})();
