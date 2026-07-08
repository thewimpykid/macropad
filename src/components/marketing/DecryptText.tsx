"use client";

import { useEffect, useRef, useState } from "react";

const GLYPHS = "!<>-_\\/[]{}=+*^?#0123456789";

/**
 * Scrambles through random glyphs then resolves left-to-right into the real
 * text, terminal-decrypt style. Runs once on mount.
 */
export default function DecryptText({
  text,
  className,
  style,
  speedMs = 28,
}: {
  text: string;
  className?: string;
  style?: React.CSSProperties;
  speedMs?: number;
}) {
  const [display, setDisplay] = useState(text);
  const frame = useRef(0);

  useEffect(() => {
    let resolved = 0;
    const totalFrames = text.length * 3;

    const id = setInterval(() => {
      frame.current++;
      resolved = Math.min(text.length, Math.floor((frame.current / totalFrames) * text.length * 1.4));

      let out = "";
      for (let i = 0; i < text.length; i++) {
        if (text[i] === " ") {
          out += " ";
        } else if (i < resolved) {
          out += text[i];
        } else {
          out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        }
      }
      setDisplay(out);

      if (resolved >= text.length) {
        setDisplay(text);
        clearInterval(id);
      }
    }, speedMs);

    return () => clearInterval(id);
  }, [text, speedMs]);

  return (
    <span className={className} style={style} aria-label={text}>
      {display}
    </span>
  );
}
