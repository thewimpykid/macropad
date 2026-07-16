"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TesseractGate() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tesseract-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        setError("Wrong code.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Request failed.");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-3 border border-[var(--border)] bg-[var(--panel)] p-6">
        <span className="partno">ACCESS</span>
        <input
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="ACCESS CODE"
          className="border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 font-mono text-sm uppercase tracking-[0.08em] text-[var(--text)] outline-none focus:border-[var(--border-strong)]"
        />
        <button
          type="submit"
          disabled={busy || !code}
          className="border border-[var(--border-strong)] bg-[var(--text)] px-3 py-2 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-[var(--bg)] disabled:opacity-40"
        >
          {busy ? "Checking…" : "Enter"}
        </button>
        {error && <p className="m-0 font-mono text-[0.7rem]" style={{ color: "var(--down)" }}>{error}</p>}
      </form>
    </div>
  );
}
