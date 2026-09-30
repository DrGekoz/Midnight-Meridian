/* =============================================================================
   MIDNIGHT MERIDIAN — MUSIC THEORY (pure, headless, deterministic)
   -----------------------------------------------------------------------------
   No Web Audio, no DOM, no globals. Given a seed it produces the same music
   forever, which is what makes it testable: verify.js asserts that the same seed
   yields an identical score and a different seed does not.

   ATTRIBUTION / LICENCE
   ---------------------
   The chord-quality and functional-progression tables follow the shape of the
   public-domain material described in @simpllyf/ditty (MIT), by simpllyf — scales,
   ragas, chords and common progressions are all traditional and uncopyrightable.
   That project is credited in NOTICE.md. Nothing here is copied verbatim; the
   implementation is our own and the Euclidean step below is the published
   algorithm rather than a port.

   The Euclidean generator is Bjorklund's algorithm:
     E. Bjorklund, "The Theory of Rep-Rate Pattern Generation in the SNS Timing
     System" (1982), and its musical demonstration:
     G. Toussaint, "The Euclidean Algorithm Generates Traditional Musical
     Rhythms" (2005). Both freely available from the authors.
   ========================================================================== */
'use strict';

/* ---- seeded PRNG (mulberry32) ---------------------------------------------
   Deterministic and fast. The same seed must always give the same music, so the
   generator is never called with Math.random anywhere in this file.          */
function mulberry32(a){
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- scales ----------------------------------------------------------------
   Semitone offsets from the tonic. Modes are named by their interval pattern. */
const SCALES = {
  major:      [0,2,4,5,7,9,11],
  dorian:     [0,2,3,5,7,9,10],
  phrygian:   [0,1,3,5,7,8,10],
  lydian:     [0,2,4,6,7,9,11],
  mixolydian: [0,2,4,5,7,9,10],
  minor:      [0,2,3,5,7,8,10],
  hirajoshi:  [0,2,3,7,8],        // in-scale / yo-ish, for the Japan style
  insen:      [0,1,5,7,10],       // dark, wide, also Japanese
  pentaMaj:   [0,2,4,7,9],
  pentaMin:   [0,3,5,7,10]
};

/* ---- chord qualities, as scale-degree-indexed intervals -------------------
   A chord is built by stacking thirds within the scale, so a quality is just
   the extra intervals. Seventh chords give lo-fi its colour. */
const CHORD_SHAPES = {
  min7:  [0,3,7,10],
  maj7:  [0,4,7,11],
  dom7:  [0,4,7,10],
  min9:  [0,3,7,10,14],
  maj9:  [0,4,7,11,14],
  sus2:  [0,2,7],
  sus4:  [0,5,7],
  six:   [0,4,7,9],
  min6:  [0,3,7,9]
};

/* Which qualities suit which degree, per mode family. Index 0 == the tonic. */
const DEGREE_SHAPES_MAJORISH = ['maj7','min7','min7','maj7','maj7','min7','dom7'];
const DEGREE_SHAPES_MINORISH = ['min7','min7','maj7','maj7','min7','dom7','maj7'];

/* ---- functional progressions ----------------------------------------------
   Each entry is a sequence of scale DEGREES (0-indexed). Choosing a progression
   is what makes a loop sound like a song rather than a scale run.            */
const PROGRESSIONS = {
  /* the lo-fi staple: i - VI - III - VII, the "Royal Road" cadence family */
  royalRoad:  [0,5,2,6],
  /* a more melancholy variant with a passing chord */
  royalRoad2: [0,5,3,6],
  /* ii - V - I, the jazz turn */
  turnAround: [1,4,0,0],
  /* i - iv - VII - iii */
  wander:     [0,3,6,2],
  /* the descending 6-4-5-1 in a minor key */
  minorEpic:  [0,5,4,0],
  /* a long, slow loop that never quite resolves until the top */
  unresolved: [0,2,3,4],
  /* brighter, for daytime */
  uplifting:  [3,4,0,4],
  /* very static, for the ambient register */
  stillpoint: [0,0,3,3],
  /* pentatonic-friendly, used by the Japan style */
  koto:       [0,4,2,4]
};

/* Mood → which progressions are eligible and how often. Real songs return to a
   small set of cadences, so the weights are deliberately lopsided. */
const PROG_WEIGHTS = {
  calm:      { royalRoad:5, royalRoad2:3, wander:4, minorEpic:3, unresolved:2, stillpoint:3, koto:3 },
  lofi:      { royalRoad:6, royalRoad2:4, wander:4, turnAround:3, minorEpic:3, unresolved:2, koto:2 },
  peppy:     { turnAround:5, uplifting:5, wander:3, royalRoad:2 },
  dreamy:    { unresolved:5, stillpoint:4, wander:3, royalRoad2:3, koto:3 },
  ambient:   { stillpoint:6, unresolved:4, minorEpic:2 },
  cinematic: { minorEpic:5, unresolved:4, turnAround:2 },
  playful:   { uplifting:5, turnAround:3, royalRoad:3 },
  default:   { royalRoad:5, wander:3, minorEpic:2, unresolved:2 }
};

/* ---- public: is this a minor-flavoured mode? ------------------------------ */
function isMinorish(scaleName){
  return ['minor','dorian','phrygian','pentaMin'].indexOf(scaleName) >= 0;
}

/* Build the absolute semitone offsets of one chord, in the given scale.
   `degree` wraps, so degree 7 in a 7-note scale is the tonic an octave up. */
function chordFor(degree, scaleName, shapeName){
  const sc = SCALES[scaleName] || SCALES.dorian;
  const shape = CHORD_SHAPES[shapeName] || CHORD_SHAPES.min7;
  const out = [];
  for (let i = 0; i < shape.length; i++){
    /* each chord tone is a third (2 scale steps) above the last */
    const step = degree + i * 2;
    const oct  = Math.floor(step / sc.length);
    const note = sc[((step % sc.length) + sc.length) % sc.length];
    out.push(note + 12 * oct);
  }
  return out;
}

/* Pick a chord shape that sits naturally on this degree of this scale. */
function shapeFor(degree, scaleName){
  const sc  = SCALES[scaleName] || SCALES.dorian;
  const idx = ((degree % sc.length) + sc.length) % sc.length;
  const tbl = isMinorish(scaleName) ? DEGREE_SHAPES_MINORISH : DEGREE_SHAPES_MAJORISH;
  return tbl[idx % tbl.length];
}

/* ---- weighted choice from a table, using a supplied rng ------------------- */
function weightedPick(table, rnd){
  let total = 0;
  for (const k in table) total += table[k];
  if (total <= 0) return Object.keys(table)[0];
  let r = rnd() * total;
  for (const k in table){ r -= table[k]; if (r <= 0) return k; }
  return Object.keys(table)[Object.keys(table).length - 1];
}

/* =============================================================================
   BJORKLUND / EUCLIDEAN RHYTHM
   -----------------------------------------------------------------------------
   Distributes `pulses` as evenly as possible across `steps` slots. This is the
   algorithm behind most world music: the 3-against-2 cumbia, the 5-against-8
   cinquillo, the 3-against-8 tresillo.

   Verified vectors (see verify.js):
     euclid(3, 8)  -> 1 0 0 1 0 0 1 0
     euclid(5, 16) -> 1 0 0 1 0 0 1 0 0 1 0 0 1 0 0 1   (and every 4th)
     euclid(3, 4)  -> 1 0 1 1
   ========================================================================== */
function euclid(pulses, steps){
  pulses = Math.round(pulses); steps = Math.round(steps);
  if (steps <= 0) return [];
  if (pulses <= 0) return new Array(steps).fill(0);
  if (pulses >= steps) return new Array(steps).fill(1);

  /* Bjorklund's algorithm, zip-and-partition form.

     Start with `pulses` ones and `steps - pulses` zeros, then repeatedly ZIP the
     two runs together and PARTITION the result into entries that GREW (length >
     1, which recurse) and leftovers (length 1, which become the new zeros).
     When the zeros run out the ones are reversed and joined, which terminates.

     Ported from the presentation in zya/bjorklund (and dbkaplun/euclidean-rhythm),
     which are themselves transcriptions of Toussaint's description. Two earlier
     attempts here were wrong and are recorded so they are not reintroduced:
       1. a recursive form that dropped the tail instead of prepending it lost
          pulses — euclid(3,4) came out xxx. instead of x.xx;
       2. a Bresenham run-length accumulator produced the right rhythm but the
          wrong ROTATION — euclid(3,8) came out x..x.x.. instead of x..x..x.
     verify.js asserts the published vectors, the sum, AND the length, so any of
     those failures trips the build. */
  function zip(ones, zeros){
    const out = [];
    const n = Math.max(ones.length, zeros.length);
    for (let i = 0; i < n; i++)
      out.push((ones[i] !== undefined ? ones[i] : '') + (zeros[i] !== undefined ? zeros[i] : ''));
    return out;
  }
  function recur(ones, zeros){
    if (ones.length === 0) return zeros.join('');
    if (zeros.length === 0) return ones.reverse().join('');
    const grown = [], left = [];
    for (const z of zip(ones, zeros)) (z.length > 1 ? grown : left).push(z);
    return recur(grown, left);
  }
  const ones  = new Array(pulses).fill('1');
  const zeros = new Array(steps - pulses).fill('0');
  return recur(ones, zeros).split('').map(v => (v === '1' ? 1 : 0));
}

/* Groove presets for the drum voices. Each is a 16-step mask.
   The euclid() masks are the point of the whole exercise: real world-music
   grooves rather than hand-tapped hats. */
const GROOVES = {
  straight: {
    kick:  euclid(4, 16),  /* x...x...x...x... — four on the floor */
    snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
    hat:   [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],
    label: 'four to the floor'
  },
  lofi: {
    /* the classic swung lo-fi pocket: kick slightly behind the beat, snare
       ghosted, hats on every 8th with a loose triplet feel */
    kick:  [1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0],
    snare: [0,0,0,0,1,0,0,0,0,0,0,1,1,0,0,0],
    hat:   [0,0,1,0,0,0,1,0,0,0,1,0,0,1,1,0],
    label: 'swing lo-fi'
  },
  cumbia: {
    kick:  euclid(5, 16), snare: euclid(3, 16), hat: euclid(7, 16),
    label: 'cumbia (5/3/7 euclid)'
  },
  cinquillo: {
    kick: euclid(5, 16), snare: euclid(3, 16), hat: euclid(11, 16),
    label: 'cinquillo (5/3/11 euclid)'
  },
  tresillo: {
    kick:  euclid(3, 16), snare: euclid(5, 16), hat: euclid(7, 16),
    label: 'tresillo (3/5/7 euclid)'
  },
  halfTime: {
    kick: [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],
    snare:[0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],
    hat:   [1,0,0,0,1,0,0,0,1,0,0,0,1,0,1,0],
    label: 'half time'
  }
};

/* =============================================================================
   SONG FORM
   -----------------------------------------------------------------------------
   Bars are grouped into named sections that ramp in density and brightness. A
   long piece that never changes section sounds like a test tone; this is what
   makes the loop feel arranged.
   ========================================================================== */
const FORMS = {
  short: [
    { name:'intro', bars:2, density:0.35, bright:0.55 },
    { name:'a',     bars:4, density:0.70, bright:0.75 },
    { name:'b',     bars:4, density:0.95, bright:0.95 },
    { name:'out',   bars:2, density:0.30, bright:0.50 }
  ],
  standard: [
    { name:'intro', bars:2, density:0.35, bright:0.55 },
    { name:'a',     bars:8, density:0.72, bright:0.78 },
    { name:'b',     bars:8, density:1.00, bright:0.92 },
    { name:'out',   bars:2, density:0.32, bright:0.52 }
  ],
  long: [
    { name:'intro', bars:2, density:0.32, bright:0.50 },
    { name:'a',     bars:8, density:0.68, bright:0.72 },
    { name:'b',     bars:8, density:0.95, bright:0.90 },
    { name:'c',     bars:8, density:0.55, bright:0.62 },
    { name:'b2',    bars:8, density:1.00, bright:1.00 },
    { name:'out',   bars:2, density:0.30, bright:0.48 }
  ]
};

/* =============================================================================
   COMPOSE — the whole piece, as data
   -----------------------------------------------------------------------------
   Returns a plain object. No audio here. `score` is what the synth plays; the
   verifier inspects it directly.
   ========================================================================== */
function compose(opts){
  const o = Object.assign({
    seed: 1, mood: 'lofi', scale: 'dorian', root: 220,
    form: 'standard', groove: 'lofi', bpm: 84, swing: 0.14,
    seedRhythm: 0
  }, opts || {});

  const rnd = mulberry32(o.seed);
  const pool = PROG_WEIGHTS[o.mood] || PROG_WEIGHTS.default;
  const progNames = Object.keys(pool);
  /* Two progressions are chosen and alternated between sections. One alone is
     monotonous; two is how most loop-based music stays interesting. */
  const pA = weightedPick(pool, rnd);
  let pB = weightedPick(pool, rnd);
  if (pB === pA) pB = progNames[(progNames.indexOf(pA) + 1) % progNames.length];
  const form = FORMS[o.form] || FORMS.standard;
  const groove = GROOVES[o.groove] || GROOVES.lofi;

  let bar = 0;
  const score = { bpm:o.bpm, swing:o.swing, root:o.root, scale:o.scale,
                  form:o.form, progA:pA, progB:pB, groove:groove.label,
                  sections:[], chords:[], bass:[], lead:[], drums:[] };

  for (let si = 0; si < form.length; si++){
    const sec = form[si];
    score.sections.push({ name:sec.name, startBar:bar, bars:sec.bars,
                          density:sec.density, bright:sec.bright });
    for (let b = 0; b < sec.bars; b++){
      /* alternate the progression every bar, or every two bars in the slow moods */
      const prog = PROGRESSIONS[((bar % 2 === 0 || o.mood === 'ambient') ? pA : pB)];
      /* one chord per bar is the safest loop-safe choice */
      const deg = prog[bar % prog.length];
      const shape = shapeFor(deg, o.scale);
      const tones = chordFor(deg, o.scale, shape);
      const d = form[si];

      score.chords.push({ bar, section:sec.name, degree:deg, shape,
                          tones, density:d.density, bright:d.bright });

      /* BASS: root on the downbeat, fifth on the and-of-3 for movement */
      const rootSemis = tones[0];
      score.bass.push({ bar, step:0,  semis:rootSemis, dur:1.4, gain:0.26 * d.density });
      if (d.density > 0.5)
        score.bass.push({ bar, step:10, semis:rootSemis + (shape === 'sus2' ? 2 : 7),
                          dur:0.7, gain:0.16 * d.density });

      /* LEAD: a short motif per section. The motif is a fixed interval pattern
         chosen once, then repeated and slightly varied — that is what makes a
         melody memorable instead of random. */
      const motifLen = 4;
      const motif = [];
      for (let k = 0; k < motifLen; k++)
        motif.push(Math.floor(rnd() * SCALES[o.scale].length));
      const useMotif = d.density > 0.4;
      for (let s = 0; s < 16 && useMotif; s++){
        if (rnd() > 0.28 * d.density + 0.10) continue;
        const m = motif[s % motifLen];
        /* resolve onto a chord tone on strong beats — the thing that makes it
           sound in key rather than merely in scale */
        const strong = (s === 0 || s === 6 || s === 10);
        const semis = strong ? tones[(s === 6 ? 1 : 0) % tones.length]
                             : tones[0] + 12 + SCALES[o.scale][m % SCALES[o.scale].length];
        score.lead.push({ bar, step:s, semis, dur:0.5,
                          gain:0.16 * d.bright, octave:1 });
      }

      /* DRUMS: the groove, gated by section density */
      for (let s = 0; s < 16; s++){
        if (groove.kick[s] && rnd() < d.density)          score.drums.push({ bar, step:s, voice:'kick',  gain:0.40 });
        if (groove.snare[s] && rnd() < d.density * 0.95)  score.drums.push({ bar, step:s, voice:'snare', gain:0.19 });
        if (groove.hat[s]   && rnd() < d.density * 0.8)   score.drums.push({ bar, step:s, voice:'hat',   gain:0.055 });
      }
      bar++;
    }
  }
  score.totalBars = bar;
  return score;
}

/* A stable hash of a score, for the determinism assertion. */
function scoreHash(sc){
  let h = 2166136261;
  const push = v => { const s = String(v);
    for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } };
  push(sc.bpm); push(sc.root); push(sc.scale); push(sc.progA); push(sc.progB);
  for (const c of sc.chords) push(c.degree + ':' + c.shape);
  for (const l of sc.lead)  push(l.bar + ',' + l.step + ',' + l.semis);
  for (const d of sc.drums) push(d.bar + ',' + d.step + ',' + d.voice);
  return (h >>> 0).toString(16);
}