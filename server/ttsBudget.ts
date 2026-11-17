/** Process-wide guest-compatible backstop; no IP headers or personal identifiers. */
export class TtsBudget {
  private start = 0;
  private used = 0;
  private active = 0;
  constructor(private now = Date.now) {}
  acquire(chars: number): (() => void) | null {
    const now = this.now();
    if (now - this.start >= 60000) {
      this.start = now;
      this.used = 0;
    }
    if (this.active >= 2 || this.used + chars > 80000) return null;
    this.active++;
    this.used += chars;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active--;
      }
    };
  }
}
export const ttsBudget = new TtsBudget();
