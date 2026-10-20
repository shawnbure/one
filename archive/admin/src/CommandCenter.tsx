import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, LayoutGrid, Search, Workflow, X } from "lucide-react";
import { searchCommands, type CommandSearchItem } from "./command-search";
import "./command-center.css";

export function CommandCenter({ open, items, onClose, onChoose }: {
  open: boolean;
  items: CommandSearchItem[];
  onClose: () => void;
  onChoose: (item: CommandSearchItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchCommands(items, query), [items, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    queueMicrotask(() => inputRef.current?.focus());
  }, [open]);
  useEffect(() => {
    if (activeIndex >= results.length) setActiveIndex(Math.max(0, results.length - 1));
  }, [activeIndex, results.length]);

  if (!open) return null;
  function choose(item?: CommandSearchItem) {
    if (!item) return;
    onChoose(item);
    onClose();
  }
  return <div className="command-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="command-center" role="dialog" aria-modal="true" aria-label="Workrr command center">
      <header>
        <Search size={20}/>
        <input ref={inputRef} value={query} aria-label="Search Workrr"
          placeholder="Find a workspace or process…" onChange={(event) => {
            setQuery(event.target.value); setActiveIndex(0);
          }} onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "ArrowDown") {
              event.preventDefault(); setActiveIndex((index) =>
                results.length ? Math.min(index + 1, results.length - 1) : 0);
            }
            if (event.key === "ArrowUp") {
              event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0));
            }
            if (event.key === "Enter") {
              event.preventDefault(); choose(results[activeIndex]);
            }
          }}/>
        <button aria-label="Close command center" onClick={onClose}><X size={18}/></button>
      </header>
      <div className="command-results" role="listbox" aria-label="Search results">
        {results.map((item, index) => <button key={item.id} role="option"
          aria-selected={index === activeIndex} className={index === activeIndex ? "active" : ""}
          onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(item)}>
          <span className={`command-icon ${item.kind}`}>
            {item.kind === "process" ? <Workflow size={18}/> : <LayoutGrid size={18}/>}
          </span>
          <span><strong>{item.label}</strong><small>{item.description}</small></span>
          <em>{item.kind}</em><ArrowRight size={16}/>
        </button>)}
        {!results.length && <div className="command-empty"><Search size={24}/><strong>No matching destination</strong>
          <p>Try a process name, workspace, run, approval, connection, or governance term.</p></div>}
      </div>
      <footer><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span>
        <span><kbd>esc</kbd> close</span><small>{items.length} authorized destinations</small></footer>
    </section>
  </div>;
}
