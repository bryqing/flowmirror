/** WebAudio 轻量提示音（无需音频资源） */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, startAt: number, duration: number, gainValue = 0.12) {
  const audio = getCtx();
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, audio.currentTime + startAt);
  gain.gain.linearRampToValueAtTime(gainValue, audio.currentTime + startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + startAt + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(audio.currentTime + startAt);
  osc.stop(audio.currentTime + startAt + duration + 0.05);
}

/** 专注完成：清亮两音 */
export function playChime() {
  tone(880, 0, 0.35, 0.1);
  tone(1320, 0.18, 0.5, 0.09);
}

/** 黑洞刹车：急促三音警示 */
export function playBrake() {
  tone(660, 0, 0.18, 0.12);
  tone(660, 0.24, 0.18, 0.12);
  tone(880, 0.48, 0.4, 0.12);
}

export function notify(title: string, body: string) {
  if (typeof window === "undefined") return;
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "/icon.svg", badge: "/icon.svg" });
  }
}

export async function ensureNotifyPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      /* 忽略 */
    }
  }
}
