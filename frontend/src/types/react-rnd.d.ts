import "react-rnd";

declare module "react-rnd" {
  interface Rnd {
    /** Returns the current { x, y } position */
    getPosition(): { x: number; y: number };

    /** Returns the current { width, height } size */
    getSize(): { width: number; height: number };

    /** Updates the internal zIndex state (≥ 4.0.1) */
    updateZIndex?(zIndex: number): void;
  }
}
