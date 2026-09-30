/* Render a contact sheet of themes to PNG so the art can actually be reviewed.
   Uses the same VM harness as verify.js, then writes PNGs with node's zlib.

   node snap.js                                 -> 8-up theme sheet + a 3x hero
   node snap.js <theme> <season> <tSeconds> [scale] -> one frame, upscaled
*/
'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const zlib = require('zlib');

const CODE = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
               .match(/<script>([\s\S]*?)<\/script>/)[1] + `
;globalThis.__X = { render, fb, VW, VH, THEMES, SEASON, resolveTheme,
                    applyTheme, buildThemeStrips, setTheme, _cr, _cg, _cb };`;

function sandbox(){
  const ctxStub = { createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),
                    putImageData:()=>{} };
  const mk = (e) => Object.assign({ style:{}, dataset:{}, textContent:'', innerHTML:'',
    value:'50', addEventListener(){}, removeEventListener(){}, click(){}, focus(){},
    setAttribute(k,v){this[k]=v;}, getAttribute(k){return this[k];}, hasAttribute(k){return k in this;},
    getBoundingClientRect:()=>({x:0,y:0,width:320,height:480,top:0,left:0,right:320,bottom:480}),
    querySelector:()=>null, querySelectorAll:()=>[], appendChild(){}, closest:()=>null,
    append(){}, children:[], parentNode:null, firstChild:null }, e||{});
  const byId = { 'cv':mk({width:480,height:270,getContext:()=>ctxStub}), 'panel':mk(),
                 'panel-body':mk(), 'menu-btn':mk(), 'mute-btn':mk(), 'live':mk(),
                 'diag':mk(), 'icon-btn':mk() };
  const s = { document:{ documentElement:mk({requestFullscreen(){}}), fullscreenElement:null,
      exitFullscreen(){}, webkitExitFullscreen(){}, getElementById:id=>byId[id]||mk(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>mk(),
      addEventListener(){}, removeEventListener(){} },
    window:{ innerWidth:1920, innerHeight:1080, addEventListener(){}, removeEventListener(){} },
    performance:{ now:()=>Date.now() }, requestAnimationFrame:()=>1,
    atob: b => Buffer.from(b,'base64').toString('binary'),
    setInterval:()=>0, clearInterval:()=>{},
    Math, JSON, console, Buffer, Uint8Array, Uint8ClampedArray, Uint32Array,
    Float32Array, Float64Array, Int32Array, Array, Object, String, Number,
    isNaN, parseInt, parseFloat, Date };
  s.globalThis = s; vm.createContext(s);
  return s;
}

/* ---- minimal PNG writer (RGBA, filter 0, zlib deflate) -------------------- */
function crc32(buf){
  let c, t = crc32.t;
  if (!t){ t = crc32.t = []; for (let n = 0; n < 256; n++){ c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = t[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td  = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
/* px: Uint8ClampedArray RGBA at w*h*4 */
function writePNG(file, px, w, h){
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++){
    raw[y * (stride + 1)] = 0;                     // filter type: none
    for (let i = 0; i < stride; i++) raw[y * (stride + 1) + 1 + i] = px[y * stride + i];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]));
  return `${path.basename(file)} (${w}x${h}, ${(fs.statSync(file).size/1024).toFixed(0)} KB)`;
}

const sb = sandbox();
vm.runInContext(CODE, sb);
const X = sb.__X;
const VW = X.VW, VH = X.VH;

/* grab the current fb as an RGBA buffer, optionally nearest-upscaled */
function grab(scale){
  const w = VW * scale, h = VH * scale;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++){
    const sy = (y / scale) | 0;
    for (let x = 0; x < w; x++){
      const c = X.fb[sy * VW + ((x / scale) | 0)];
      const o = (y * w + x) * 4;
      out[o] = X._cr(c); out[o+1] = X._cg(c); out[o+2] = X._cb(c); out[o+3] = 255;
    }
  }
  return { out, w, h };
}

const arg = process.argv[2];
if (arg){
  const th = arg, se = process.argv[3] || 'summer';
  const tS = parseFloat(process.argv[4] || '7.5');
  const sc = parseInt(process.argv[5] || '3', 10);
  const T = X.resolveTheme(th, se);
  X.applyTheme(T); X.buildThemeStrips(T);
  X.render(tS, T);
  const g = grab(sc);
  console.log('wrote ' + writePNG(path.join(__dirname, `frame_${th}_${se}.png`), g.out, g.w, g.h));
} else {
  const picks = [
    ['midnight-night-clear','autumn'], ['midnight-night-rain','summer'],
    ['midnight-night-snow','winter'],  ['midnight-day-clear','spring'],
    ['cyberpunk-night-rain','summer'], ['cyberpunk-day-clear','autumn'],
    ['japan-night-clear','spring'],    ['japan-day-rain','summer']
  ];
  const COLS = 2, ROWS = 4, GAP = 5;
  const cw = COLS * VW + (COLS - 1) * GAP, ch = ROWS * VH + (ROWS - 1) * GAP;
  const sheet = new Uint8ClampedArray(cw * ch * 4);
  for (let i = 0; i < sheet.length; i += 4){ sheet[i]=22; sheet[i+1]=20; sheet[i+2]=28; sheet[i+3]=255; }
  picks.forEach(([th, se], i) => {
    const T = X.resolveTheme(th, se);
    X.applyTheme(T); X.buildThemeStrips(T);
    X.render(7.5 + i * 9, T);
    const cx = (i % COLS) * (VW + GAP), cy = ((i / COLS) | 0) * (VH + GAP);
    for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++){
      const c = X.fb[y * VW + x], o = ((cy + y) * cw + (cx + x)) * 4;
      sheet[o] = X._cr(c); sheet[o+1] = X._cg(c); sheet[o+2] = X._cb(c); sheet[o+3] = 255;
    }
    console.log(`  tile ${i + 1}: ${th} / ${se}`);
  });
  console.log('wrote ' + writePNG(path.join(__dirname, 'themes_sheet.png'), sheet, cw, ch));

  const T0 = X.resolveTheme('midnight-night-clear', 'summer');
  X.applyTheme(T0); X.buildThemeStrips(T0);
  X.render(7.5, T0);
  const g = grab(3);
  console.log('wrote ' + writePNG(path.join(__dirname, 'hero_x3.png'), g.out, g.w, g.h));
}