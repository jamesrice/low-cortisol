import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  getNextSceneIndex,
  getSceneById,
  LOW_CORTISOL_SCENES,
  type LowCortisolSceneId,
} from './sceneCatalog';

export interface ScenePickerProps {
  activeScene: LowCortisolSceneId;
  onSelectScene: (id: LowCortisolSceneId) => void;
  align?: 'left' | 'center';
}

export function ScenePicker({ activeScene, onSelectScene, align = 'left' }: ScenePickerProps) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(() =>
    Math.max(0, LOW_CORTISOL_SCENES.findIndex((s) => s.id === activeScene))
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const current = getSceneById(activeScene);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        setHighlightedIndex((idx) => {
          const next = getNextSceneIndex(idx, delta);
          optionRefs.current[next]?.focus();
          return next;
        });
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        const next = e.key === 'Home' ? 0 : LOW_CORTISOL_SCENES.length - 1;
        setHighlightedIndex(next);
        optionRefs.current[next]?.focus();
      }
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggleOpen = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        const idx = LOW_CORTISOL_SCENES.findIndex((s) => s.id === activeScene);
        setHighlightedIndex(idx >= 0 ? idx : 0);
      }
      return next;
    });
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="scene-picker-listbox"
        aria-label={`Select scene, current: ${current.name}`}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          open
            ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
            : 'text-[var(--text)] hover:bg-white/8'
        }`}
      >
        <span>{current.name}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[var(--muted)] transition-transform duration-150 ${
            open ? 'rotate-180 text-[var(--accent)]' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <ul
          id="scene-picker-listbox"
          role="listbox"
          aria-label="Choose interactive scene"
          className={`lc-glass absolute top-[calc(100%+8px)] z-30 m-0 p-1.5 list-none rounded-xl w-[244px] flex flex-col gap-0.5 ${
            align === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-0'
          }`}
        >
          {LOW_CORTISOL_SCENES.map((scene, idx) => {
            const selected = scene.id === activeScene;
            const highlighted = idx === highlightedIndex;
            return (
              <li key={scene.id} role="none">
                <button
                  ref={(el) => {
                    optionRefs.current[idx] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  onFocus={() => setHighlightedIndex(idx)}
                  onClick={() => {
                    onSelectScene(scene.id);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                    selected
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                      : highlighted
                        ? 'bg-white/8 text-[var(--text)]'
                        : 'text-[var(--text)] hover:bg-white/6'
                  }`}
                >
                  <span className="flex flex-col min-w-0">
                    <span className="text-xs font-semibold leading-tight truncate">
                      {scene.name}
                    </span>
                    <span className="text-[11px] text-[var(--muted)] leading-snug truncate mt-0.5">
                      {scene.subtitle}
                    </span>
                  </span>
                  {selected && (
                    <Check className="w-3.5 h-3.5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
