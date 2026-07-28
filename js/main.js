import { initScene } from './scene.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const REPLAY = sessionStorage.getItem('booted') === '1';
const HOVER_CAPABLE = matchMedia('(hover: hover) and (pointer: fine)').matches;

const canvas = document.getElementById('bg-canvas');
const bootOverlay = document.getElementById('boot-overlay');
const app = document.getElementById('app');

const sceneApi = canvas ? initScene(canvas) : null;
if (REDUCED) sceneApi?.setReducedMotion(true);

let bootTimeouts = [];
let gridIgnited = false;
let bootFinished = false;

const SKIP_EVENTS = ['keydown', 'pointerdown', 'wheel', 'touchmove'];

function shuffleIndices(length) {
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

const IGNITE_VARIANTS = ['letter-ignite-a', 'letter-ignite-b', 'letter-ignite-c'];

function igniteLetters() {
  const letters = document.querySelectorAll('#hero-title .l');
  if (!letters.length) return;

  const order = shuffleIndices(letters.length);
  letters.forEach((letter, index) => {
    const position = order.indexOf(index);
    const delayMs = position * 78 + Math.random() * 46;
    letter.style.setProperty('--ignite-delay', `${delayMs}ms`);
    letter.style.setProperty(
      '--ignite-name',
      IGNITE_VARIANTS[Math.floor(Math.random() * IGNITE_VARIANTS.length)],
    );
  });
}

/**
 * Desynchronise every idle animation on the page. Without this the neon reads
 * as a single looping shader; with it, nothing ever pulses in lockstep.
 */
function setupAmbientJitter() {
  if (REDUCED) return;

  const jitter = (el, baseSeconds, spread) => {
    const dur = baseSeconds + (Math.random() * 2 - 1) * spread;
    el.style.setProperty('--flk-dur', `${dur.toFixed(2)}s`);
    el.style.setProperty('--flk-delay', `${-(Math.random() * dur).toFixed(2)}s`);
  };

  document
    .querySelectorAll('#hero-title .l')
    .forEach((el) => jitter(el, 21, 8));
  document
    .querySelectorAll('[data-flicker]')
    .forEach((el) => jitter(el, 26, 9));

  const roll = document.querySelector('.fx-roll');
  if (roll) roll.style.setProperty('--flk-delay', `${-(Math.random() * 11).toFixed(2)}s`);

  const dip = document.querySelector('.fx-dip');
  if (dip) dip.style.setProperty('--flk-delay', `${-(Math.random() * 19).toFixed(2)}s`);

  const cv = document.getElementById('cv-btn');
  if (cv) cv.style.setProperty('--flk-delay', `${-(Math.random() * 5.5).toFixed(2)}s`);

  const chevron = document.querySelector('.scroll-hint-chevron');
  if (chevron) {
    chevron.style.setProperty('--flk-delay', `${-(Math.random() * 2.6).toFixed(2)}s`);
  }
}

/** Very occasionally, one letter buzzes like a failing tube, then recovers. */
function setupTubeBuzz() {
  if (REDUCED) return;

  const letters = [...document.querySelectorAll('#hero-title .l')].filter(
    (el) => !el.classList.contains('l-space'),
  );
  if (!letters.length) return;

  const schedule = () => {
    const wait = 9000 + Math.random() * 22000;
    window.setTimeout(() => {
      if (!document.hidden && !app?.hasAttribute('data-booting')) {
        const letter = letters[Math.floor(Math.random() * letters.length)];
        const dur = 320 + Math.random() * 420;
        letter.style.setProperty('--buzz-dur', `${Math.round(dur)}ms`);
        letter.classList.add('buzz');
        window.setTimeout(() => letter.classList.remove('buzz'), dur + 40);
      }
      schedule();
    }, wait);
  };

  schedule();
}

function cancelBootTimeouts() {
  bootTimeouts.forEach(clearTimeout);
  bootTimeouts = [];
}

function removeSkipListeners() {
  SKIP_EVENTS.forEach((type) => window.removeEventListener(type, skipBoot));
}

function ensureGridIgnited() {
  if (gridIgnited) return;
  sceneApi?.igniteGrid();
  gridIgnited = true;
}

function finishBoot() {
  if (bootFinished) return;
  bootFinished = true;

  cancelBootTimeouts();
  removeSkipListeners();
  ensureGridIgnited();

  bootOverlay?.classList.add('done');
  app?.removeAttribute('data-booting');
  document.body.dataset.stage = '4';

  try {
    sessionStorage.setItem('booted', '1');
  } catch {
    /* storage unavailable */
  }
}

function skipBoot() {
  finishBoot();
}

function setupSkipListeners() {
  SKIP_EVENTS.forEach((type) => {
    window.addEventListener(type, skipBoot, { passive: true });
  });
}

function scheduleStage(stage, delayMs) {
  bootTimeouts.push(
    setTimeout(() => {
      document.body.dataset.stage = String(stage);
    }, delayMs),
  );
}

function runBootSequence() {
  igniteLetters();

  if (REDUCED || REPLAY) {
    finishBoot();
    return;
  }

  setupSkipListeners();

  scheduleStage(1, 0);

  bootTimeouts.push(
    setTimeout(() => {
      document.body.dataset.stage = '2';
      ensureGridIgnited();
    }, 420),
  );

  scheduleStage(3, 1180);
  scheduleStage(4, 2150);
  bootTimeouts.push(setTimeout(finishBoot, 3200));
}

function setupTilt() {
  if (REDUCED || !HOVER_CAPABLE) return;

  document.querySelectorAll('.project-card').forEach((card) => {
    let rafId = null;
    let latestEvent = null;

    const applyTilt = () => {
      rafId = null;
      if (!latestEvent) return;

      const rect = card.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = latestEvent.clientX - cx;
      const dy = latestEvent.clientY - cy;

      card.style.setProperty('--tilt-y', `${(dx / (rect.width / 2)) * 6}deg`);
      card.style.setProperty('--tilt-x', `${(-dy / (rect.height / 2)) * 6}deg`);
    };

    card.addEventListener('pointermove', (event) => {
      latestEvent = event;
      if (!rafId) rafId = requestAnimationFrame(applyTilt);
    });

    card.addEventListener('pointerleave', () => {
      latestEvent = null;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      card.style.setProperty('--tilt-x', '0deg');
      card.style.setProperty('--tilt-y', '0deg');
    });
  });
}

function setupScrollHint() {
  const hint = document.querySelector('.scroll-hint');
  const projects = document.getElementById('projects');
  if (!hint || !projects) return;

  hint.addEventListener('click', () => {
    projects.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' });
  });
}

function setupSound() {
  const toggle = document.getElementById('sound-toggle');
  if (!toggle) return;

  let soundOn = false;
  try {
    soundOn = localStorage.getItem('sound') === 'on';
  } catch {
    /* storage unavailable */
  }

  toggle.setAttribute('aria-pressed', String(soundOn));

  let ctx = null;
  let humGain = null;
  let lastBlipAt = 0;

  const persistSound = (enabled) => {
    try {
      localStorage.setItem('sound', enabled ? 'on' : 'off');
    } catch {
      /* storage unavailable */
    }
  };

  const buildHum = () => {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 220;

    const baseFreq = ctx.createConstantSource();
    baseFreq.offset.value = 220;
    baseFreq.start();

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.1;

    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 40;
    lfo.connect(lfoDepth);
    lfoDepth.connect(filter.frequency);
    baseFreq.connect(filter.frequency);
    lfo.start();

    humGain = ctx.createGain();
    humGain.gain.value = 0;

    const oscA = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscA.frequency.value = 55;

    const oscB = ctx.createOscillator();
    oscB.type = 'triangle';
    oscB.frequency.value = 110.5;

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(humGain);
    humGain.connect(ctx.destination);

    oscA.start();
    oscB.start();
  };

  const playPowerUpSweep = () => {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const bandpass = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    bandpass.type = 'bandpass';
    bandpass.frequency.value = 530;
    bandpass.Q.value = 2;

    osc.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(ctx.destination);

    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.35);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.05, now + 0.08);
    gain.gain.linearRampToValueAtTime(0, now + 0.35);

    osc.start(now);
    osc.stop(now + 0.36);
  };

  const rampHum = (target, duration) => {
    const now = ctx.currentTime;
    humGain.gain.cancelScheduledValues(now);
    humGain.gain.setValueAtTime(humGain.gain.value, now);
    humGain.gain.linearRampToValueAtTime(target, now + duration);
  };

  const enableSound = async () => {
    try {
      if (!ctx) {
        ctx = new AudioContext();
        buildHum();
      }

      if (ctx.state === 'suspended') await ctx.resume();
      rampHum(0.015, 1);
      playPowerUpSweep();
    } catch {
      /* audio unavailable */
    }
  };

  const disableSound = () => {
    try {
      if (!ctx || !humGain) return;

      rampHum(0, 0.4);
      window.setTimeout(() => {
        try {
          ctx?.suspend();
        } catch {
          /* audio unavailable */
        }
      }, 420);
    } catch {
      /* audio unavailable */
    }
  };

  const playCardBlip = () => {
    try {
      if (!soundOn || !ctx || ctx.state !== 'running') return;

      const nowMs = performance.now();
      if (nowMs - lastBlipAt < 90) return;
      lastBlipAt = nowMs;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(740, now);
      osc.frequency.exponentialRampToValueAtTime(620, now + 0.06);

      gain.gain.setValueAtTime(0.03, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.07);
    } catch {
      /* audio unavailable */
    }
  };

  toggle.addEventListener('click', () => {
    soundOn = !soundOn;
    toggle.setAttribute('aria-pressed', String(soundOn));
    persistSound(soundOn);

    if (soundOn) enableSound();
    else disableSound();
  });

  if (HOVER_CAPABLE) {
    document.querySelectorAll('.project-card').forEach((card) => {
      card.addEventListener('pointerenter', playCardBlip);
    });
  }
}

setupAmbientJitter();
runBootSequence();
setupTilt();
setupScrollHint();
setupSound();
setupTubeBuzz();
