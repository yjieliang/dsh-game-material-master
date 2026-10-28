/**
 * 设计稿 PDF 光栅化 + 几何/色值提取（一次性工具，不参与插件运行）。
 *
 * 为什么需要它：\`整体 UI 重设计.pdf\` 由 TGFX 导出，文字全部转成了曲线路径、没有字体表，
 * 直接读文本是空的。这里手写了一个最小 PDF 渲染器（FlateDecode → 内容流 → 路径 → 扫描线填充，
 * 非零环绕 + 4×超采样），把页面渲成 PNG；同时 dump 每个填充路径的 bbox / 色值 / 圆角，
 * 所以 docs/设计基线-UI重设计.md 里的数值都是实测的，不是目测。
 *
 * 用法：
 *   node scripts/render-design-pdf.mjs <设计稿.pdf> <out.png> [scale] [x,y,w,h] [supersample]
 *   $env:FLIPY='1'  # 页面坐标是 y 向上（PDF 原生），出图必须翻一次
 *
 * 注意：内容流长度 498273、对象号 12 是这份 PDF 的硬编码（一次性工具，换稿子要改）。
 */

import fs from "node:fs";
import zlib from "node:zlib";

const PDF = process.argv[2];
const OUT = process.argv[3];
const SCALE = parseFloat(process.argv[4] || "2");
const REGION = process.argv[5] && process.argv[5] !== "-" ? process.argv[5].split(",").map(Number) : null;
const SS = parseInt(process.argv[6] || "2", 10);

const buf = fs.readFileSync(PDF);
const s = buf.toString("latin1");
const start12 = s.indexOf("12 0 obj");
let p = s.indexOf("stream", start12) + 6;
while (s[p] === "\r" || s[p] === "\n") p++;
const content = zlib.inflateSync(buf.subarray(p, p + 498273)).toString("latin1");

const WS = new Set([" ", "\n", "\r", "\t", "\f", "\0"]);
const DELIM = new Set(["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"]);

function tokenize(src) {
  const toks = []; let i = 0; const n = src.length;
  while (i < n) {
    const c = src[i];
    if (WS.has(c)) { i++; continue; }
    if (c === "%") { while (i < n && src[i] !== "\n" && src[i] !== "\r") i++; continue; }
    if (c === "/") { let j = i + 1; while (j < n && !WS.has(src[j]) && !DELIM.has(src[j])) j++; toks.push({ t: "name", v: src.slice(i+1, j) }); i = j; continue; }
    if (c === "(") {
      let depth = 1, j = i + 1, out = "";
      while (j < n && depth > 0) {
        if (src[j] === "\\") { out += src[j+1]; j += 2; continue; }
        if (src[j] === "(") depth++;
        else if (src[j] === ")") { depth--; if (depth === 0) { j++; break; } }
        out += src[j]; j++;
      }
      toks.push({ t: "str", v: out }); i = j; continue;
    }
    if (c === "<" && src[i+1] === "<") { toks.push({ t: "op", v: "<<" }); i += 2; continue; }
    if (c === ">" && src[i+1] === ">") { toks.push({ t: "op", v: ">>" }); i += 2; continue; }
    if (c === "[" || c === "]") { toks.push({ t: "op", v: c }); i++; continue; }
    if (c === "<") { let j = i+1; while (j < n && src[j] !== ">") j++; toks.push({ t: "hex", v: src.slice(i+1, j) }); i = j+1; continue; }
    let j = i; while (j < n && !WS.has(src[j]) && !DELIM.has(src[j])) j++;
    const w = src.slice(i, j);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) toks.push({ t: "num", v: parseFloat(w) });
    else toks.push({ t: "op", v: w });
    i = j;
  }
  return toks;
}

const toks = tokenize(content);
let ctm = [1,0,0,1,0,0];
const stack = [];
const mul = (m, n) => [
  m[0]*n[0] + m[1]*n[2], m[0]*n[1] + m[1]*n[3],
  m[2]*n[0] + m[3]*n[2], m[2]*n[1] + m[3]*n[3],
  m[4]*n[0] + m[5]*n[2] + n[4], m[4]*n[1] + m[5]*n[3] + n[5]
];
const apply = (m, x, y) => [m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]];

function flattenCubic(out, p0, p1, p2, p3) {
  const dd = Math.hypot(p3[0]-p0[0], p3[1]-p0[1]);
  const d1 = Math.abs((p1[0]-p0[0])*(p0[1]-p3[1]) - (p0[0]-p3[0])*(p1[1]-p0[1]));
  const d2 = Math.abs((p2[0]-p0[0])*(p0[1]-p3[1]) - (p0[0]-p3[0])*(p2[1]-p0[1]));
  if ((d1 + d2) <= 0.12 * (dd + 1e-9) || dd < 0.3) { out.push(p3); return; }
  const mid = (a,b) => [(a[0]+b[0])/2, (a[1]+b[1])/2];
  const a1 = mid(p0,p1), a2 = mid(p1,p2), a3 = mid(p2,p3);
  const b1 = mid(a1,a2), b2 = mid(a2,a3);
  const c1 = mid(b1,b2);
  flattenCubic(out, p0, a1, b1, c1);
  flattenCubic(out, c1, b2, a3, p3);
}

let operands = [];
let subpaths = [];
let cur = null, curPt = [0,0], startPt = [0,0];
let fill = [0,0,0];
const clips = [];
const shapes = [];
let clipPending = false;
let stats = { Do: 0, scn: 0, gs: 0, nfill: 0 };

function devRectPts(x,y,w,h) {
  return [apply(ctm,x,y), apply(ctm,x+w,y), apply(ctm,x+w,y+h), apply(ctm,x,y+h)];
}
function currentClip() {
  let r = [-1e9,-1e9,1e9,1e9];
  for (const c of clips) r = [Math.max(r[0],c[0]), Math.max(r[1],c[1]), Math.min(r[2],c[2]), Math.min(r[3],c[3])];
  return r;
}

for (let i = 0; i < toks.length; i++) {
  const tk = toks[i];
  if (tk.t !== "op") { operands.push(tk.v); continue; }
  const op = tk.v;
  if (op === "q") { stack.push({ ctm: ctm.slice(), clipLen: clips.length }); }
  else if (op === "Q") { const st = stack.pop(); ctm = st.ctm; clips.length = st.clipLen; }
  else if (op === "cm") { const m = operands.slice(-6); operands = []; ctm = mul(m, ctm); }
  else if (op === "re") {
    const a = operands.slice(-4); operands = [];
    subpaths.push(devRectPts(a[0],a[1],a[2],a[3]));
    cur = null;
  }
  else if (op === "m") { const a = operands.slice(-2); operands = []; const d = apply(ctm,a[0],a[1]); curPt = d; startPt = d; cur = [d]; subpaths.push(cur); }
  else if (op === "l") { const a = operands.slice(-2); operands = []; const d = apply(ctm,a[0],a[1]); if (!cur) { cur = [curPt]; subpaths.push(cur); } cur.push(d); curPt = d; }
  else if (op === "c") {
    const a = operands.slice(-6); operands = [];
    const p1 = apply(ctm,a[0],a[1]), p2 = apply(ctm,a[2],a[3]), p3 = apply(ctm,a[4],a[5]);
    if (!cur) { cur = [curPt]; subpaths.push(cur); }
    flattenCubic(cur, curPt, p1, p2, p3); curPt = p3;
  }
  else if (op === "h") { if (cur) cur.push(startPt); }
  else if (op === "W" || op === "W*") { clipPending = true; }
  else if (op === "n") {
    if (clipPending) {
      let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
      for (const sp of subpaths) for (const pt of sp) { x0=Math.min(x0,pt[0]); y0=Math.min(y0,pt[1]); x1=Math.max(x1,pt[0]); y1=Math.max(y1,pt[1]); }
      if (x0 < x1) clips.push([x0,y0,x1,y1]);
      clipPending = false;
    }
    subpaths = []; cur = null;
  }
  else if (op === "f" || op === "f*" || op === "F") {
    const segs = [];
    let bx0=1e9,by0=1e9,bx1=-1e9,by1=-1e9;
    for (const sp of subpaths) {
      const m = sp.length;
      for (let k = 0; k < m; k++) {
        const a = sp[k], b = sp[(k+1) % m];
        if (a === b) continue;
        segs.push([a[0],a[1],b[0],b[1]]);
        if (a[0]<bx0) bx0=a[0]; if (a[0]>bx1) bx1=a[0];
        if (a[1]<by0) by0=a[1]; if (a[1]>by1) by1=a[1];
      }
    }
    if (segs.length) { shapes.push({ segs, color: fill.slice(), clip: currentClip(), bbox: [bx0,by0,bx1,by1] }); stats.nfill++; }
    subpaths = []; cur = null;
  }
  else if (op === "SC" || op === "RG" || op === "CS" || op === "cs") { operands = []; }
  else if (op === "sc") { const v = operands.slice(-3); operands = [];
    if (v.length === 3) fill = [v[0],v[1],v[2]]; else if (v.length === 1) fill = [v[0],v[0],v[0]]; else if (v.length === 4) fill = [v[0],v[1],v[2]]; }
  else if (op === "scn") { operands = []; stats.scn++; }
  else if (op === "gs") { operands = []; stats.gs++; }
  else if (op === "Do") { operands = []; stats.Do++; }
  else { operands = []; }
}

// ---------- render ----------
const PGW = 1440, PGH = 960;
const vx = REGION ? REGION[0] : 0, vy = REGION ? REGION[1] : 0;
const vw = REGION ? REGION[2] : PGW, vh = REGION ? REGION[3] : PGH;
const W = Math.round(vw * SCALE), H = Math.round(vh * SCALE);
const RW = W * SS, RH = H * SS;
const raster = new Uint8Array(RW * RH * 3).fill(255);

const FLIPX = process.env.FLIPX === "1";
const FLIPY = process.env.FLIPY === "1";
const toSX = (x) => { const xx = FLIPX ? PGW - x : x; return (xx - vx) * SCALE * SS; };
const toSY = (y) => { const yy = FLIPY ? PGH - y : y; return (yy - vy) * SCALE * SS; };

for (const sh of shapes) {
  const cx0 = Math.max(sh.clip[0], sh.bbox[0]), cx1 = Math.min(sh.clip[2], sh.bbox[2]);
  const cy0 = Math.max(sh.clip[1], sh.bbox[1]), cy1 = Math.min(sh.clip[3], sh.bbox[3]);
  if (cx1 <= cx0 || cy1 <= cy0) continue;
  const ya = toSY(cy0), yb = toSY(cy1);
  const r0 = Math.max(0, Math.floor(Math.min(ya, yb))), r1 = Math.min(RH - 1, Math.ceil(Math.max(ya, yb)));
  if (r1 < r0) continue;
  // edges in raster space
  const edges = [];
  const xa = toSX(cx0), xb = toSX(cx1);
  const X0 = Math.max(0, Math.floor(Math.min(xa, xb))), X1 = Math.min(RW - 1, Math.ceil(Math.max(xa, xb)));
  for (const sg of sh.segs) {
    let x0 = toSX(sg[0]), y0 = toSY(sg[1]), x1 = toSX(sg[2]), y1 = toSY(sg[3]);
    if (y0 === y1) continue;
    let dir = 1;
    if (y0 > y1) { [x0,x1] = [x1,x0]; [y0,y1] = [y1,y0]; dir = -1; }
    edges.push({ x0, y0, x1, y1, dir, dxdy: (x1 - x0) / (y1 - y0) });
  }
  if (!edges.length) continue;
  edges.sort((a,b) => a.y0 - b.y0);
  const cr = sh.color[0]*255, cg = sh.color[1]*255, cb = sh.color[2]*255;
  let ei = 0; let active = [];
  for (let y = r0; y <= r1; y++) {
    const yc = y + 0.5;
    while (ei < edges.length && edges[ei].y0 <= yc) active.push(edges[ei++]);
    if (active.length) {
      const next = [];
      for (const e of active) if (e.y1 > yc) next.push(e);
      active = next;
    }
    if (!active.length) continue;
    const xs = [];
    for (const e of active) xs.push([e.x0 + (yc - e.y0) * e.dxdy, e.dir]);
    xs.sort((a,b) => a[0] - b[0]);
    let wind = 0, spanStart = 0;
    for (let k = 0; k < xs.length; k++) {
      const prev = wind; wind += xs[k][1];
      if (prev === 0 && wind !== 0) spanStart = xs[k][0];
      else if (prev !== 0 && wind === 0) {
        let a = Math.max(X0, Math.ceil(spanStart - 0.5)), b = Math.min(X1, Math.floor(xs[k][0] - 0.5));
        if (b >= a) {
          const base = (y * RW) * 3;
          for (let x = a; x <= b; x++) { const o = base + x*3; raster[o] = cr; raster[o+1] = cg; raster[o+2] = cb; }
        }
      }
    }
  }
}


if (process.env.SAMPLE) {
  const pts = process.env.SAMPLE.split(";").map(p => p.split(",").map(Number));
  for (const [px, py] of pts) {
    const sx = Math.round(px * SCALE * SS), sy = Math.round(py * SCALE * SS);
    const o = (clampY(sy) * RW + clampX(sx)) * 3;
    console.log("px", px, py, "=>", "#" + [raster[o], raster[o+1], raster[o+2]].map(v=>v.toString(16).padStart(2,"0")).join(""));
  }
}
function clampX(v){ return Math.max(0, Math.min(RW-1, v)); }
function clampY(v){ return Math.max(0, Math.min(RH-1, v)); }

// downsample
const outBuf = Buffer.alloc(W * H * 3);
const inv = 1 / (SS * SS);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < SS; dy++) {
      const rowBase = ((y*SS + dy) * RW + x*SS) * 3;
      for (let dx = 0; dx < SS; dx++) { const o = rowBase + dx*3; r += raster[o]; g += raster[o+1]; b += raster[o+2]; }
    }
    const o = (y*W + x) * 3;
    outBuf[o] = Math.round(r * inv); outBuf[o+1] = Math.round(g * inv); outBuf[o+2] = Math.round(b * inv);
  }
}

// PNG
const crcTable = (() => { const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) { raw[y*(1+W*3)] = 0; outBuf.copy(raw, y*(1+W*3)+1, y*W*3, (y+1)*W*3); }
const png = Buffer.concat([
  Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
  chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))
]);
fs.writeFileSync(OUT, png);
console.log("shapes:", shapes.length, "stats:", JSON.stringify(stats), "size:", W + "x" + H, "->", OUT);

// full dump in final (visual) orientation
const hexOf = (c) => "#" + c.map(v => Math.round(v*255).toString(16).padStart(2,"0")).join("");
const flipBox = (b) => [b[0], 960 - b[3], b[2], 960 - b[1]];
const dump = shapes.map((sh,i)=>{
  const b = FLIPY ? flipBox(sh.bbox) : sh.bbox;
  return { i, x: Math.round(b[0]*10)/10, y: Math.round(b[1]*10)/10, w: Math.round((b[2]-b[0])*10)/10, h: Math.round((b[3]-b[1])*10)/10, color: hexOf(sh.color), segs: sh.segs.length };
});
fs.writeFileSync(OUT.replace(/\.png$/, ".shapes.json"), JSON.stringify(dump));

// radius probe
const probeIds = [56, 92, 105, 38, 9, 89, 12, 39, 75, 74, 61, 64, 86, 35, 2, 22, 81];
const probes = shapes.map((sh, i) => {
  if (!probeIds.includes(i)) return null;
  const first = sh.segs[0];
  const flipy = (y) => FLIPY ? 960 - y : y;
  return { i, color: hexOf(sh.color), bbox: [sh.bbox[0], flipy(sh.bbox[3]), sh.bbox[2], flipy(sh.bbox[1])],
    p0: [Math.round(first[0]*100)/100, Math.round(flipy(first[1])*100)/100],
    p1: [Math.round(sh.segs[1][2]*100)/100, Math.round(flipy(sh.segs[1][3])*100)/100],
    p2: [Math.round(sh.segs[2][2]*100)/100, Math.round(flipy(sh.segs[2][3])*100)/100],
    pts: sh.segs.length };
}).filter(Boolean);
fs.writeFileSync(OUT.replace(/\.png$/, ".radius.json"), JSON.stringify(probes, null, 1));
const hist = {};
for (const d of dump) hist[d.color] = (hist[d.color]||0)+1;
fs.writeFileSync(OUT.replace(/\.png$/, ".palette.json"), JSON.stringify(Object.entries(hist).sort((a,b)=>b[1]-a[1]), null, 0));
