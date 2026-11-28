import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";

export default function HomeSelector() {
  const [customTunnelUrl, setCustomTunnelUrl] = useState("");
  const [copied, setCopied] = useState(false);

  // Detect if current session is running on localhost / loopback
  const isLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "::1");

  const [localIp, setLocalIp] = useState(null);
  const [loadingIp, setLoadingIp] = useState(isLocalhost);

  // Fetch local Wi-Fi / LAN IP from Node.js backend when running on localhost
  useEffect(() => {
    if (!isLocalhost) return;

    let active = true;
    fetch("/api/network-info")
      .then((res) => {
        if (!res.ok) throw new Error("Network response not ok");
        return res.json();
      })
      .then((data) => {
        if (active && data?.ip) {
          setLocalIp(data.ip);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch local network IP:", err);
      })
      .finally(() => {
        if (active) setLoadingIp(false);
      });

    return () => {
      active = false;
    };
  }, [isLocalhost]);

  // Compute final assistive target URL for QR Code & Mobile
  const targetAssistiveUrl = useMemo(() => {
    const trimmed = customTunnelUrl.trim();
    if (trimmed) {
      let url = trimmed;
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url = `https://${url}`;
      }

      try {
        const parsed = new URL(url);
        if (!parsed.pathname.includes("/assistive")) {
          parsed.pathname = parsed.pathname.replace(/\/+$/, "") + "/assistive";
        }
        return parsed.toString();
      } catch {
        return url.includes("/assistive")
          ? url
          : `${url.replace(/\/+$/, "")}/assistive`;
      }
    }

    // When on localhost, substitute with the real local Wi-Fi IP so mobile devices can connect
    if (isLocalhost) {
      const port =
        typeof window !== "undefined" && window.location.port
          ? window.location.port
          : "5173";
      const ip = localIp || "192.168.100";
      return `http://${ip}:${port}/assistive`;
    }

    // External origin (ngrok, Cloudflare Tunnel, or direct LAN IP)
    const currentOrigin =
      typeof window !== "undefined" && window.location.origin
        ? window.location.origin
        : "http://localhost:5173";
    return `${currentOrigin}/assistive`;
  }, [customTunnelUrl, isLocalhost, localIp]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(targetAssistiveUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  const handleResetUrl = () => {
    setCustomTunnelUrl("");
  };

  return (
    <main
      className="min-h-screen bg-zinc-950 text-zinc-50 flex flex-col items-center justify-start p-4 sm:p-6 lg:p-10"
      aria-label="Main Application Menu and Pairing Center"
    >
      <div className="w-full max-w-4xl flex flex-col gap-8">
        {/* Utilitarian Header */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-zinc-700">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-700 text-zinc-300 text-sm font-semibold tracking-wide">
              <span>[ACCESSIBILITY SYSTEM]</span>
              <span>WCAG AAA Compliant</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-50">
              MediaPipe Assistive & Game Suite
            </h1>
            <p className="text-lg sm:text-xl text-zinc-300 leading-relaxed">
              منظومة التحكم بالرأس عن بعد عبر كاميرا الهاتف وتقنيات الوصول لذوي
              الإعاقة الحركية
            </p>
          </div>

          <div
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-700 self-stretch sm:self-auto justify-center"
            role="status"
          >
            <span
              className="inline-block w-3.5 h-3.5 rounded-full bg-green-500"
              aria-hidden="true"
            />
            <span className="text-base font-semibold text-zinc-200">
              Host Active / الحاسوب جاهز
            </span>
          </div>
        </header>

        {/* SECTION 1: PC Host & Mobile QR Code Pairing (Clinical Grade Card) */}
        <section
          className="bg-zinc-900 border-2 border-zinc-700 rounded-2xl p-6 sm:p-8 flex flex-col gap-6"
          aria-label="Mobile Remote Camera Pairing Screen"
        >
          <div className="border-b border-zinc-700 pb-4">
            <div className="flex items-center gap-2 text-teal-400 text-sm font-bold tracking-wider uppercase mb-1">
              <span>● STEP 1 / الخطوة الأولى</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-zinc-50">
              ربط كاميرا الموبايل بالحاسوب / Mobile Camera Pairing
            </h2>
            <p className="text-base sm:text-lg text-zinc-300 mt-1 leading-relaxed">
              امسح رمز الاستجابة السريعة (QR Code) بكاميرا هاتفك ليتحول إلى جهاز
              تتبع للرأس يتحكم بماوس اللابتوب بدون الحاجة لتثبيت أي برامج على
              الهاتف.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
            {/* High-Contrast QR Code Display */}
            <div className="md:col-span-5 flex flex-col items-center gap-3">
              <div
                className="p-4 bg-white rounded-xl border-4 border-zinc-700 flex items-center justify-center shadow-none min-h-[242px] min-w-[242px]"
                aria-label="QR Code to connect mobile camera"
              >
                {loadingIp && isLocalhost && !customTunnelUrl ? (
                  <div className="flex flex-col items-center justify-center p-4 text-zinc-900 text-center gap-2">
                    <span className="font-mono text-sm font-bold">
                      جاري جلب عنوان Wi-Fi...
                    </span>
                  </div>
                ) : (
                  <QRCodeSVG
                    value={targetAssistiveUrl}
                    size={210}
                    bgColor="#FFFFFF"
                    fgColor="#000000"
                    level="M"
                    includeMargin={false}
                  />
                )}
              </div>
              <span className="text-sm font-semibold text-zinc-300 text-center">
                امسح بكاميرا الهاتف للفتح الفوري
              </span>
            </div>

            {/* URL Input & Controls for Tunnel / Local Network */}
            <div className="md:col-span-7 flex flex-col gap-4">
              {/* Network Source Indicator */}
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm font-mono"
                role="status"
              >
                <span
                  className={`inline-block w-2.5 h-2.5 rounded-full ${
                    customTunnelUrl
                      ? "bg-purple-500"
                      : isLocalhost
                        ? "bg-teal-500"
                        : "bg-green-500"
                  }`}
                  aria-hidden="true"
                />
                <span className="text-zinc-200 font-semibold">
                  {customTunnelUrl
                    ? "[Custom Tunnel / رابط مخصص]"
                    : isLocalhost
                      ? `[Wi-Fi LAN IP: ${localIp || "جارِ التحديد"}]`
                      : "[External / رابط نفق مباشر]"}
                </span>
                {isLocalhost && !customTunnelUrl && (
                  <span className="text-xs text-teal-300 ml-auto hidden sm:inline">
                    تم استبدال localhost بـ IP الشبكة تلقائياً
                  </span>
                )}
              </div>

              {/* Tunnel URL Input Field */}
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="tunnel-input"
                  className="text-lg font-bold text-zinc-100 flex items-center justify-between"
                >
                  <span>
                    رابط النفق الخارجي / External Tunnel URL (اختياري)
                  </span>
                  {customTunnelUrl && (
                    <button
                      type="button"
                      onClick={handleResetUrl}
                      className="text-xs font-semibold text-amber-400 hover:text-amber-300 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      إعادة للرابط التلقائي
                    </button>
                  )}
                </label>
                <p className="text-sm text-zinc-300">
                  إذا أردت استخدام رابط ngrok أو Cloudflare يدوي، الصقه هنا
                  وسيقوم الـ QR Code بالتحديث فوراً:
                </p>
                <input
                  id="tunnel-input"
                  type="text"
                  value={customTunnelUrl}
                  onChange={(e) => setCustomTunnelUrl(e.target.value)}
                  placeholder="https://your-tunnel-subdomain.trycloudflare.com"
                  className="min-h-14 px-4 py-3 rounded-lg bg-zinc-950 border-2 border-zinc-700 text-zinc-50 font-mono text-base placeholder-zinc-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                  aria-describedby="tunnel-help"
                />
              </div>

              {/* Live Target URL Preview */}
              <div className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-800 flex flex-col gap-1">
                <span className="text-xs font-semibold text-zinc-400">
                  الرابط النشط داخل الـ QR Code:
                </span>
                <span className="font-mono text-sm sm:text-base text-teal-400 break-all select-all font-semibold">
                  {targetAssistiveUrl}
                </span>
              </div>

              {/* Action Buttons: Copy Link & Quick Test */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleCopy}
                  className={`min-h-14 px-4 py-3 rounded-lg font-bold text-lg flex items-center justify-center gap-2 border-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
                    copied
                      ? "bg-green-600 text-white border-green-300"
                      : "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-600"
                  }`}
                  aria-label="Copy generated pairing link to clipboard"
                >
                  <span className="text-xl" aria-hidden="true">
                    {copied ? "✓" : "📋"}
                  </span>
                  <span>
                    {copied ? "تم النسخ بنجاح!" : "نسخ الرابط / Copy Link"}
                  </span>
                </button>

                <a
                  href={targetAssistiveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-14 px-4 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-bold text-lg border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
                  aria-label="Test link in new browser tab"
                >
                  <span className="text-xl" aria-hidden="true">
                    ↗
                  </span>
                  <span>تجربة الرابط / Open Tab</span>
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2: Direct Local Actions (Assistive Tool & Game Arena) */}
        <section
          aria-label="Direct Navigation Choices"
          className="flex flex-col gap-4"
        >
          <h2 className="text-xl font-bold text-zinc-300">
            أو التشغيل المباشر من هذا الجهاز / Direct Access:
          </h2>

          <nav
            className="grid grid-cols-1 sm:grid-cols-3 gap-6"
            aria-label="Application choices"
          >
            {/* Assistive Tool & AI Agent Button (Large Primary Action) */}
            <Link
              to="/assistive"
              className="min-h-20 sm:min-h-24 p-6 rounded-xl bg-teal-600 hover:bg-teal-500 text-white border-2 border-teal-300 flex flex-col items-center justify-center gap-2 text-center focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-4 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
              aria-label="Assistive Tool & AI Agent: Open assistive controls and AI assistant"
            >
              <span className="text-3xl" aria-hidden="true">
                🤖
              </span>
              <span className="text-xl sm:text-2xl font-bold">
                المساعد الذكي (ZAZA — ظاظا)
              </span>
              <span className="text-sm sm:text-base text-teal-100 font-medium">
                المساعد الصوتي، تتبع الوجه، التاتش باد، والريموت
              </span>
            </Link>

            {/* Loly Interactive Cartoon World Button */}
            <Link
              to="/loly"
              className="min-h-20 sm:min-h-24 p-6 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 border-2 border-yellow-200 flex flex-col items-center justify-center gap-2.5 text-center focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 focus-visible:ring-offset-4 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
              style={{ boxShadow: "0 0 22px rgba(250, 204, 21, 0.4)" }}
              aria-label="عالم لولي الكرتوني التفاعلي"
            >
              <span
                className="w-16 h-16 rounded-full overflow-hidden bg-amber-50 border-4 border-yellow-100 ring-2 ring-amber-700 flex items-center justify-center"
                style={{ boxShadow: "0 0 14px rgba(253, 224, 71, 0.95)" }}
              >
                <img
                  src="/loly/characters/loly.png"
                  alt="لولي"
                  className="w-full h-full object-cover"
                />
              </span>
              <span className="text-xl sm:text-2xl font-extrabold">
                لولي 👑
              </span>
              <span className="text-sm sm:text-base text-zinc-900 font-bold">
                عالم لولاتي الكرتوني التفاعلي الساحر
              </span>
            </Link>

            {/* Play Game Button */}
            <Link
              to="/game"
              className="min-h-20 sm:min-h-24 p-6 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white border-2 border-zinc-600 flex flex-col items-center justify-center gap-2 text-center focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-4 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
              aria-label="Play Game: Boxing Arena game with hand gesture controls"
            >
              <span className="text-3xl" aria-hidden="true">
                🥊
              </span>
              <span className="text-xl sm:text-2xl font-bold">
                Play Boxing Game
              </span>
              <span className="text-sm sm:text-base text-zinc-300 font-medium">
                ساحة لعبة الملاكمة بالإيماءات
              </span>
            </Link>
          </nav>
        </section>

        {/* Accessible Footer Note */}
        <footer className="pt-4 border-t border-zinc-800 text-center">
          <p className="text-sm text-zinc-400">
            النظام يدعم العمل عبر الشبكة المحلية (LAN) وعبر أنفاق Cloudflare /
            ngrok الآمنة دون أية تعارضات في شهادات الأمان أو الـ CORS.
          </p>
        </footer>
      </div>
    </main>
  );
}
