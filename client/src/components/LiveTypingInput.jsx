import { useState, useRef } from 'react';
import { socket } from '../socket';

/**
 * LiveTypingInput Component
 * Supports real-time per-keystroke typing, autocorrect diffing, Backspace,
 * and instant Enter submission with input reset.
 * Strictly adheres to agent.md WCAG AAA and >= 56px touch targets.
 */
export default function LiveTypingInput({ compact = false }) {
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState('');
  const prevTextRef = useRef('');

  const showFeedback = (msg) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(''), 1500);
  };

  const handleChange = (e) => {
    const newText = e.target.value;
    const oldText = prevTextRef.current;

    // Calculate common prefix length
    let p = 0;
    while (p < oldText.length && p < newText.length && oldText[p] === newText[p]) {
      p++;
    }

    const backspaces = oldText.length - p;
    const addedText = newText.slice(p);

    prevTextRef.current = newText;
    setText(newText);

    // Emit live typing event to server
    if (backspaces > 0 || addedText.length > 0) {
      socket.emit('live_type', {
        text: addedText,
        backspaces: backspaces,
      });

      if (addedText.length > 0) {
        showFeedback(`جاري الكتابة: "${addedText}"`);
      } else if (backspaces > 0) {
        showFeedback(`مسح ${backspaces} حرف`);
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleEnter();
    }
  };

  const handleEnter = (e) => {
    if (e) e.preventDefault();
    // Emit Enter command to PC
    socket.emit('live_type', { enter: true });
    // Clear state synchronously so reset does not send backspaces
    prevTextRef.current = '';
    setText('');
    showFeedback('↵ تم إرسال Enter للبحث');
  };

  const handleManualBackspace = () => {
    socket.emit('live_type', { backspaces: 1 });
    if (text.length > 0) {
      const updated = text.slice(0, -1);
      prevTextRef.current = updated;
      setText(updated);
    }
    showFeedback('⌫ مسح (Backspace)');
  };

  const handleClearField = () => {
    // Reset mobile input without deleting anything on PC
    prevTextRef.current = '';
    setText('');
    showFeedback('تم تفريغ المربع');
  };

  return (
    <section
      aria-label="Live Typing Controller"
      className={`p-4 sm:p-6 rounded-2xl bg-zinc-900 border-2 border-zinc-700 flex flex-col gap-3 ${
        compact ? 'shadow-none' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden="true">
            ⌨️
          </span>
          <h3 className="text-lg sm:text-xl font-bold text-zinc-50">
            الكتابة الحية المباشرة (Live Typing)
          </h3>
        </div>
        {feedback && (
          <span
            className="text-xs sm:text-sm font-bold text-teal-400 bg-teal-950/80 px-2.5 py-1 rounded-md border border-teal-500/40"
            role="status"
          >
            {feedback}
          </span>
        )}
      </div>

      <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
        اكتب من كيبورد موبايلك وسيتم نقله للكمبيوتر حرفاً بحرف فوراً. اضغط <strong>Enter</strong> في كيبورد الموبايل للبحث الفوري وتصفير المربع.
      </p>

      <form onSubmit={handleEnter} className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="اكتب هنا مباشرة أو ابحث..."
            autoCapitalize="none"
            autoCorrect="on"
            enterKeyHint="search"
            className="flex-1 min-h-14 px-4 py-3 rounded-xl bg-zinc-950 border-2 border-zinc-700 text-zinc-100 placeholder-zinc-500 text-lg font-medium focus:outline-none focus:border-teal-400 focus:ring-4 focus:ring-teal-500/20"
            aria-label="Live text to type on computer"
          />

          <button
            type="submit"
            className="min-h-14 px-5 py-3 rounded-xl bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white font-bold text-base sm:text-lg border-2 border-teal-300 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Send Enter Key"
          >
            <span className="text-xl" aria-hidden="true">
              ↵
            </span>
            <span>بحث / Enter</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={handleManualBackspace}
            className="min-h-14 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-amber-300 font-bold text-sm sm:text-base border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Press Backspace key"
          >
            <span className="text-lg" aria-hidden="true">
              ⌫
            </span>
            <span>مسح (Backspace)</span>
          </button>

          <button
            type="button"
            onClick={handleClearField}
            disabled={!text}
            className="min-h-14 px-4 py-2.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-zinc-950 text-zinc-300 font-bold text-sm sm:text-base border border-zinc-700 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 transition-colors"
            aria-label="Clear mobile text box without backspacing computer"
          >
            <span>تفريغ المربع</span>
          </button>
        </div>
      </form>
    </section>
  );
}
