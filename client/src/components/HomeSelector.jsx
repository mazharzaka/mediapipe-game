import { Link } from 'react-router-dom';

export default function HomeSelector() {
  return (
    <main
      className="min-h-screen bg-zinc-950 text-zinc-50 flex flex-col items-center justify-center p-6 sm:p-10"
      aria-label="Main Application Menu"
    >
      <div className="w-full max-w-2xl bg-zinc-900 border-2 border-zinc-700 rounded-2xl p-8 sm:p-12 flex flex-col items-center text-center gap-8 shadow-none">
        {/* Clinical Utilitarian Header */}
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300 text-sm font-semibold tracking-wide">
            [ACCESSIBILITY SYSTEM] WCAG AAA
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-50 leading-snug">
            MediaPipe Assistive & Game Suite
          </h1>
          <p className="text-lg sm:text-xl text-zinc-300 leading-relaxed max-w-lg mx-auto">
            منظومة التحكم بالإيماءات وتقنيات الوصول لذوي الإعاقة الحركية
          </p>
        </div>

        {/* Two Large High-Contrast Buttons */}
        <nav
          className="w-full flex flex-col sm:flex-row gap-6 pt-2"
          aria-label="Application Choices"
        >
          {/* Assistive Tool Button */}
          <Link
            to="/assistive"
            className="flex-1 min-h-20 sm:min-h-24 p-6 rounded-xl bg-teal-600 hover:bg-teal-500 text-white border-2 border-teal-300 flex flex-col items-center justify-center gap-2 text-center focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-4 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
            aria-label="Assistive Tool: Control Windows mouse using mobile camera head tracking"
          >
            <span className="text-2xl sm:text-3xl" aria-hidden="true">
              🎯
            </span>
            <span className="text-xl sm:text-2xl font-bold">Assistive Tool</span>
            <span className="text-base text-teal-100 font-medium">
              أداة تحكم الماوس بالرأس
            </span>
          </Link>

          {/* Play Game Button */}
          <Link
            to="/game"
            className="flex-1 min-h-20 sm:min-h-24 p-6 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white border-2 border-zinc-600 flex flex-col items-center justify-center gap-2 text-center focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-4 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
            aria-label="Play Game: Boxing Arena game with hand gesture controls"
          >
            <span className="text-2xl sm:text-3xl" aria-hidden="true">
              🥊
            </span>
            <span className="text-xl sm:text-2xl font-bold">Play Game</span>
            <span className="text-base text-zinc-300 font-medium">
              لعبة الملاكمة بالإيماءات
            </span>
          </Link>
        </nav>

        {/* Accessible Footer Note */}
        <div className="pt-4 border-t border-zinc-800 w-full text-center">
          <p className="text-sm text-zinc-400">
            مصمم وفق معايير إمكانية الوصول العالية للمستخدمين ذوي الحركة المحدودة
          </p>
        </div>
      </div>
    </main>
  );
}
