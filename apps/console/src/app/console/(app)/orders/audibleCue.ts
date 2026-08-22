// WBS 5.8 — "Choose or synthesise a tone that cuts through grinder noise --
// mid-high frequency, repeated twice." Synthesised via Web Audio rather than
// a shipped audio file: no asset to host, no autoplay-policy dance around
// loading a <audio> element, and it works identically offline. Two short
// tones (~1047Hz, C6 -- mid-high) 280ms apart, plus navigator.vibrate for a
// merchant who has the phone face-down.
export function playNewOrderCue(): void {
  if (typeof window === "undefined") return;
  const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AudioContextCtor) {
    const ctx = new AudioContextCtor();
    const beepAt = (offsetSeconds: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 1046.5;
      const start = ctx.currentTime + offsetSeconds;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.5, start + 0.02);
      gain.gain.linearRampToValueAtTime(0, start + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    };
    beepAt(0);
    beepAt(0.28); // repeated twice, per the WBS 5.8 prompt
    window.setTimeout(() => void ctx.close(), 700);
  }
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate([120, 80, 120]);
  }
}
