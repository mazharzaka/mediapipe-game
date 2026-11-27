import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import HomeSelector from './components/HomeSelector';
import AssistiveController from './components/AssistiveController';
import GameLauncher from './components/GameLauncher';
import LolyWorld from './loly/LolyWorld';

function AppLayout() {
  const location = useLocation();
  const pathname = location.pathname;

  // /loly is a full-screen 100% organic cartoon theater with its own elegant Home return button
  const isLolyRoute = pathname.startsWith('/loly');
  const isAssistiveRoute = pathname.startsWith('/assistive');
  const isGameRoute = pathname.startsWith('/game');

  if (isLolyRoute) {
    return (
      <Routes>
        <Route path="/loly" element={<LolyWorld />} />
        <Route path="/loly/*" element={<LolyWorld />} />
      </Routes>
    );
  }

  return (
    <div
      className={`w-full bg-zinc-950 text-zinc-50 flex flex-col ${
        isAssistiveRoute
          ? 'h-[100dvh] max-h-[100dvh] overflow-hidden sm:h-auto sm:max-h-none sm:min-h-screen sm:overflow-visible'
          : 'min-h-screen pb-20 sm:pb-0'
      }`}
    >
      {/* DESKTOP / WEB TOP NAVIGATION BAR */}
      <header
        dir="rtl"
        aria-label="شريط التنقل الرئيسي للويب"
        className="hidden sm:flex items-center justify-between gap-4 px-6 py-2.5 bg-zinc-900 border-b-2 border-zinc-800 sticky top-0 z-40"
      >
        <Link
          to="/"
          className="flex items-center gap-2.5 text-zinc-50 hover:text-teal-300 font-bold text-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 rounded-xl px-2 py-1"
        >
          <span aria-hidden="true">🏠</span>
          <span>الرئيسية</span>
        </Link>

        <nav className="flex items-center gap-3" aria-label="أقسام التطبيق الرئيسية">
          {/* 1. AI Assistant (ZAKA) */}
          <Link
            to="/assistive"
            className={`min-h-12 px-4 py-2 rounded-xl font-bold text-base flex items-center gap-2 border-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 ${
              isAssistiveRoute
                ? 'bg-teal-600 text-white border-teal-300'
                : 'bg-zinc-950 text-zinc-200 hover:bg-zinc-800 border-zinc-700'
            }`}
          >
            <span aria-hidden="true">🤖</span>
            <span>المساعد الذكي (زاقا)</span>
          </Link>

          {/* 2. Prominent Joyful LOLY Button with Circular Cartoon Avatar & Glowing Golden Frame */}
          <Link
            to="/loly"
            className="min-h-12 pl-4 pr-2 py-1.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-base border-2 border-yellow-200 flex items-center gap-2.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300"
            style={{ boxShadow: '0 0 18px rgba(250, 204, 21, 0.55)' }}
            aria-label="الانتقال إلى عالم لولي الكرتوني التفاعلي"
          >
            <span
              className="w-9 h-9 rounded-full overflow-hidden bg-amber-50 border-2 border-yellow-100 ring-2 ring-amber-600 shrink-0 flex items-center justify-center"
              style={{ boxShadow: '0 0 10px rgba(253, 224, 71, 0.9)' }}
            >
              <img
                src="/loly/characters/loly.png"
                alt="لولي"
                className="w-full h-full object-cover"
              />
            </span>
            <span className="text-lg font-extrabold tracking-tight">لولي 👑</span>
          </Link>

          {/* 3. Play Boxing */}
          <Link
            to="/game"
            className={`min-h-12 px-4 py-2 rounded-xl font-bold text-base flex items-center gap-2 border-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 ${
              isGameRoute
                ? 'bg-teal-600 text-white border-teal-300'
                : 'bg-zinc-950 text-zinc-200 hover:bg-zinc-800 border-zinc-700'
            }`}
          >
            <span aria-hidden="true">🥊</span>
            <span>Play Boxing</span>
          </Link>
        </nav>
      </header>

      {/* MAIN ROUTE CONTENT */}
      <div className={isAssistiveRoute ? 'flex-1 min-h-0 flex flex-col overflow-hidden sm:overflow-visible' : 'flex-1'}>
        <Routes>
          <Route path="/" element={<HomeSelector />} />
          <Route path="/game" element={<GameLauncher />} />
          <Route path="/assistive" element={<AssistiveController />} />
          <Route path="/loly" element={<LolyWorld />} />
        </Routes>
      </div>

      {/* MOBILE BOTTOM NAVIGATION BAR */}
      <nav
        dir="rtl"
        aria-label="شريط التنقل السفلي للموبايل"
        className={`sm:hidden shrink-0 bg-zinc-900 border-t-2 border-zinc-800 px-2 pt-1.5 pb-[max(0.35rem,env(safe-area-inset-bottom))] grid grid-cols-3 gap-2 z-40 ${
          isAssistiveRoute ? 'relative' : 'fixed bottom-0 inset-x-0'
        }`}
      >
        {/* 1. AI Assistant (ZAKA) */}
        <Link
          to="/assistive"
          className={`min-h-12 rounded-xl px-2 py-1 font-bold text-xs flex flex-col items-center justify-center gap-0.5 border transition-colors duration-150 ${
            isAssistiveRoute
              ? 'bg-teal-600 text-white border-teal-300'
              : 'bg-zinc-950 text-zinc-200 border-zinc-800'
          }`}
        >
          <span className="text-base" aria-hidden="true">
            🤖
          </span>
          <span className="truncate">المساعد (زاقا)</span>
        </Link>

        {/* 2. Prominent Joyful LOLY Button with Circular Avatar & Glowing Golden Ring */}
        <Link
          to="/loly"
          className="min-h-12 rounded-2xl px-2 py-1 bg-amber-500 active:bg-amber-400 text-zinc-950 font-extrabold text-xs border-2 border-yellow-200 flex items-center justify-center gap-1.5"
          style={{ boxShadow: '0 0 14px rgba(250, 204, 21, 0.5)' }}
          aria-label="عالم لولي"
        >
          <span
            className="w-8 h-8 rounded-full overflow-hidden bg-amber-50 border-2 border-white ring-2 ring-amber-600 shrink-0"
            style={{ boxShadow: '0 0 8px rgba(253, 224, 71, 0.9)' }}
          >
            <img
              src="/loly/characters/loly.png"
              alt="لولي"
              className="w-full h-full object-cover"
            />
          </span>
          <span className="text-sm font-extrabold">لولي 👑</span>
        </Link>

        {/* 3. Play Boxing */}
        <Link
          to="/game"
          className={`min-h-12 rounded-xl px-2 py-1 font-bold text-xs flex flex-col items-center justify-center gap-0.5 border transition-colors duration-150 ${
            isGameRoute
              ? 'bg-teal-600 text-white border-teal-300'
              : 'bg-zinc-950 text-zinc-200 border-zinc-800'
          }`}
        >
          <span className="text-base" aria-hidden="true">
            🥊
          </span>
          <span className="truncate">Play Boxing</span>
        </Link>
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}
