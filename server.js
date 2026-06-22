const h = require('http'), fs = require('fs'), p = require('path'), zlib = require('zlib');
const d = __dirname;
const mime = {
  '.html':'text/html', '.js':'application/javascript',
  '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml'
};

// ── PNG generator (supersampled 4x for smooth edges) ──────────────────────

function makePNG(size) {
  const SCALE = 4;
  const S = size * SCALE; // render at 4x

  const px = new Float32Array(S * S * 4); // RGBA float

  const set = (x, y, r, g, b, a = 1) => {
    if (x < 0 || x >= S || y < 0 || y >= S) return;
    const i = (y * S + x) * 4;
    // alpha composite over existing
    const oa = px[i+3];
    const na = a + oa * (1 - a);
    if (na < 0.0001) return;
    px[i]   = (r * a + px[i]   * oa * (1 - a)) / na;
    px[i+1] = (g * a + px[i+1] * oa * (1 - a)) / na;
    px[i+2] = (b * a + px[i+2] * oa * (1 - a)) / na;
    px[i+3] = na;
  };

  // Fill pixel range
  const fillRect = (x0, y0, w, hh, r, g, b, a = 1) => {
    for (let y = y0; y < y0+hh; y++) for (let x = x0; x < x0+w; x++) set(x, y, r, g, b, a);
  };

  // Anti-aliased rounded rect fill
  const rrect = (x0, y0, w, hh, rx, r, g, b, a = 1) => {
    for (let y = y0; y < y0+hh; y++) {
      for (let x = x0; x < x0+w; x++) {
        const dx = Math.max(rx - (x-x0), 0, (x-x0) - (w-rx-1));
        const dy = Math.max(rx - (y-y0), 0, (y-y0) - (hh-rx-1));
        const dist = Math.sqrt(dx*dx + dy*dy);
        const alpha = Math.min(1, Math.max(0, rx - dist + 0.5)) * a;
        if (alpha > 0.001) set(x, y, r, g, b, alpha);
      }
    }
  };

  // Anti-aliased circle
  const circle = (cx, cy, radius, r, g, b, a = 1) => {
    for (let y = cy-radius-1; y <= cy+radius+1; y++) {
      for (let x = cx-radius-1; x <= cx+radius+1; x++) {
        const dist = Math.sqrt((x-cx)**2 + (y-cy)**2);
        const alpha = Math.min(1, Math.max(0, radius - dist + 0.5)) * a;
        if (alpha > 0.001) set(x, y, r, g, b, alpha);
      }
    }
  };

  // ── Draw at 4x scale ──
  const sc = S / 512; // scale factor for coordinates

  // Background gradient (top to bottom: #5B54F0 → #2D27A3)
  for (let y = 0; y < S; y++) {
    const t = y / S;
    const R = Math.round(0x5B + (0x2D - 0x5B) * t);
    const G = Math.round(0x54 + (0x27 - 0x54) * t);
    const B = Math.round(0xF0 + (0xA3 - 0xF0) * t);
    for (let x = 0; x < S; x++) set(x, y, R/255, G/255, B/255, 1);
  }

  // Soft ellipse glow top
  for (let y = 0; y < S * 0.37; y++) {
    for (let x = 0; x < S; x++) {
      const nx = (x / S - 0.5) / 0.39;
      const ny = (y / S - 0.156) / 0.195;
      const d2 = nx*nx + ny*ny;
      if (d2 < 1) {
        const a = (1 - d2) * 0.07;
        set(x, y, 1, 1, 1, a);
      }
    }
  }

  // Main white rounded bubble
  const bx = Math.round(80*sc), by = Math.round(108*sc);
  const bw = Math.round(352*sc), bh = Math.round(228*sc);
  const br = Math.round(52*sc);
  rrect(bx, by, bw, bh, br, 1, 1, 1, 1);

  // Bubble tail path (triangle-ish)
  // Points: (112,336) (72,420) (184,336) in original coords
  const tx1=Math.round(112*sc), ty1=Math.round(336*sc);
  const tx2=Math.round(74*sc),  ty2=Math.round(418*sc);
  const tx3=Math.round(184*sc), ty3=Math.round(336*sc);
  for (let y = ty1; y <= ty2; y++) {
    const t = (y - ty1) / (ty2 - ty1);
    const xl = Math.round(tx1 + (tx2 - tx1) * t);
    const xr = Math.round(tx3 + (tx2 - tx3) * t);
    for (let x = xl; x <= xr; x++) set(x, y, 1, 1, 1, 1);
  }

  // "EN" text — drawn as geometric letterforms
  // Scale: each letter rendered to fit naturally inside bubble
  const textY = Math.round(256 * sc);
  const textH = Math.round(108 * sc);  // letter height
  const textW = Math.round(44 * sc);   // stroke width
  const gap   = Math.round(20 * sc);   // gap between E and N
  const totalW = textW + Math.round(180*sc) + gap + textW + Math.round(180*sc);
  const startX = Math.round(256*sc) - Math.round(totalW/2);

  // Draw "E"
  const ex = startX, ey = textY - Math.round(textH/2);
  const ew = Math.round(170*sc);
  // Vertical stroke
  fillRect(ex, ey, textW, textH, 0x37/255, 0x30/255, 0xA3/255);
  // Top horizontal
  fillRect(ex, ey, ew, textW, 0x37/255, 0x30/255, 0xA3/255);
  // Middle horizontal (slightly shorter)
  fillRect(ex, ey + Math.round(textH/2) - Math.round(textW/2), Math.round(ew*0.78), textW, 0x37/255, 0x30/255, 0xA3/255);
  // Bottom horizontal
  fillRect(ex, ey + textH - textW, ew, textW, 0x37/255, 0x30/255, 0xA3/255);

  // Draw "N"
  const nx2 = ex + ew + gap, ny2 = ey;
  const nw = Math.round(175*sc);
  // Left vertical
  fillRect(nx2, ny2, textW, textH, 0x37/255, 0x30/255, 0xA3/255);
  // Right vertical
  fillRect(nx2 + nw - textW, ny2, textW, textH, 0x37/255, 0x30/255, 0xA3/255);
  // Diagonal (left-top to right-bottom)
  for (let i = 0; i < textH; i++) {
    const xi = Math.round(nx2 + textW/2 + (nw - textW) * i / textH);
    const yi = ny2 + i;
    const sw = Math.round(textW * 1.3); // diagonal slightly thicker
    fillRect(xi - Math.round(sw/2), yi, sw, 1, 0x37/255, 0x30/255, 0xA3/255);
  }

  // Underline accent
  const ulY = Math.round(290*sc);
  const ulX = Math.round(156*sc), ulW = Math.round(200*sc), ulH = Math.round(10*sc);
  rrect(ulX, ulY, ulW, ulH, Math.round(ulH/2), 0x4F/255, 0x46/255, 0xE5/255, 0.35);

  // ── Downsample 4x → target size ──
  const out = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const si = ((y*SCALE+dy)*S + (x*SCALE+dx)) * 4;
          const a = px[si+3];
          r += px[si]   * a;
          g += px[si+1] * a;
          b += px[si+2] * a;
        }
      }
      const n = SCALE * SCALE;
      const oi = (y*size+x)*3;
      out[oi]   = Math.min(255, Math.round(r/n*255));
      out[oi+1] = Math.min(255, Math.round(g/n*255));
      out[oi+2] = Math.min(255, Math.round(b/n*255));
    }
  }

  // ── Encode to PNG ──
  function crc32(buf) {
    const t=[];for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[i]=c;}
    let c=0xFFFFFFFF;for(const b of buf)c=t[(c^b)&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;
  }
  function chunk(type, data) {
    const lb=Buffer.alloc(4); lb.writeUInt32BE(data.length);
    const td=Buffer.concat([Buffer.from(type), data]);
    const cb=Buffer.alloc(4); cb.writeUInt32BE(crc32(td));
    return Buffer.concat([lb, td, cb]);
  }
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(size,0); ihdr.writeUInt32BE(size,4); ihdr[8]=8; ihdr[9]=2;
  const raw=[];
  for(let y=0;y<size;y++){raw.push(0);for(let x=0;x<size;x++){const i=(y*size+x)*3;raw.push(out[i],out[i+1],out[i+2]);}}
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',ihdr),
    chunk('IDAT',zlib.deflateSync(Buffer.from(raw),{level:6})),
    chunk('IEND',Buffer.alloc(0))
  ]);
}

// Cache generated icons
const iconCache = {};
function getIcon(size) {
  if (!iconCache[size]) iconCache[size] = makePNG(size);
  return iconCache[size];
}

// ── SVG icons ──────────────────────────────────────────────────────────────

const SVG_ICON = fs.readFileSync(p.join(d, 'icon.svg'));
const SVG_MASKABLE = fs.readFileSync(p.join(d, 'icon-maskable.svg'));

// ── HTTP server ────────────────────────────────────────────────────────────

h.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/icon.svg') {
    res.writeHead(200, {'Content-Type':'image/svg+xml','Cache-Control':'public,max-age=3600'});
    return res.end(SVG_ICON);
  }
  if (url === '/icon-maskable.svg') {
    res.writeHead(200, {'Content-Type':'image/svg+xml','Cache-Control':'public,max-age=3600'});
    return res.end(SVG_MASKABLE);
  }
  if (url === '/icon-192.png') {
    res.writeHead(200, {'Content-Type':'image/png','Cache-Control':'public,max-age=3600'});
    return res.end(getIcon(192));
  }
  if (url === '/icon-512.png') {
    res.writeHead(200, {'Content-Type':'image/png','Cache-Control':'public,max-age=3600'});
    return res.end(getIcon(512));
  }

  const file = p.join(d, url === '/' ? 'index.html' : url);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, {'Content-Type': mime[p.extname(file)] || 'text/plain'});
    res.end(buf);
  });
}).listen(4500, () => console.log('ready'));
