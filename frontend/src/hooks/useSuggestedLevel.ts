import { useState, useEffect } from "react";

export type SuggestLevel = "fast" | "normal" | "deep";

export function useSuggestLevel(): [SuggestLevel, (l: SuggestLevel) => void] {
  const [level, setLevel] = useState<SuggestLevel>(() => {
    const saved = localStorage.getItem("suggestLevel");
    return (saved as SuggestLevel) ?? "normal";
  });

  useEffect(() => {
    localStorage.setItem("suggestLevel", level);
  }, [level]);

  return [level, setLevel];
}
