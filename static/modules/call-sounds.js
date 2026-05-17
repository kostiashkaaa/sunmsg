/**
 * call-sounds.js
 * Plays ringtones, connection tones, and end-call sounds using the Web Audio API.
 * No external audio files required — tones are synthesized.
 */

let _ctx = null;

function getAudioCtx() {
    if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (_ctx.state === 'suspended') {
        _ctx.resume?.().catch?.(() => {});
    }
    return _ctx;
}

function playTone(frequency, duration, type = 'sine', volume = 0.3, delay = 0) {
    try {
        const ctx = getAudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = type;
        osc.frequency.value = frequency;
        const start = ctx.currentTime + Math.max(0, Number(delay) || 0);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + 0.025);
        gain.gain.setValueAtTime(volume, Math.max(start + 0.03, start + duration - 0.08));
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.start(start);
        osc.stop(start + duration + 0.02);
    } catch (_) {}
}

function playChord(frequencies, duration, type = 'sine', volume = 0.18, delay = 0) {
    frequencies.forEach((frequency) => playTone(frequency, duration, type, volume / frequencies.length, delay));
}

// Ringtone/ringback cadence.
let _ringInterval = null;
let _ringAudioEl = null;

function playIncomingRingtonePulse() {
    playChord([660, 880], 0.22, 'sine', 0.16, 0);
    playChord([660, 880], 0.22, 'sine', 0.14, 0.32);
}

function playOutgoingRingbackPulse() {
    playChord([420, 470], 1.35, 'sine', 0.14, 0);
}

export function startRingtone(mode = 'incoming') {
    stopRingtone();
    const isOutgoing = mode === 'outgoing';
    const pulse = isOutgoing ? playOutgoingRingbackPulse : playIncomingRingtonePulse;
    pulse();
    _ringInterval = setInterval(pulse, isOutgoing ? 4200 : 1900);
}

export function stopRingtone() {
    if (_ringInterval) { clearInterval(_ringInterval); _ringInterval = null; }
    if (_ringAudioEl) { _ringAudioEl.pause(); _ringAudioEl = null; }
}

// Connected sound — ascending two-tone
export function playConnectedSound() {
    playChord([523.25, 659.25], 0.09, 'sine', 0.09, 0);
    playChord([659.25, 783.99], 0.11, 'sine', 0.08, 0.1);
}

// End-call sound — descending
export function playEndCallSound() {
    playTone(392, 0.11, 'sine', 0.12, 0);
    playTone(261.63, 0.16, 'sine', 0.10, 0.12);
}

// Busy tone — 425 Hz pulses
export function playBusyTone() {
    let n = 0;
    const interval = setInterval(() => {
        playTone(425, 0.32, 'sine', 0.16);
        if (++n >= 3) clearInterval(interval);
    }, 600);
}
