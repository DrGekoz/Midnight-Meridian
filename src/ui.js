/* =============================================================================
   MIDNIGHT MERIDIAN — UI
   Built to DESIGN.md. Six components, no framework, no build step, no CDN.
   The piece is the art; this is a remote control for it, collapsed by default.
   ========================================================================== */
"use strict";

const UI = (() => {
  const $ = (s, r) => (r || document).querySelector(s);
  const el = {};
  let open = false, lastFocus = null, themeId = DEFAULT_THEME, seasonId = "summer";

  /* Inline SVG glyphs. Never emoji (DESIGN.md: no emoji as iconography) and
     every glyph is aria-hidden because the button text already names it. */
  const ICON = {
    sliders: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12"/><circle cx="5" cy="4" r="1.6" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r="1.6" fill="currentColor" stroke="none"/><circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>',
    sound:   '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><path d="M3 6v4h2.5L9 13V3L5.5 6H3z" fill="currentColor" stroke="none"/><path d="M11 6.2a3 3 0 0 1 0 3.6M13 4.4a6 6 0 0 1 0 7.2"/></svg>',
    mute:    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><path d="M3 6v4h2.5L9 13V3L5.5 6H3z" fill="currentColor" stroke="none"/><path d="M11.5 6.5l3 3M14.5 6.5l-3 3"/></svg>',
    close:   '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>'
  };

  const SECTIONS = [
    { id:"style",   label:"Style",   opts:[["midnight","Midnight"],["cyberpunk","Cyberpunk"],["japan","Japan"]] },
    { id:"tod",     label:"Time",    opts:[["night","Night"],["day","Day"]] },
    { id:"weather", label:"Weather", opts:[["clear","Clear"],["cloudy","Cloudy"],["rain","Rain"],["snow","Snow"]] },
    { id:"season",  label:"Season",  opts:[["spring","Spring"],["summer","Summer"],["autumn","Autumn"],["winter","Winter"]] }
  ];
  const SLIDERS = [
    ["master", "Master"], ["music", "Music"], ["rain", "Rain"],
    ["amb", "Ambience"], ["train", "Train"]
  ];

  function build(){
    el.root = document.getElementById("panel");
    el.body = document.getElementById("panel-body");
    el.btn  = document.getElementById("menu-btn");
    el.mute = document.getElementById("mute-btn");
    el.live = document.getElementById("live");
    el.sliders = {};

    for (const s of SECTIONS){
      const fs = document.createElement("fieldset");
      fs.className = "grp";
      const lg = document.createElement("legend");
      lg.textContent = s.label;
      fs.appendChild(lg);
      const row = document.createElement("div");
      row.className = "seg";
      row.setAttribute("role", "radiogroup");
      row.setAttribute("aria-label", s.label);
      for (const [val, text] of s.opts){
        const b = document.createElement("button");
        b.type = "button"; b.className = "seg-b"; b.textContent = text;
        b.dataset.group = s.id; b.dataset.value = val;
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", "false");
        b.tabIndex = -1;
        row.appendChild(b);
      }
      fs.appendChild(row);
      el.body.appendChild(fs);
    }

    const af = document.createElement("fieldset");
    af.className = "grp";
    const al = document.createElement("legend");
    al.textContent = "Audio";
    af.appendChild(al);
    for (const [id, label] of SLIDERS){
      const wrap = document.createElement("div");
      wrap.className = "sl";
      const lab = document.createElement("label");
      lab.htmlFor = "sl-" + id;
      lab.textContent = label;
      const inp = document.createElement("input");
      inp.type = "range"; inp.id = "sl-" + id; inp.min = "0"; inp.max = "100";
      inp.value = String(Math.round((Audio_.gains[id] || 0) * 100));
      const out = document.createElement("output");
      out.htmlFor = "sl-" + id;
      out.textContent = inp.value;
      inp.addEventListener("input", () => {
        const v = Number(inp.value) / 100;
        out.textContent = inp.value;
        if (id === "master") Audio_.setMaster(v);
        else Audio_.setGain(id, v);
        if (id !== "master" && Audio_.muted && v > 0) unmute();
      });
      el.sliders[id] = { input: inp, out };
      wrap.append(lab, inp, out);
      af.appendChild(wrap);
    }
    el.body.appendChild(af);

    el.body.addEventListener("click", (e) => {
      const b = e.target.closest(".seg-b");
      if (!b) return;
      select(b.dataset.group, b.dataset.value);
    });

    el.btn.addEventListener("click", () => toggle());
    el.mute.addEventListener("click", () => { Audio_.toggleMute(); syncMute(); announce(Audio_.muted ? "Muted" : "Unmuted"); });
    el.root.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) toggle(false); });

    /* keyboard: Escape closes, arrows move within a radiogroup */
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && open){ e.preventDefault(); toggle(false); return; }
      const b = document.activeElement;
      if (b && b.classList && b.classList.contains("seg-b")){
        const sibs = Array.from(b.parentNode.querySelectorAll(".seg-b"));
        const i = sibs.indexOf(b);
        if (e.key === "ArrowRight" || e.key === "ArrowDown"){
          e.preventDefault(); const n = sibs[(i+1)%sibs.length]; n.focus(); select(n.dataset.group, n.dataset.value);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp"){
          e.preventDefault(); const n = sibs[(i-1+sibs.length)%sibs.length]; n.focus(); select(n.dataset.group, n.dataset.value);
        }
      }
    });

    document.getElementById('icon-btn').innerHTML = ICON.sliders;
    el.mute.innerHTML = ICON.mute;
    /* Defensive: a missing close button must not abort boot. The panel still
       closes via Escape and via the menu button toggling it shut. */
    const closeBtn = el.root && el.root.querySelector ? el.root.querySelector("[data-close]") : null;
    if (closeBtn) closeBtn.innerHTML = ICON.close;
    syncMute(); applyState();
  }

  function select(group, value){
    if (group === "season") seasonId = value; else {
      const cur = THEME_BY_ID[themeId];
      themeId = `${value}-${cur.tod}-${cur.weather}`;
    }
    applyState();
    const label = SECTIONS.find(s => s.id === group).opts.find(o => o[0] === value)[1];
    announce(label);
    onChange && onChange();
  }
  let onChange = null;

  function applyState(){
    const th = THEME_BY_ID[themeId];
    const sel = { style: th.style, tod: th.tod, weather: th.weather, season: seasonId };
    for (const b of el.body.querySelectorAll(".seg-b")){
      const on = sel[b.dataset.group] === b.dataset.value;
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.classList.toggle("on", on);
      b.tabIndex = on ? 0 : -1;
    }
  }
  function announce(msg){ if (el.live) el.live.textContent = msg; }
  function syncMute(){
    el.mute.innerHTML = Audio_.muted ? ICON.mute : ICON.sound;
    el.mute.setAttribute("aria-pressed", String(Audio_.muted));
    el.mute.setAttribute("aria-label", Audio_.muted ? "Unmute audio" : "Mute audio");
  }
  function unmute(){
    if (Audio_.muted){ Audio_.toggleMute(); syncMute(); }
  }

  function toggle(force){
    const want = force === undefined ? !open : force;
    if (want === open) return;
    open = want;
    el.root.classList.toggle("open", open);
    el.btn.setAttribute("aria-expanded", String(open));
    if (open){
      lastFocus = document.activeElement;
      const first = el.body.querySelector('.seg-b[tabindex="0"]') || el.body.querySelector("input");
      if (first) first.focus();
    } else if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function setSlider(id, pct){
    const s = el.sliders[id];
    if (!s) return;
    s.input.value = String(pct); s.out.textContent = String(pct);
  }

  return { build, toggle, select, applyState, setSlider, announce,
           get open(){ return open; },
           get theme(){ return themeId; },
           get season(){ return seasonId; },
           set onChange(f){ onChange = f; } };
})();
