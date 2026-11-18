import { useState } from 'react';
import { Link } from 'react-router-dom';
import MobileRemote from './MobileRemote';
import PcArena from './PcArena';
import PcVsAI from './PcVsAI';

export default function GameLauncher() {
  const [mode, setMode] = useState(null);

  if (mode === 'mobile') return <MobileRemote />;
  if (mode === 'pc') return <PcArena />;
  if (mode === 'ai') return <PcVsAI />;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 flex flex-col items-center justify-center p-6 gap-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-50">
          Boxing Game Arena / ساحة لعبة الملاكمة
        </h1>
        <p className="text-lg text-zinc-300 max-w-md mx-auto">
          اختر وضع اللعبة للبدء سواء كنت تلعب من الهاتف أو الحاسوب
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-xl justify-center">
        <button
          type="button"
          className="min-h-14 px-6 py-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xl font-bold border-2 border-blue-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
          onClick={() => setMode('mobile')}
        >
          Mobile Remote (الهاتف)
        </button>
        <button
          type="button"
          className="min-h-14 px-6 py-4 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xl font-bold border-2 border-green-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
          onClick={() => setMode('pc')}
        >
          PC Arena (الحاسوب)
        </button>
        <button
          type="button"
          className="min-h-14 px-6 py-4 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xl font-bold border-2 border-purple-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
          onClick={() => setMode('ai')}
        >
          PC vs AI (ضد الذكاء الاصطناعي)
        </button>
      </div>

      <div className="pt-4">
        <Link
          to="/"
          className="inline-flex items-center justify-center min-h-14 px-6 py-3 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 text-lg font-medium focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
        >
          ← العودة للرئيسية / Back to Home
        </Link>
      </div>
    </div>
  );
}
