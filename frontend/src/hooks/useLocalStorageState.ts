import { useState, useEffect } from "react";

// A custom hook to keep state in sync with localStorage.
export function useLocalStorageState<T>(
  key: string,
  defaultValue: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const storedValue = localStorage.getItem(key);
      if (storedValue) {
        // Handle Set objects specifically during parsing
        const parsed = JSON.parse(storedValue, (_k, v) => {
          if (typeof v === "object" && v !== null && v.dataType === "Set") {
            return new Set(v.value);
          }
          return v;
        });
        return parsed;
      }
    } catch (error) {
      console.error(`Error reading localStorage key “${key}”:`, error);
    }
    return defaultValue;
  });

  useEffect(() => {
    try {
      // Handle Set objects specifically during serialization
      const valueToStore = JSON.stringify(state, (_k, v) => {
        if (v instanceof Set) {
          return { dataType: "Set", value: Array.from(v) };
        }
        return v;
      });
      localStorage.setItem(key, valueToStore);
    } catch (error) {
      console.error(`Error setting localStorage key “${key}”:`, error);
    }
  }, [key, state]);

  return [state, setState];
}
