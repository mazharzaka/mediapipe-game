import { useState } from 'react';
import MobileRemote from './components/MobileRemote';
import PcArena from './components/PcArena';
import PcVsAI from './components/PcVsAI';

export default function App() {
  const [mode, setMode] = useState(null);

  if (mode === 'mobile') return <MobileRemote />;
  if (mode === 'pc') return <PcArena />;
  if (mode === 'ai') return <PcVsAI />;

  return (
    <div className="h-screen flex flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">Select Mode</h1>
      <div className="flex gap-4">
        <button
          className="px-6 py-3 rounded bg-blue-600 text-white"
          onClick={() => setMode('mobile')}
        >
          Mobile
        </button>
        <button
          className="px-6 py-3 rounded bg-green-600 text-white"
          onClick={() => setMode('pc')}
        >
          PC
        </button>
        <button
          className="px-6 py-3 rounded bg-purple-600 text-white"
          onClick={() => setMode('ai')}
        >
          PC vs AI
        </button>
      </div>
    </div>
  );
}

