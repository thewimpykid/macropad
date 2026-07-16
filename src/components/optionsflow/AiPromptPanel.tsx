"use client";

import { useState } from "react";
import type { GexResponse } from "@/lib/gex";
import { PROMPTS } from "@/lib/aiPromptEngine";

export function AiPromptPanel({ data }: { data: GexResponse }) {
  const [activeId, setActiveId] = useState(PROMPTS[0].id);
  const [copied, setCopied] = useState(false);
  const active = PROMPTS.find((p) => p.id === activeId) ?? PROMPTS[0];
  const text = active.build(data);

  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex border border-[var(--border)]">
          {PROMPTS.map((p) => (
            <button
              key={p.id}
              onClick={() => setActiveId(p.id)}
              className={`px-3 py-1.5 font-mono text-[0.66rem] font-semibold tracking-[0.05em] transition-colors duration-150 ${
                p.id === activeId ? "bg-[var(--accent)] text-[var(--bg)]" : "text-[var(--text-dim)] hover:text-[var(--text)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          onClick={copy}
          className="btn-primary px-4 py-1.5 font-mono text-[0.68rem] font-semibold tracking-[0.05em]"
        >
          {copied ? "COPIED" : "COPY PROMPT"}
        </button>
      </div>
      <div className="eyebrow">{active.description}</div>
      <textarea
        readOnly
        value={text}
        onFocus={(e) => e.target.select()}
        className="h-[520px] w-full resize-y border border-[var(--border)] bg-[var(--panel-2)] p-3 font-mono text-[0.68rem] leading-relaxed text-[var(--text-dim)] outline-none"
      />
      <p className="m-0 font-mono text-[0.6rem] leading-relaxed text-[var(--text-faint)]">
        Every figure in this prompt is real data this app either fetched or computed from this request - copy it into ChatGPT or any other LLM as-is. Nothing here is fabricated to fill the prompt out.
      </p>
    </div>
  );
}
