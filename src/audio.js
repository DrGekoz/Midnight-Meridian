/* =============================================================================
   MIDNIGHT MERIDIAN — AUDIO ENGINE
   -----------------------------------------------------------------------------
   Four independent buses into one master:

       musicBus   synthesised  (Web Audio, no samples, works offline)
       rainBus    Pixabay clip (weather)
       ambBus     Pixabay clip (season / region)
       trainBus   synthesised  (chuff locked to the wheel phase)

   Two deliberate decisions:

   1. THE GRAPH IS BUILT ONCE. Theme changes only set oscillator parameters and
      swap which ambient buffer is playing. Rebuilding the graph on every theme
      click produced audible clicks and a GC spike every time.

   2. NOTHING STARTS WITHOUT A USER GESTURE. Browsers block autoplay, so the whole
      engine is constructed lazily on the first real interaction and the piece is
      silent (not broken) before that.
   ========================================================================== */
"use strict";

const Audio_ = (() => {
  let ctx = null;
  let master = null, comp = null;
  let musicBus = null, rainBus = null, ambBus = null, trainBus = null;
  let musicFilter = null, musicVerb = null;
  let musicWobble = null, musicWobbleGain = null;
  const gains = { master: 0, music: 0.8, rain: 0, amb: 0, train: 0.7 };
  const buffers = {};                 // slug -> AudioBuffer
  let music = null;                    // synth state
  let train = null;                    // train synth state
  let started = false;
  let muted = true;
  let currentAmb = null, currentRain = null;

  /* ------------------------------------------------------------- lifecycle */
  function ensure(){
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 24; comp.ratio.value = 3.2;
    comp.attack.value = 0.006; comp.release.value = 0.22;
    master = ctx.createGain(); master.gain.value = 0;
    comp.connect(master); master.connect(ctx.destination);
    for (const n of ["music","rain","amb","train"]){
      const g = ctx.createGain();
      g.gain.value = gains[n];
      g.connect(comp);
      ({music:musicBus, rain:rainBus, amb:ambBus, train:trainBus})[n] = g;
    }
    /* music runs through a shared lowpass so weather darkens the music itself.
       Q is raised to ~1.6 so the cutoff has a resonant "tape" shoulder instead of
       a clinical brick wall — that resonance is most of the lo-fi character. */
    musicFilter = ctx.createBiquadFilter();
    musicFilter.type = "lowpass"; musicFilter.frequency.value = 2600; musicFilter.Q.value = 1.6;

    /* TAPE WOBBLE: a very slow LFO on detune. Tape speed drifts by a fraction of
       a percent; at 0.6 Hz with +-7 cents it is felt as "warm and unsteady"
       rather than as a vibrato. Built with an oscillator, not a JS timer, so it
       does not depend on the main thread staying responsive. */
    musicWobble = ctx.createOscillator();
    musicWobble.frequency.value = 0.6;
    musicWobbleGain = ctx.createGain();
    musicWobbleGain.gain.value = 7;          // cents
    musicWobble.connect(musicWobbleGain);
    musicWobbleGain.connect(musicFilter.detune);
    musicWobble.start(0);
    /* cheap stereo-ish reverb: two feedback delays, no impulse response file */
    musicVerb = ctx.createGain(); musicVerb.gain.value = 0.30;
    for (const [d, g] of [[0.137, 0.32], [0.211, 0.26], [0.319, 0.20]]){
      const dl = ctx.createDelay(1.0); dl.delayTime.value = d;
      const fb = ctx.createGain(); fb.gain.value = g;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2600;
      musicVerb.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl);
      lp.connect(musicBus);
    }
    musicFilter.connect(musicBus);
    musicFilter.connect(musicVerb);
    return ctx;
  }

  async function start(){
    if (started){ if (ctx.state === "suspended") await ctx.resume(); return; }
    const c = ensure();
    if (!c) return;
    if (c.state === "suspended") await c.resume();
    started = true;
    music = createSynth(c, musicFilter);
    train = createTrain(c, trainBus);
    setMaster(muted ? 0 : gains.master);
  }

  /* ------------------------------------------------------------- utilities */
  function noiseBuffer(c, seconds){
    const n = Math.floor(c.sampleRate * seconds);
    const b = c.createBuffer(1, n, c.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++){ const w = Math.random()*2-1; last = (last + 0.02*w) / 1.02; d[i] = w*0.5 + last*2.5; }
    return b;
  }
  function loopSource(c, buf, gainNode, rate){
    const s = c.createBufferSource();
    s.buffer = buf; s.loop = true; s.playbackRate.value = rate || 1;
    s.connect(gainNode); s.start();
    return s;
  }
  function stopSource(s){ if (s){ try { s.stop(); } catch(e){} } }

  /* ------------------------------------------------- ambient + rain (files) */
  function b64ToBuf(b64){
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    /* decodeAudioData wants a promise-friendly ArrayBuffer; slice for Safari */
    return ctx.decodeAudioData(arr.buffer.slice(0));
  }
  async function loadAsset(slug, b64){
    if (!b64 || buffers[slug]) return buffers[slug];
    try { buffers[slug] = await b64ToBuf(b64); } catch(e){ buffers[slug] = null; }
    return buffers[slug];
  }
  function playAmb(slug){
    if (currentAmb === slug) return;
    stopSource(currentAmbSrc); currentAmbSrc = null; currentAmb = slug;
    if (!slug || !buffers[slug] || !ctx) return;
    currentAmbSrc = loopSource(ctx, buffers[slug], ambBus);
  }
  function playRain(slug){
    if (currentRain === slug) return;
    stopSource(currentRainSrc); currentRainSrc = null; currentRain = slug;
    if (!slug || !buffers[slug] || !ctx) return;
    currentRainSrc = loopSource(ctx, buffers[slug], rainBus);
  }
  let currentAmbSrc = null, currentRainSrc = null;

  /* =======================================================================
     SYNTHESISED MUSIC
     Look-ahead scheduler: a 25ms timer queues every note that starts inside the
     next 120ms window. This is the standard Web Audio pattern and is what keeps
     timing rock solid regardless of how busy the render loop is.
     ======================================================================= */
  function createSynth(c, out){
    const st = {
      cfg: { bpm:62, scale:[0,2,3,5,7,9,10], root:220, wave:"triangle", hatEvery:2,
             swing:0.10, padLevel:0.30, leadLevel:0.16, cutoff:2600 },
      next: 0, step: 0, timer: null, noise: null
    };
    st.noise = noiseBuffer(c, 1.0);

    /* ---------------------------------------------------------------------
       LO-FI CHARACTER BUS
       The difference between "a synth playing chords" and "lo-fi" is almost
       entirely this chain, modelled on the master strip described in
       madmonk13/modal-16: tape wobble, a resonant low-pass, vinyl crackle and
       a soft bus compressor. Everything is BUILT — no samples.

         signal: voices -> musicGain -> wobble(detune LFO) -> tapeLPF -> comp
                                                            -> lofiBus -> out
       ------------------------------------------------------------------- */
    st.lofiBus = c.createGain(); st.lofiBus.gain.value = 1;

    /* vinyl crackle: sparse, irregular clicks. A continuous hiss sounds like
       static, not vinyl, so the crackle level is modulated by a slow random
       walk built from an oscillator pair rather than a constant gain. */
    const crackleSrc = c.createBufferSource();
    crackleSrc.buffer = st.noise; crackleSrc.loop = true;
    const crackleBp = c.createBiquadFilter();
    crackleBp.type = 'bandpass'; crackleBp.frequency.value = 4200; crackleBp.Q.value = 0.7;
    const crackleGain = c.createGain(); crackleGain.gain.value = 0.012;
    /* two detuned LFOs on the crackle gain = irregular amplitude wander */
    for (const [f, amp] of [[0.7, 0.008], [3.1, 0.004]]){
      const lfo = c.createOscillator(); lfo.frequency.value = f;
      const lg = c.createGain(); lg.gain.value = amp;
      lfo.connect(lg); lg.connect(crackleGain.gain); lfo.start(0);
    }
    crackleSrc.connect(crackleBp); crackleBp.connect(crackleGain);
    crackleGain.connect(st.lofiBus);
    crackleSrc.start(0);

    /* surface hiss: a quieter, wider bed under the crackle */
    const hissSrc = c.createBufferSource();
    hissSrc.buffer = st.noise; hissSrc.loop = true;
    const hissLp = c.createBiquadFilter();
    hissLp.type = 'lowpass'; hissLp.frequency.value = 5200;
    const hissGain = c.createGain(); hissGain.gain.value = 0.010;
    hissSrc.connect(hissLp); hissLp.connect(hissGain); hissGain.connect(st.lofiBus);
    hissSrc.start(0);

    const scaleNote = (deg, oct) => {
      const n = st.cfg.scale[((deg % st.cfg.scale.length) + st.cfg.scale.length) % st.cfg.scale.length];
      const semis = n + 12 * (oct + Math.floor(deg / st.cfg.scale.length));
      return st.cfg.root * Math.pow(2, semis / 12);
    };

    function kick(at, g){
      const o = c.createOscillator(), gn = c.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(120, at);
      o.frequency.exponentialRampToValueAtTime(42, at + 0.11);
      gn.gain.setValueAtTime(0, at);
      gn.gain.linearRampToValueAtTime(g, at + 0.004);
      gn.gain.exponentialRampToValueAtTime(0.0001, at + 0.30);
      o.connect(gn); gn.connect(out); o.start(at); o.stop(at + 0.34);
    }
    function snare(at, g){
      const s = c.createBufferSource(); s.buffer = st.noise;
      const f = c.createBiquadFilter(); f.type="bandpass"; f.frequency.value=1900; f.Q.value=0.8;
      const gn = c.createGain();
      gn.gain.setValueAtTime(g, at);
      gn.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      s.connect(f); f.connect(gn); gn.connect(out); s.start(at); s.stop(at+0.2);
    }
    function hat(at, g, open){
      const s = c.createBufferSource(); s.buffer = st.noise;
      s.playbackRate.value = 2.2;
      const f = c.createBiquadFilter(); f.type="highpass"; f.frequency.value=7200;
      const gn = c.createGain();
      gn.gain.setValueAtTime(g, at);
      gn.gain.exponentialRampToValueAtTime(0.0001, at + (open?0.16:0.045));
      s.connect(f); f.connect(gn); gn.connect(out); s.start(at); s.stop(at+0.2);
    }
    function bass(at, dur, freq, g){
      const o = c.createOscillator(), o2 = c.createOscillator(), gn = c.createGain();
      const f = c.createBiquadFilter(); f.type="lowpass"; f.frequency.value=340; f.Q.value=6;
      o.type="sawtooth"; o2.type="sine";
      o.frequency.value = freq; o2.frequency.value = freq/2;
      gn.gain.setValueAtTime(0, at);
      gn.gain.linearRampToValueAtTime(g, at+0.02);
      gn.gain.setValueAtTime(g, at+dur*0.7);
      gn.gain.exponentialRampToValueAtTime(0.0001, at+dur);
      o.connect(f); o2.connect(f); f.connect(gn); gn.connect(out);
      o.start(at); o.stop(at+dur); o2.start(at); o2.stop(at+dur);
    }
    function pad(at, dur, freqs, g){
      for (const fq of freqs){
        for (const det of [-4, 4]){
          const o = c.createOscillator(), gn = c.createGain();
          o.type = st.cfg.wave; o.frequency.value = fq; o.detune.value = det;
          gn.gain.setValueAtTime(0, at);
          gn.gain.linearRampToValueAtTime(g, at + 0.18);
          gn.gain.setValueAtTime(g, at + dur*0.6);
          gn.gain.exponentialRampToValueAtTime(0.0001, at + dur);
          o.connect(gn); gn.connect(out); o.start(at); o.stop(at+dur);
        }
      }
    }
    function pluck(at, freq, g){
      /* Karplus-Strong-ish: a short noise excitation into a tuned delay loop */
      const s = c.createBufferSource(); s.buffer = st.noise;
      const dl = c.createDelay(0.05); dl.delayTime.value = 1 / freq;
      const fb = c.createGain(); fb.gain.value = 0.965;
      const gn = c.createGain();
      gn.gain.setValueAtTime(g, at);
      gn.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
      s.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(gn); gn.connect(out);
      s.start(at); s.stop(at + 0.06);
    }

    /* =======================================================================
       SCHEDULER — plays the composed SCORE, not an ad-hoc pattern.

       v2 generated notes inline with modulo arithmetic on a step counter
       (bass on steps 0/6/10, a "motif" from `(bar*3 + s16) % 7`). That produced
       something in-key but not arranged: no chord progression, no song form,
       no real groove. v3 composes the whole piece up front in music-theory.js and
       this just walks it.

       Lookahead scheduling: a timer fires every 25ms and schedules anything
       falling inside the next 120ms window, so note timing comes from the
       AudioContext clock (sample-accurate) rather than from setInterval jitter.
       ===================================================================== */
    function schedule(){
      const spb = 60 / st.cfg.bpm / 4;              // 16th note, seconds
      const horizon = c.currentTime + 0.12;
      while (st.next < horizon){
        /* which 16th step are we on, in score coordinates? */
        const absStep = Math.floor(st.next / spb + 1e-9);
        const bar = Math.floor(absStep / 16);
        const s16 = absStep % 16;
        /* swing: delay every odd 16th */
        const sw = (s16 % 2 === 1) ? spb * st.cfg.swing : 0;
        const at = st.next + sw;

        /* wrap the bar pointer past the end of the piece into an infinite loop */
        if (bar >= st.score.totalBars) bar -= st.score.totalBars;
        const scBar = st.score.chords[bar];

        if (scBar){
          /* --- CHORD: pad on the downbeat, voiced from the chord tones */
          if (s16 === 0){
            const tones = scBar.tones.map(s => st.root * Math.pow(2, s / 12));
            pad(at, spb * 15, tones, st.cfg.padLevel * 0.16 * (0.4 + scBar.density));
          }
          /* --- BASS: root, plus the fifth on the and-of-3 when the section has
                 enough density to carry it */
          for (const b of st.barBass[bar]){
            if (b.step === s16)
              bass(at, spb * b.dur, st.root * Math.pow(2, b.semis / 12), b.gain);
          }
          /* --- LEAD: motif notes that fall on this step */
          for (const n of st.barLead[bar]){
            if (n.step === s16)
              pluck(at, st.root * Math.pow(2, n.semis / 12), n.gain);
          }
        }
        /* --- DRUMS from the groove mask, gated by section density */
        for (const d of st.barDrums[bar]){
          if (d.step === s16){
            if (d.voice === 'kick')  kick(at, d.gain);
            else if (d.voice === 'snare') snare(at, d.gain);
            else hat(at, d.gain, s16 === 14);
          }
        }
        st.next += spb;
      }
    }
    st.timer = setInterval(schedule, 25);
    st.setStyle = (cfg) => {
      const wasBpm = st.cfg.bpm;
      st.cfg = { ...st.cfg, ...cfg };
      /* recompose if the musical parameters changed, and re-derive the lookup */
      if (cfg.bpm !== undefined && cfg.bpm !== wasBpm) st.rebuild(cfg);
      else if (cfg.scale || cfg.root || cfg.mood || cfg.seed !== undefined) st.rebuild(cfg);
      if (musicFilter) musicFilter.frequency.setTargetAtTime(cfg.cutoff, ctx.currentTime, 0.12);
    };
    st.setVerb = (w) => { if (musicVerb) musicVerb.gain.setTargetAtTime(w, ctx.currentTime, 0.15); };

    /* Build (or rebuild) the score and its per-bar index. Recomposing on every
       style change keeps the seed fixed so a given theme always sounds the same. */
    st.rebuild = (cfg) => {
      const merged = { ...st.cfg, ...(cfg || {}) };
      st.score = compose({
        seed:      merged.seed,
        mood:      merged.mood  || 'lofi',
        scale:     merged.scale || 'dorian',
        root:      merged.root  || 220,
        form:      merged.form  || 'standard',
        groove:    merged.groove || 'lofi',
        bpm:       merged.bpm || 84,
        swing:     merged.swing !== undefined ? merged.swing : 0.14
      });
      st.root = st.score.root;
      st.barBass  = {}; st.barLead = {}; st.barDrums = {};
      for (const b of st.score.bass)  (st.barBass[b.bar]  = st.barBass[b.bar]  || []).push(b);
      for (const l of st.score.lead)  (st.barLead[l.bar]  = st.barLead[l.bar]  || []).push(l);
      for (const d of st.score.drums) (st.barDrums[d.bar] = st.barDrums[d.bar] || []).push(d);
      for (let i = 0; i < st.score.totalBars; i++){
        st.barBass[i]  = st.barBass[i]  || [];
        st.barLead[i]  = st.barLead[i]  || [];
        st.barDrums[i] = st.barDrums[i] || [];
      }
    };
    st.rebuild();
    schedule();
    return st;
  }

  /* =======================================================================
     SYNTHESISED TRAIN
     The running gear turns at 3.2 phase-steps/second, so the chuff rate is
     derived from the SAME constant the renderer uses. That is why this is
     synthesised rather than sampled: a looped sample can never lock to the
     wheels, and being 1-2% out of phase is instantly audible as "wrong".
     ======================================================================= */
  function createTrain(c, out){
    const st = { noise: null, rumble: null, chuffAt: 0, on: false };
    st.noise = noiseBuffer(c, 1.0);
    /* continuous low rumble: two detuned saws through a steep lowpass */
    const lp = c.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=150; lp.Q.value=3;
    const rg = c.createGain(); rg.gain.value = 0.0;
    for (const f of [41, 55, 82.5]){
      const o = c.createOscillator(); o.type="sawtooth"; o.frequency.value=f;
      o.connect(lp); o.start();
    }
    /* rail hiss: filtered noise bed */
    const hs = c.createBufferSource(); hs.buffer = st.noise; hs.loop = true;
    const hf = c.createBiquadFilter(); hf.type="bandpass"; hf.frequency.value=2400; hf.Q.value=0.6;
    const hg = c.createGain(); hg.gain.value = 0.0;
    hs.connect(hf); hf.connect(hg); hg.connect(out); hs.start();
    lp.connect(rg); rg.connect(out);
    st.rumbleGain = rg; st.hissGain = hg;
    st.setLevel = (v) => {
      if (!ctx) return;
      rg.gain.setTargetAtTime(v * 0.16, ctx.currentTime, 0.25);
      hg.gain.setTargetAtTime(v * 0.035, ctx.currentTime, 0.25);
    };
    /* one chuff: filtered noise burst with a fast decay */
    st.chuff = (at, g) => {
      const s = c.createBufferSource(); s.buffer = st.noise;
      s.playbackRate.value = 0.8 + Math.random()*0.3;
      const f = c.createBiquadFilter(); f.type="bandpass"; f.frequency.value=520; f.Q.value=1.1;
      const gn = c.createGain();
      gn.gain.setValueAtTime(0, at);
      gn.gain.linearRampToValueAtTime(g, at + 0.012);
      gn.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      s.connect(f); f.connect(gn); gn.connect(out); s.start(at); s.stop(at+0.2);
    };
    st.tick = (now) => {
      if (!ctx || gains.train <= 0.001) return;
      const period = 0.3125;                     // 2 chuffs per wheel phase-step
      if (st.chuffAt === 0) st.chuffAt = now + 0.05;
      while (st.chuffAt < now + 0.12){
        st.chuff(st.chuffAt, 0.16 * gains.train);
        st.chuffAt += period;
      }
    };
    return st;
  }

  /* ------------------------------------------------------------------ gains */
  function setGain(name, v){
    gains[name] = v;
    if (!ctx) return;
    const map = { master, music:musicBus, rain:rainBus, amb:ambBus, train:trainBus };
    const node = map[name];
    if (!node) return;
    const target = (name === "master" && muted) ? 0 : v;
    node.gain.setTargetAtTime(target, ctx.currentTime, 0.05);
  }
  function setMaster(v){ setGain("master", v); }
  function toggleMute(){
    muted = !muted;
    if (master) master.gain.setTargetAtTime(muted ? 0 : gains.master, ctx.currentTime, 0.05);
    return muted;
  }
  function setStyle(cfg){ if (music) music.setStyle(cfg); }
  function setVerb(w){ if (music) music.setVerb(w); }
  function tick(now){ if (train) train.tick(now); }
  /* Restore a saved gain set in one go. Unknown keys are ignored rather than
     throwing, so a stale saved state can never wedge the audio graph. */
  function setGains(obj){
    if (!obj) return;
    for (const k in obj){
      const v = obj[k];
      if (typeof v === "number" && isFinite(v) && v >= 0 && v <= 1) setGain(k, v);
    }
  }

  return {
    ensure, start, loadAsset, playAmb, playRain,
    setGain, setGains, setMaster, toggleMute, setStyle, setVerb, tick,
    get started(){ return started; },
    get muted(){ return muted; },
    get gains(){ return gains; },
    get bufferCount(){ return Object.keys(buffers).length; },
    hasBuffer: (s) => !!buffers[s]
  };
})();
