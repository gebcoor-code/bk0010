// File Commander (BK): two panels over file sets — ZIP sets of BK tape files (.bin, overlays, data) from the server
// or from the PC, and a RAM panel (files put from the PC, files saved by BK programs). Built on the File Commander
// of the Unreal Speccy web port: the same keys, buttons, dialogs and viewer; the volumes and the viewer modes are BK ones.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const u16 = (a, o) => a[o] | (a[o + 1] << 8);
  const put16 = (a, o, v) => { a[o] = v & 255; a[o + 1] = (v >> 8) & 255; };
  const fmtSize = (n) => n >= 10240 ? Math.round(n / 1024) + 'K' : String(n);
  const oct = (v, n) => (v >>> 0).toString(8).padStart(n || 6, '0');
  const RAM_CAP = 2 * 1024 * 1024;

  // ---- BK KOI-8 (the BK's own table, devemu/Globals.h koi8tbl): 0..31 controls, 127 ■, 0240..0277 pseudographics
  const BK_HI = [
    ...' '.repeat(32),
    '¶', '┴', '♥', '┐', '╡', '├', '└', '═', '╤', '♠', '┌', '┬', '╨', '↓', '┼', '║',
    '┤', '←', '╬', '↑', '♣', '─', '╫', '│', '♦', '┘', '╪', '╥', '╧', '╞', '→', '▓',
    ...'юабцдефгхийклмнопярстужвьызшэщчъЮАБЦДЕФГХИЙКЛМНОПЯРСТУЖВЬЫЗШЭЩЧЪ'];
  const bkChar = (b) => b < 32 ? '' : b < 127 ? String.fromCharCode(b) : b === 127 ? '■' : BK_HI[b - 128];
  const bkName = (b) => { let s = ''; for (const x of b) { if (!x) break; s += bkChar(x) || ' '; } return s.trimEnd(); };

  // ---- a BK tape file (.bin): address, length, data (some carry address, length, name[16], data, checksum)
  function binInfo(d) {
    if (d.length < 4) return null;
    const addr = u16(d, 0), len = u16(d, 2);
    if (len === d.length - 4) return { addr, len, off: 4 };
    if (d.length >= 22 && len === d.length - 22) return { addr, len, off: 20 };
    return { addr, len: Math.max(0, Math.min(len || d.length - 4, d.length - 4)), off: 4, odd: true };
  }
  const splitName = (n) => { const m = /^(.*?)(?:\.([^.]*))?$/.exec(n); return { base: m[1] || n, ext: m[2] || '' }; };

  // ---- a file set: { name, files: [{ path ('DIR/NAME.EXT'), data }] } — a ZIP from the server / the PC, or RAM
  // The volume shows one directory at a time (ZIP folders: Enter opens, Backspace / ".." goes up).
  function setVolume(set, kind) {
    let path = '';
    if (!set.dirs) set.dirs = []; // empty folders of RAM and zip sets ('A/B/')
    const inDir = (p) => { if (!p.startsWith(path)) return null; return p.slice(path.length); };
    const ro = () => set.disk ? new Error(set.disk.kind + ': read only' + (set.mounted ? ' (mounted disk)' : '')) : null;
    const vol = {
      kind, label: set.name, set,
      get path() { return '/' + path.replace(/\/$/, ''); },
      setPath(dir) { path = (dir && dir.length) ? dir.join('/') + '/' : ''; if (!set.files.some((f) => f.path.startsWith(path)) && !set.dirs.some((d) => d.startsWith(path))) path = ''; return path ? path.slice(0, -1).split('/') : []; },
      enter(it) {
        if (it.up) path = path.replace(/[^/]+\/$/, '');
        else path += it.name + '/';
        return path ? path.slice(0, -1).split('/') : [];
      },
      list() {
        const out = [], dirs = new Map(); // folder name -> its item (size: the files in it)
        if (path) out.push({ dir: true, up: true, name: '..', ext: '', size: 0, show: '' });
        const addDir = (d) => { if (!dirs.has(d)) { const it = { dir: true, name: d, ext: '', size: 0, show: '<DIR>' }; dirs.set(d, it); out.push(it); } return dirs.get(d); };
        for (const d of set.dirs) { const rest = inDir(d); if (rest) addDir(rest.slice(0, rest.indexOf('/'))); }
        (set.disk && set.disk.dirs || []).forEach((d) => { const rest = inDir(d); if (rest) addDir(rest.slice(0, rest.indexOf('/'))); });
        set.files.forEach((f) => {
          const rest = inDir(f.path); if (rest === null) return;
          const k = rest.indexOf('/');
          if (k >= 0) { addDir(rest.slice(0, k)).size += f.data.length; return; }
          const { base, ext } = splitName(rest), bi = binInfo(f.data);
          out.push({ id: f, name: base, ext, size: f.data.length, show: bi && !bi.odd ? bi.len : f.data.length, bin: bi && !bi.odd ? bi : null, sub: bi && !bi.odd ? oct(bi.addr) : '' });
        });
        return out;
      },
      // the files of a folder of this directory, with their paths from it ('DIR/SUB/NAME.EXT')
      filesIn(it) { const pre = path + it.name + '/'; return set.files.filter((f) => f.path.startsWith(pre)).map((f) => ({ rel: f.path.slice(path.length), f })); },
      free() { if (set.disk) return set.disk.free ? set.disk.free() : 0; return Math.max(0, RAM_CAP - set.files.reduce((s, f) => s + f.data.length, 0)); },
      read(it) { const { base, ext } = splitName(it.id.path.replace(/^.*\//, '')); return { name: base, ext, data: it.id.data.slice() }; },
      // f: { name, ext, data, dir ('SUB/' under this directory: folders of a copy or of an uploaded zip), replace }
      write(f) {
        const name = (f.name + (f.ext ? '.' + f.ext : '')).toUpperCase();
        if (set.disk) { // a disk image: the file goes into its file system (BK .bin: address from the header)
          if (!set.disk.add) throw ro();
          const bi = binInfo(f.data), ok = bi && !bi.odd;
          set.disk.add(path, name, ok ? bi.addr : 0o1000, ok ? f.data.subarray(bi.off, bi.off + bi.len) : f.data);
          set.reload(); return;
        }
        const full = path + (f.dir || '').toUpperCase() + name, old = set.files.find((x) => x.path.toUpperCase() === full.toUpperCase());
        if (old && !f.replace) throw new Error('file exists');
        if (f.data.length - (old ? old.data.length : 0) > vol.free()) throw new Error('no room (' + fmtSize(RAM_CAP) + ' per set)');
        if (old) old.data = f.data.slice(); else set.files.push({ path: full, data: f.data.slice() });
        set.dirty = true;
      },
      mkdir(name) {
        if (set.disk) throw new Error(set.disk.kind + ': no new folders here' + (set.mounted ? ' (mounted disk)' : ''));
        const d = path + name.toUpperCase().replace(/[\\/]/g, '_') + '/';
        if (set.dirs.includes(d) || set.files.some((f) => f.path.startsWith(d))) throw new Error('folder exists');
        set.dirs.push(d); set.dirty = true;
      },
      del(it) {
        if (set.disk) { if (!set.disk.del || it.dir) throw ro() || new Error(set.disk.kind + ': folders are not deleted'); set.disk.del(it.id.disk); set.reload(); return; }
        if (it.dir) { const pre = path + it.name + '/'; for (let k = set.files.length - 1; k >= 0; k--) if (set.files[k].path.startsWith(pre)) set.files.splice(k, 1); set.dirs = set.dirs.filter((d) => !d.startsWith(pre)); } // in place: RAM's array is the page's
        else { const i = set.files.indexOf(it.id); if (i >= 0) set.files.splice(i, 1); }
        set.dirty = true;
      },
      dir() { return path; },
    };
    return vol;
  }

  // ---- PDP-11 (K1801VM1) disassembler, octal: dis(rd, pc) → { len (bytes), text }; rd(addr) returns a word
  const PDP = (() => {
    const R = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'SP', 'PC'];
    const NOARG = { 0: 'HALT', 1: 'WAIT', 2: 'RTI', 3: 'BPT', 4: 'IOT', 5: 'RESET', 6: 'RTT', 7: 'MFPT', 0o10: 'START', 0o14: 'STEP', 0o240: 'NOP', 0o257: 'CCC', 0o277: 'SCC' };
    const ONE = { 0o50: 'CLR', 0o51: 'COM', 0o52: 'INC', 0o53: 'DEC', 0o54: 'NEG', 0o55: 'ADC', 0o56: 'SBC', 0o57: 'TST', 0o60: 'ROR', 0o61: 'ROL', 0o62: 'ASR', 0o63: 'ASL', 0o65: 'MFPI', 0o66: 'MTPI', 0o67: 'SXT' };
    const ONEB = { 0o50: 'CLRB', 0o51: 'COMB', 0o52: 'INCB', 0o53: 'DECB', 0o54: 'NEGB', 0o55: 'ADCB', 0o56: 'SBCB', 0o57: 'TSTB', 0o60: 'RORB', 0o61: 'ROLB', 0o62: 'ASRB', 0o63: 'ASLB', 0o64: 'MTPS', 0o65: 'MFPD', 0o66: 'MTPD', 0o67: 'MFPS' };
    const TWO = ['', 'MOV', 'CMP', 'BIT', 'BIC', 'BIS', 'ADD'], TWOB = ['', 'MOVB', 'CMPB', 'BITB', 'BICB', 'BISB', 'SUB'];
    const BR = { 0o400: 'BR', 0o1000: 'BNE', 0o1400: 'BEQ', 0o2000: 'BGE', 0o2400: 'BLT', 0o3000: 'BGT', 0o3400: 'BLE',
      0o100000: 'BPL', 0o100400: 'BMI', 0o101000: 'BHI', 0o101400: 'BLOS', 0o102000: 'BVC', 0o102400: 'BVS', 0o103000: 'BHIS', 0o103400: 'BLO' };
    return function dis(rd, pc0) {
      let pc = pc0;
      const w = rd(pc); pc = (pc + 2) & 0xFFFF;
      const words = [w];
      const next = () => { const v = rd(pc); words.push(v); pc = (pc + 2) & 0xFFFF; return v; };
      const arg = (f) => {
        const m = (f >> 3) & 7, r = f & 7;
        if (r === 7) {
          if (m === 2) return '#' + oct(next());
          if (m === 3) return '@#' + oct(next());
          if (m === 6) { const x = next(); return oct((x + pc) & 0xFFFF); }
          if (m === 7) { const x = next(); return '@' + oct((x + pc) & 0xFFFF); }
        }
        switch (m) {
          case 0: return R[r];
          case 1: return '(' + R[r] + ')';
          case 2: return '(' + R[r] + ')+';
          case 3: return '@(' + R[r] + ')+';
          case 4: return '-(' + R[r] + ')';
          case 5: return '@-(' + R[r] + ')';
          case 6: return oct(next()) + '(' + R[r] + ')';
          default: return '@' + oct(next()) + '(' + R[r] + ')';
        }
      };
      const ret = (t) => ({ len: (pc - pc0) & 0xFFFF, text: t, words });
      if (w in NOARG) return ret(NOARG[w]);
      if (w >= 0o240 && w <= 0o277) { // condition codes
        const f = w & 0o17, n = [[8, 'N'], [4, 'Z'], [2, 'V'], [1, 'C']].filter(([b]) => f & b).map(([, c]) => c);
        return ret((w & 0o20 ? 'SE' : 'CL') + n.join('|' + (w & 0o20 ? 'SE' : 'CL')));
      }
      if ((w & 0o177700) === 0o000100) return ret('JMP ' + arg(w));
      if ((w & 0o177770) === 0o000200) return ret('RTS ' + R[w & 7]);
      if ((w & 0o177700) === 0o000300) return ret('SWAB ' + arg(w));
      const br = BR[w & 0o177400];
      if (br) { let off = w & 0o377; if (off & 0o200) off -= 0o400; return ret(br + ' ' + oct((pc + off * 2) & 0xFFFF)); }
      if ((w & 0o177000) === 0o004000) return ret('JSR ' + R[(w >> 6) & 7] + ',' + arg(w));
      if ((w & 0o177400) === 0o104000) return ret('EMT ' + oct(w & 0o377, 3));
      if ((w & 0o177400) === 0o104400) return ret('TRAP ' + oct(w & 0o377, 3));
      if ((w & 0o177700) === 0o006400) return ret('MARK ' + oct(w & 0o77, 2));
      const op1 = (w >> 6) & 0o777;
      if (!(w & 0o100000) && ONE[op1 & 0o77] && (op1 >> 6) === 0) return ret(ONE[op1 & 0o77] + ' ' + arg(w));
      if ((w & 0o100000) && ((w >> 6) & 0o1700) === 0o1000 && ONEB[op1 & 0o77]) return ret(ONEB[op1 & 0o77] + ' ' + arg(w));
      const top = (w >> 12) & 0o17;
      if (top >= 1 && top <= 6) { const s = arg(w >> 6); return ret(TWO[top] + ' ' + s + ',' + arg(w)); }
      if (top >= 0o11 && top <= 0o16) { const s = arg(w >> 6); return ret(TWOB[top - 0o10] + ' ' + s + ',' + arg(w)); }
      const t7 = (w >> 9) & 0o177;
      if (t7 === 0o070 || t7 === 0o071 || t7 === 0o072 || t7 === 0o073) return ret(['MUL', 'DIV', 'ASH', 'ASHC'][t7 - 0o70] + ' ' + arg(w) + ',' + R[(w >> 6) & 7]);
      if (t7 === 0o074) return ret('XOR ' + R[(w >> 6) & 7] + ',' + arg(w));
      if (t7 === 0o077) return ret('SOB ' + R[(w >> 6) & 7] + ',' + oct((pc - (w & 0o77) * 2) & 0xFFFF));
      return ret('.WORD ' + oct(w));
    };
  })();

  // ---- file viewer: text (BK KOI-8, CP866, KOI8-R, Windows-1251), hex, octal words, PDP-11 disassembler
  const ENC = [['bk', 'BK KOI-8'], ['koi8-r', 'KOI8-R'], ['cp866', 'CP866 (alt)'], ['windows-1251', 'Windows-1251'], ['latin1', 'Latin-1'], ['utf-8', 'UTF-8']];
  const decTab = {};
  function table(enc) { // 256 printable characters for the encoding (controls shown as ·)
    if (decTab[enc]) return decTab[enc];
    let t = [];
    if (enc === 'bk') for (let i = 0; i < 256; i++) t.push(i < 32 ? '·' : bkChar(i));
    else if (enc === 'latin1' || enc === 'utf-8') for (let i = 0; i < 256; i++) t.push(i < 32 ? '·' : i < 127 ? String.fromCharCode(i) : enc === 'latin1' && i >= 160 ? String.fromCharCode(i) : '·'); // UTF-8 byte by byte (hex): ASCII only
    else { const b = new Uint8Array(256); for (let i = 0; i < 256; i++) b[i] = i; t = [...new TextDecoder(enc).decode(b)]; for (let i = 0; i < 32; i++) t[i] = '·'; }
    return (decTab[enc] = t);
  }
  // the editor's table: every byte has a character of its own (controls and gaps: private characters), so a file
  // comes back byte for byte
  const edTabs = {};
  function edTable(enc) {
    if (edTabs[enc]) return edTabs[enc];
    const t = table(enc).slice(), back = new Map();
    for (let i = 0; i < 256; i++) {
      let c = t[i];
      if (i < 32) c = String.fromCharCode(0x2400 + i);
      else if (i === 127 && enc !== 'bk') c = '␡';
      else if (c === '·' || c === ' ' && i !== 32) c = String.fromCharCode(0xE000 + i);
      if (back.has(c)) c = String.fromCharCode(0xE000 + i);
      t[i] = c; back.set(c, i);
    }
    return (edTabs[enc] = { dec: t, back });
  }
  const MODES = ['text', 'hex', 'oct', 'dis'];
  function makeViewer(api) {
    const w = $('fvwin'), body = $('fvbody');
    let file = null, mode = MODES.includes(api.load('fv.mode')) ? api.load('fv.mode') : 'text', enc = api.load('fv.enc') || 'bk';
    let wrap = api.load('fv.wrap') !== '0'; // text: long lines wrapped by words (the default)
    const setWrap = (v) => { wrap = v; api.store('fv.wrap', v ? '1' : '0'); $('fvwrap').classList.toggle('on', v); body.classList.toggle('wrap', v); };
    setWrap(wrap);
    $('fvwrap').onclick = () => { setWrap(!wrap); body.focus(); };
    const fw = api.floatWin(w, 'fvpos', () => {
      const r = $('fcwin').getBoundingClientRect(), vw = document.documentElement.clientWidth;
      return { x: Math.max(4, Math.min(r.left + 40, vw - w.offsetWidth - 4)), y: Math.max(8, r.top + 30) };
    });
    ENC.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; $('fvenc').appendChild(o); });
    let rowAddr = [];
    const orgOf = () => { const v = parseInt($('fvorg').value.trim(), 8); return isFinite(v) ? v & 0xFFFF : (file.bin ? file.bin.addr : 0); };
    function render() {
      if (!file) return;
      $('fvmode').value = mode; $('fvenc').value = enc;
      const t = table(enc), d = file.body, base = orgOf();
      const code = mode !== 'text';
      for (const id of ['fvorg', 'fvorgl', 'fvgo', 'fvgol']) $(id).hidden = !code;
      $('fvwrap').hidden = code;
      let out = ''; rowAddr = [];
      const rows = [];
      if (mode === 'dis') {
        const rd = (a) => { const k = (a - base) & 0xFFFF; return k + 1 < d.length ? u16(d, k) : k < d.length ? d[k] : 0; };
        for (let o = 0; o < d.length;) {
          const r = PDP(rd, (base + o) & 0xFFFF), len = Math.max(2, Math.min(r.len, d.length - o));
          rowAddr.push(o);
          rows.push(oct((base + o) & 0xFFFF) + '  ' + r.words.slice(0, len / 2).map((x) => oct(x)).join(' ').padEnd(21) + r.text);
          o += len;
        }
      } else if (mode === 'oct') {
        for (let o = 0; o < d.length; o += 8) {
          rowAddr.push(o);
          let ws = '', c = '';
          for (let i = 0; i < 8; i += 2) ws += (o + i + 1 < d.length ? oct(u16(d, o + i)) : o + i < d.length ? '   ' + oct(d[o + i], 3) : '      ') + ' ';
          for (let i = 0; i < 8 && o + i < d.length; i++) c += t[d[o + i]];
          rows.push(oct((base + o) & 0xFFFF) + '  ' + ws + ' ' + c);
        }
      } else if (mode === 'hex') {
        for (let o = 0; o < d.length; o += 16) {
          rowAddr.push(o);
          let h = '', c = '';
          for (let i = 0; i < 16; i++) { h += o + i < d.length ? d[o + i].toString(16).toUpperCase().padStart(2, '0') + (i === 7 ? '  ' : ' ') : (i === 7 ? '    ' : '   '); if (o + i < d.length) c += t[d[o + i]]; }
          rows.push(oct((base + o) & 0xFFFF) + '  ' + h + ' ' + c);
        }
      }
      if (code) out = rows.join('\n');
      else {
        const parts = [];
        if (enc === 'utf-8') parts.push(new TextDecoder('utf-8').decode(d).replace(/\r\n?/g, '\n'));
        else for (let i = 0; i < d.length; i++) {
          const b = d[i];
          if (b === 13) { parts.push('\n'); if (d[i + 1] === 10) i++; } else if (b === 10) parts.push('\n'); else if (b === 9) parts.push('\t'); else if (b) parts.push(t[b]);
        }
        out = parts.join('');
      }
      body.textContent = out;
      body.classList.toggle('hex', code);
      $('fvinfo').textContent = file.data.length + ' bytes' + (file.bin ? ` · address ${oct(file.bin.addr)} length ${oct(file.bin.len)} (${file.bin.len})` : '');
    }
    // quick jump (codes): the address (octal) as shown in the left column; the line is selected and scrolled into view
    function goTo(txt) {
      if (!file || mode === 'text') return;
      const v = parseInt(String(txt).trim(), 8); if (!isFinite(v)) return;
      const off = (v - orgOf()) & 0xFFFF;
      if (off >= file.body.length) { $('fvinfo').textContent = 'address out of the file'; return; }
      let line = 0; while (line + 1 < rowAddr.length && rowAddr[line + 1] <= off) line++;
      const lines = body.textContent.split('\n'); let pos = 0; for (let i = 0; i < line; i++) pos += lines[i].length + 1;
      const node = body.firstChild; if (!node) return;
      const r = document.createRange(); r.setStart(node, pos); r.setEnd(node, pos + lines[line].length);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      const lh = parseFloat(getComputedStyle(body).lineHeight) || 16;
      body.scrollTop = Math.max(0, line * lh - body.clientHeight / 3);
    }
    function open(f, title) {
      const bi = /\.(MSF|BKSCRIPT)$/i.test(title) ? null : binInfo(f.data);
      // .bin files: the data without the header (the left column shows BK addresses)
      file = Object.assign({}, f, { bin: bi, body: bi ? f.data.subarray(bi.off, bi.off + bi.len) : f.data });
      $('fvtitle').textContent = title;
      // state files: the picture of the screen saved with them
      const pv = /\.MSF$/i.test(title) && api.preview ? api.preview(f.data) : null;
      $('fvimg').hidden = !pv; $('fvimg').innerHTML = '';
      if (pv) { $('fvimg').appendChild(pv.canvas); const t = document.createElement('span'); t.textContent = pv.info; $('fvimg').appendChild(t); }
      $('fvorg').value = ''; $('fvorg').placeholder = oct(bi ? bi.addr : 0);
      w.hidden = false; fw.place(); render(); body.scrollTop = 0; body.focus();
    }
    function close() { w.hidden = true; file = null; }
    $('fvmode').onchange = () => { mode = $('fvmode').value; api.store('fv.mode', mode); render(); body.focus(); };
    $('fvorg').oninput = () => render();
    $('fvgo').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); goTo($('fvgo').value); body.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); body.focus(); }
      else e.stopPropagation();
    });
    $('fvorg').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); body.focus(); } else e.stopPropagation(); });
    $('fvenc').onchange = () => { enc = $('fvenc').value; api.store('fv.enc', enc); render(); body.focus(); };
    $('fvclose').onclick = () => { close(); const l = document.querySelector('#fcwin .fcpanel.act .fclist'); if (l) l.focus(); };
    w.addEventListener('keydown', (e) => {
      if ((e.target.tagName === 'SELECT' || e.target.closest('.usel')) && e.key !== 'Escape') return;
      const k = e.key;
      if (k === 'Escape' || k === 'F3' || k === 'F10') { $('fvclose').onclick(); }
      else if (k === 'F4') { mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length]; api.store('fv.mode', mode); render(); }
      else if ('tThHoOdD'.includes(k) && k.length === 1) { mode = { t: 'text', h: 'hex', o: 'oct', d: 'dis' }[k.toLowerCase()]; api.store('fv.mode', mode); render(); }
      else if (k === 'F8' || k === 'e' || k === 'E') { const i = ENC.findIndex((x) => x[0] === enc); enc = ENC[(i + 1) % ENC.length][0]; api.store('fv.enc', enc); render(); }
      else if ((k === 'g' || k === 'G' || k === ':') && mode !== 'text') { $('fvgo').focus(); $('fvgo').select(); }
      else if ((k === 'w' || k === 'W') && mode === 'text') setWrap(!wrap);
      else if (k === 'Home') body.scrollTop = 0;
      else if (k === 'End') body.scrollTop = body.scrollHeight;
      else return;
      e.preventDefault(); e.stopPropagation();
    });
    return { open, close, hasFocus: () => !w.hidden && w.contains(document.activeElement) };
  }

  // ---- editor (F4): text in an encoding (each byte has its character: the file comes back byte for byte) or hex
  function makeEditor(api) {
    const w = $('fewin'), ta = $('fetext'), hx = $('fehex'), rows = hx.querySelector('.ferows'), sp = hx.querySelector('.fesp');
    let doc = null, mode = api.load('fe.mode') === 'hex' ? 'hex' : 'text', enc = api.load('fv.enc') || 'bk', bytes = null, dirty = false, eol = '\n', ctrlZ = false;
    let pos = 0, nib = 0, pane = 'hex';
    let wrap = api.load('fe.wrap') === '1'; // text: long lines wrapped by words on screen (the file keeps its lines)
    const setWrap = (v) => { wrap = v; api.store('fe.wrap', v ? '1' : '0'); $('fewrap').classList.toggle('on', v); ta.classList.toggle('wrap', v); ta.wrap = v ? 'soft' : 'off'; };
    setWrap(wrap);
    $('fewrap').onclick = () => { setWrap(!wrap); ta.focus(); };
    const wrapShown = () => { $('fewrap').hidden = mode !== 'text'; };
    const fw = api.floatWin(w, 'fepos', () => {
      const r = $('fcwin').getBoundingClientRect(), vw = document.documentElement.clientWidth;
      return { x: Math.max(4, Math.min(r.left + 60, vw - w.offsetWidth - 4)), y: Math.max(8, r.top + 40) };
    });
    ENC.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; $('feenc').appendChild(o); });
    const info = (t, err) => { $('feinfo').textContent = t; $('feinfo').classList.toggle('err', !!err); };
    let dlgEnd = null; // questions of the editor: a box inside its own window
    function ask(o) {
      const d = $('fedlg');
      d.querySelector('.t').textContent = o.title || ''; const x = d.querySelector('.x'); x.textContent = o.text || ''; if (o.body) x.appendChild(o.body);
      const okb = d.querySelector('.ok'); okb.textContent = o.ok || 'OK'; d.querySelector('.no').textContent = o.no || 'Cancel';
      d.hidden = false; setTimeout(() => (o.focus ? o.focus() : okb.focus()), 20);
      return new Promise((res) => { dlgEnd = (v) => { d.hidden = true; dlgEnd = null; (mode === 'text' ? ta : hx).focus(); res(v); }; });
    }
    $('fedlg').querySelector('.ok').onclick = () => dlgEnd && dlgEnd(true);
    $('fedlg').querySelector('.no').onclick = () => dlgEnd && dlgEnd(false);
    $('fedlg').addEventListener('keydown', (e) => {
      if (!dlgEnd) return;
      if (e.key === 'Escape') dlgEnd(false);
      else if (e.key === 'Enter' && (e.target.classList.contains('ok') || e.target.tagName === 'INPUT')) dlgEnd(true);
      else if (e.key === 'Enter' && e.target.classList.contains('no')) dlgEnd(false);
      else { e.stopPropagation(); return; }
      e.preventDefault(); e.stopPropagation();
    });
    const showInfo = () => info((bytes ? bytes.length : 0) + ' bytes' + (dirty ? ' · changed' : '') + (mode === 'hex' ? ' · offset ' + pos.toString(8).padStart(6, '0') + ' (' + pos + ')' : ''));
    const setDirty = (v) => { dirty = v; $('fetitle').textContent = (dirty ? '* ' : '') + doc.title; showInfo(); };
    function toText(b) {
      const { dec } = edTable(enc); let end = b.length; ctrlZ = false;
      if (!doc.bin) { const z = b.indexOf(0x1A); if (z >= 0) { end = z; ctrlZ = true; } }
      let cr = 0, lf = 0, crlf = 0; for (let i = 0; i < end; i++) { if (b[i] === 13) { if (b[i + 1] === 10) { crlf++; i++; } else cr++; } else if (b[i] === 10) lf++; }
      eol = crlf >= cr && crlf >= lf && crlf ? '\r\n' : cr > lf ? '\r' : '\n'; // BK text: LF (012)
      const out = [];
      for (let i = 0; i < end; i++) {
        const c = b[i];
        if (eol === '\r\n' && c === 13 && b[i + 1] === 10) { out.push('\n'); i++; }
        else if ((eol === '\r' && c === 13) || (eol === '\n' && c === 10)) out.push('\n');
        else if (c === 9) out.push('\t');
        else out.push(dec[c]);
      }
      return out.join('');
    }
    function fromText(str) {
      const { back } = edTable(enc), out = []; let bad = 0;
      for (const ch of str) {
        if (ch === '\n') { for (const c of eol) out.push(c.charCodeAt(0)); continue; }
        if (ch === '\t') { out.push(9); continue; }
        const v = back.get(ch); if (v === undefined) { bad++; out.push(0x3F); } else out.push(v);
      }
      if (ctrlZ) out.push(0x1A);
      return { b: new Uint8Array(out), bad };
    }
    // hex: only the rows in sight are drawn; offsets octal (as the BK's addresses)
    const LH = () => parseFloat(getComputedStyle(rows).lineHeight) || 16;
    let cw = 0;
    const escH = (c) => (c === '<' ? '&lt;' : c === '&' ? '&amp;' : c === '>' ? '&gt;' : c);
    function drawHex() {
      if (mode !== 'hex' || !bytes) return;
      const lh = LH(), n = Math.ceil((bytes.length + 1) / 16);
      sp.style.height = n * lh + 'px';
      const first = Math.max(0, Math.floor(hx.scrollTop / lh)), cnt = Math.ceil(hx.clientHeight / lh) + 1, { dec } = edTable(enc);
      const disp = (v) => { const c = dec[v], k = c.charCodeAt(0); return (k >= 0x2400 && k < 0x2422) || k >= 0xE000 ? '·' : c; };
      let html = '';
      for (let r = first; r < Math.min(n, first + cnt); r++) {
        const o = r * 16; let h = '', c = '';
        for (let i = 0; i < 16; i++) {
          const k = o + i, here = k === pos, cls = here ? (pane === 'hex' ? ' class="cur"' : ' class="cur2"') : '', cls2 = here ? (pane === 'chr' ? ' class="cur"' : ' class="cur2"') : '';
          if (k < bytes.length) { const x = bytes[k].toString(16).toUpperCase().padStart(2, '0'); h += (here && pane === 'hex' ? `<b${cls}>${nib ? x[0] + '<u>' + x[1] + '</u>' : '<u>' + x[0] + '</u>' + x[1]}</b>` : `<b${cls}>${x}</b>`) + (i === 7 ? '  ' : ' '); c += `<b${cls2}>${escH(disp(bytes[k]))}</b>`; }
          else if (k === bytes.length && here) { h += `<b${cls}>__</b>` + (i === 7 ? '  ' : ' '); c += `<b${cls2}> </b>`; }
          else { h += i === 7 ? '    ' : '   '; }
        }
        html += o.toString(8).padStart(6, '0') + '  ' + h + ' ' + c + '\n';
      }
      rows.style.top = first * lh + 'px'; rows.innerHTML = html; showInfo();
    }
    function seen() {
      const lh = LH(), r = Math.floor(pos / 16), top = r * lh;
      if (top < hx.scrollTop) hx.scrollTop = top; else if (top + lh > hx.scrollTop + hx.clientHeight) hx.scrollTop = top + lh - hx.clientHeight;
      drawHex();
    }
    function setMode(m) {
      if (m === mode && (m === 'text' ? !ta.hidden : !hx.hidden)) return;
      if (mode === 'text' && !ta.hidden) { const r = fromText(ta.value); bytes = r.b; if (r.bad) info(r.bad + ' characters not in ' + enc + ': saved as ?', true); }
      mode = m; api.store('fe.mode', mode); $('femode').value = mode;
      ta.hidden = mode !== 'text'; hx.hidden = mode !== 'hex'; wrapShown();
      if (mode === 'text') { ta.value = toText(bytes); ta.focus(); ta.setSelectionRange(0, 0); ta.scrollTop = 0; }
      else { pos = Math.min(pos, bytes.length); hx.focus(); seen(); }
      showInfo();
    }
    function open(o) { // o: { title, name, data, bin, save(bytes) → message, saveAs(bytes, name, panel) → { title, msg }, targets(), here() }
      doc = o; bytes = o.data.slice(); pos = 0; nib = 0; pane = 'hex';
      enc = api.load('fv.enc') || enc; $('feenc').value = enc; $('femode').value = mode;
      w.hidden = false; fw.place();
      ta.hidden = mode !== 'text'; hx.hidden = mode !== 'hex'; wrapShown();
      if (mode === 'text') { ta.value = toText(bytes); ta.scrollTop = 0; ta.focus(); ta.setSelectionRange(0, 0); } else { hx.scrollTop = 0; hx.focus(); drawHex(); }
      setDirty(false);
    }
    const current = () => (mode === 'text' ? fromText(ta.value) : { b: bytes, bad: 0 });
    const badNote = (r) => (r.bad ? ' · ' + r.bad + ' characters not in the encoding saved as ?' : '');
    async function save() {
      if (!doc || dlgEnd) return;
      const r = current(); if (mode === 'text') bytes = r.b;
      try { const msg = await doc.save(r.b); setDirty(false); info((msg || 'Saved') + badNote(r), !!r.bad); }
      catch (e) { info('Not saved: ' + e.message, true); if (doc.saveAs) await saveAs(e.message + '.\nSave as a new file?'); }
    }
    async function saveAs(why) {
      if (!doc || !doc.saveAs || dlgEnd) return;
      const r = current(); if (mode === 'text') bytes = r.b;
      const body = document.createElement('div'); body.className = 'fesa';
      const tg = doc.targets();
      body.innerHTML = '<label>Name <input class="nm" spellcheck="false" autocomplete="off"></label><label>To <select class="tg" data-native></select></label>';
      const nm = body.querySelector('.nm'), sel = body.querySelector('.tg');
      tg.forEach(([i, t]) => { const o = document.createElement('option'); o.value = i; o.textContent = t; sel.appendChild(o); });
      const here = doc.here(); sel.value = String(why && tg.length > 1 ? (tg.find(([i]) => i !== here) || tg[0])[0] : here);
      const dot = doc.name.lastIndexOf('.'); nm.value = dot > 0 ? doc.name.slice(0, dot) + '_1' + doc.name.slice(dot) : doc.name + '_1';
      if (!await ask({ title: 'Save as', text: why ? why + '\n' : '', body, ok: 'Save', focus: () => { nm.focus(); nm.select(); } })) return;
      try { const o = await doc.saveAs(r.b, nm.value.trim(), +sel.value); doc.title = o.title; doc.name = nm.value.trim(); setDirty(false); info(o.msg + badNote(r), !!r.bad); }
      catch (e) { info('Not saved: ' + e.message, true); }
    }
    async function close() {
      if (!doc) { w.hidden = true; return; }
      if (dlgEnd) return;
      if (dirty && !await ask({ title: 'Close', text: doc.title + ' was changed. Close without saving?', ok: 'Close' })) return;
      w.hidden = true; doc = null; bytes = null;
      const l = document.querySelector('#fcwin .fcpanel.act .fclist'); if (l) l.focus();
    }
    $('femode').onchange = () => setMode($('femode').value);
    $('feenc').onchange = () => {
      const was = enc;
      if (mode === 'text') { const keep = dirty; enc = was; const r = fromText(ta.value); bytes = r.b; enc = $('feenc').value; ta.value = toText(bytes); setDirty(keep); }
      else { enc = $('feenc').value; drawHex(); }
      api.store('fv.enc', enc); (mode === 'text' ? ta : hx).focus();
    };
    $('fesave').onclick = save; $('fesaveas').onclick = () => saveAs(''); $('feclose').onclick = close;
    ta.addEventListener('input', () => { if (!dirty) setDirty(true); });
    hx.addEventListener('scroll', drawHex);
    hx.addEventListener('pointerdown', (e) => {
      if (!bytes) return;
      if (!cw) { const sp2 = document.createElement('span'); sp2.textContent = '0000000000'; rows.appendChild(sp2); cw = sp2.getBoundingClientRect().width / 10; sp2.remove(); }
      const r = rows.getBoundingClientRect(), lh = LH(), row = Math.floor((e.clientY - r.top) / lh) + Math.floor(parseFloat(rows.style.top || 0) / lh);
      const col = Math.floor((e.clientX - r.left - parseFloat(getComputedStyle(rows).paddingLeft)) / cw);
      let k = -1;
      if (col >= 8 && col < 8 + 49) { const c = col - 8, i = c < 24 ? Math.floor(c / 3) : Math.floor((c - 25) / 3) + 8; if (i >= 0 && i < 16) { k = row * 16 + i; pane = 'hex'; nib = 0; } }
      else if (col >= 58 && col < 74) { k = row * 16 + (col - 58); pane = 'chr'; }
      if (k >= 0) { pos = Math.min(k, bytes.length); e.preventDefault(); hx.focus(); drawHex(); }
    });
    hx.addEventListener('keydown', (e) => {
      if (!bytes) return;
      const k = e.key, rowsIn = Math.max(1, Math.floor(hx.clientHeight / LH()) - 1);
      const mv = (p) => { pos = Math.max(0, Math.min(bytes.length, p)); nib = 0; seen(); };
      if (e.ctrlKey || e.metaKey || e.altKey) { if (k === 'Home') mv(0); else if (k === 'End') mv(bytes.length); else return; }
      else if (k === 'ArrowRight') { if (pane === 'hex' && !nib && pos < bytes.length) { nib = 1; drawHex(); } else mv(pos + 1); }
      else if (k === 'ArrowLeft') { if (pane === 'hex' && nib) { nib = 0; drawHex(); } else mv(pos - 1); }
      else if (k === 'ArrowDown') mv(pos + 16); else if (k === 'ArrowUp') mv(pos - 16);
      else if (k === 'PageDown') mv(pos + 16 * rowsIn); else if (k === 'PageUp') mv(pos - 16 * rowsIn);
      else if (k === 'Home') mv(pos - pos % 16); else if (k === 'End') mv(Math.min(bytes.length, pos - pos % 16 + 15));
      else if (k === 'Tab') { pane = pane === 'hex' ? 'chr' : 'hex'; nib = 0; drawHex(); }
      else if (k === 'Insert') { const b = new Uint8Array(bytes.length + 1); b.set(bytes.subarray(0, pos)); b.set(bytes.subarray(pos), pos + 1); bytes = b; nib = 0; setDirty(true); seen(); }
      else if (k === 'Delete') { if (pos < bytes.length) { const b = new Uint8Array(bytes.length - 1); b.set(bytes.subarray(0, pos)); b.set(bytes.subarray(pos + 1), pos); bytes = b; nib = 0; setDirty(true); seen(); } }
      else if (k === 'Backspace') mv(pos - 1);
      else if (pane === 'hex' && /^[0-9a-f]$/i.test(k)) {
        if (pos >= bytes.length) { const b = new Uint8Array(bytes.length + 1); b.set(bytes); bytes = b; }
        const v = parseInt(k, 16); bytes[pos] = nib ? (bytes[pos] & 0xF0) | v : (bytes[pos] & 0x0F) | (v << 4);
        if (nib) { nib = 0; pos++; } else nib = 1;
        setDirty(true); seen();
      } else if (pane === 'chr' && k.length === 1) {
        const v = edTable(enc).back.get(k); if (v === undefined) { info('"' + k + '" is not in ' + enc, true); e.preventDefault(); return; }
        if (pos >= bytes.length) { const b = new Uint8Array(bytes.length + 1); b.set(bytes); bytes = b; }
        bytes[pos] = v; pos++; setDirty(true); seen();
      } else return;
      e.preventDefault(); e.stopPropagation();
    });
    w.addEventListener('keydown', (e) => {
      if (dlgEnd) { if (!$('fedlg').contains(e.target)) { e.preventDefault(); e.stopPropagation(); } return; }
      if ((e.target.tagName === 'SELECT' || (e.target.closest && e.target.closest('.usel'))) && e.key !== 'Escape') return;
      const k = e.key;
      if (k === 'Escape' || k === 'F10') close();
      else if ((k === 'F2' && e.shiftKey) || ((e.ctrlKey || e.metaKey) && e.shiftKey && (k === 's' || k === 'S'))) saveAs('');
      else if (k === 'F2' || ((e.ctrlKey || e.metaKey) && (k === 's' || k === 'S'))) save();
      else if (k === 'F4') setMode(mode === 'text' ? 'hex' : 'text');
      else if (e.altKey && e.code === 'KeyW' && mode === 'text') setWrap(!wrap);
      else if (k === 'F8') { const i = ENC.findIndex((x) => x[0] === enc); $('feenc').value = ENC[(i + 1) % ENC.length][0]; $('feenc').onchange(); }
      else { e.stopPropagation(); return; } // typing stays in the editor
      e.preventDefault(); e.stopPropagation();
    });
    return { open, close, get isOpen() { return !w.hidden; }, hasFocus: () => !w.hidden && w.contains(document.activeElement) };
  }

  function create(api) {
    const win = $('fcwin');
    // sources: the server sets (api.sets(): [{ id, name, url }]), sets opened from the PC (zips), RAM
    const ram = { name: 'RAM', files: api.ramFiles };
    const own = []; // { id, name, set }
    function srcList() {
      const out = [];
      api.sets().forEach((s) => out.push([s.id, s.name]));
      own.forEach((s) => out.push([s.id, s.name]));
      if (api.drives) api.drives().forEach((d) => out.push(['D' + d.i, d.label]));
      out.push(['RAM', 'RAM']);
      return out;
    }
    let SRC = [];
    const P = [0, 1].map((i) => ({ el: $('fcp' + i), src: api.load('fc.src' + i) || (i ? 'RAM' : ''), want: null, vol: null, items: [], cur: 0, sel: new Set(), msg: '', dir: [], sort: ['ext', 'name', 'size'].includes(api.load('fc.sort' + i)) ? api.load('fc.sort' + i) : 'ext' }));
    let act = 0;
    P.forEach((p) => { p.want = p.src; });
    const fw = api.floatWin(win, 'fcpos', () => {
      const r = $('screenwrap').getBoundingClientRect(), vw = document.documentElement.clientWidth;
      return { x: Math.max(4, Math.min(r.left + (r.width - win.offsetWidth) / 2, vw - win.offsetWidth - 4)), y: Math.max(8, r.top + 30) };
    });

    // open a source as a volume; server sets are fetched once (the panel shows "loading…" meanwhile)
    const vols = new Map();
    function openVol(src) {
      if (src === 'RAM') return { vol: vols.get('RAM') || vols.set('RAM', setVolume(ram, 'RAM')).get('RAM') };
      if (/^D\d$/.test(src)) return driveVol(+src[1]);
      const o = own.find((s) => s.id === src);
      if (o) return { vol: vols.get(src) || vols.set(src, setVolume(o.set, o.set.kind || 'ZIP')).get(src) };
      const s = api.sets().find((x) => x.id === src);
      if (!s) return { err: 'no such set' };
      if (vols.has(src)) return { vol: vols.get(src) };
      if (!s.loading) {
        s.loading = api.loadSet(s).then((set) => { vols.set(src, setVolume(set, 'ZIP')); }).catch((e) => { s.err = e.message; })
          .finally(() => { s.loading = null; P.forEach((p, i) => { if (p.src === src) load(i); }); });
      }
      return { err: s.err || 'loading ' + s.name + '…' };
    }
    // a mounted drive: its files as the machine has them now (read only: the BK's DOS keeps its own copy of the directory)
    const dvols = new Map();
    function driveVol(i) {
      const d = api.drives().find((x) => x.i === i); if (!d) return { err: 'not mounted' };
      const data = api.driveData(i); if (!data) return { err: 'no image' };
      const disk = window.BKDisk.open(d.name, data);
      if (!disk) return { err: d.hdd ? 'HDD image: files are not shown (Eject: ⏏)' : 'unknown file system' };
      const ro = { kind: disk.kind, label: disk.label, files: disk.files, dirs: disk.dirs, free: disk.free };
      const set = { name: d.label, kind: disk.kind, disk: ro, mounted: true, files: disk.files.map((f) => ({ path: f.path, data: f.data, disk: f })) };
      const old = dvols.get(i), vol = setVolume(set, disk.kind);
      if (old) vol.setPath(old.dir() ? old.dir().replace(/\/$/, '').split('/') : []);
      dvols.set(i, vol);
      return { vol };
    }
    function fillSrc() {
      const av = SRC = srcList();
      P.forEach((p, i) => {
        if (!av.some((x) => x[0] === p.src)) p.src = (av.find((x) => x[0] === p.want) || av[i ? av.length - 1 : 0] || ['RAM'])[0];
        const sel = p.el.querySelector('.fcsrc'); sel.innerHTML = '';
        av.forEach(([v, t]) => { const op = document.createElement('option'); op.value = v; op.textContent = t; sel.appendChild(op); });
        sel.value = p.src;
      });
    }
    function load(i) {
      const p = P[i];
      const r = openVol(p.src);
      p.vol = r.vol || null; p.msg = r.err || '';
      if (p.vol && p.vol.setPath) p.dir = p.vol.setPath(p.dir);
      p.items = p.vol ? sortItems(p.vol.list(), p.sort) : [];
      p.sel.clear(); p.cur = Math.min(p.cur, Math.max(0, p.items.length - 1));
      draw(i);
    }
    // folders first (".." on top), then files: ext — by extension, then name; name — by name, then extension; size — largest first
    function sortItems(items, how) {
      const up = items.filter((x) => x.up), dirs = items.filter((x) => x.dir && !x.up), files = items.filter((x) => !x.dir);
      const by = (a, b) => a.localeCompare(b);
      dirs.sort((a, b) => by(a.name, b.name));
      files.sort(how === 'size' ? (a, b) => b.size - a.size || by(a.name, b.name) : how === 'name' ? (a, b) => by(a.name, b.name) || by(a.ext, b.ext) : (a, b) => by(a.ext, b.ext) || by(a.name, b.name));
      return up.concat(dirs, files);
    }
    function draw(i) {
      const p = P[i], el = p.el;
      el.classList.toggle('act', i === act);
      el.querySelector('.fcsrc').value = p.src;
      el.querySelector('.fcsort').value = p.sort;
      el.querySelector('.fckind').textContent = p.vol ? (p.vol.kind + (p.vol.path !== '/' ? ' · ' + p.vol.path : '')) : '';
      const ej = el.querySelector('.fceject'); ej.hidden = !/^D\d$/.test(p.src);
      const dv = /^D\d$/.test(p.src) && api.drives().find((d) => d.i === +p.src[1]);
      el.querySelector('.fcboot').hidden = !(dv && dv.boot);
      const list = el.querySelector('.fclist');
      list.innerHTML = '';
      if (!p.vol && p.msg) { const m = document.createElement('div'); m.className = 'fcmsg'; m.textContent = p.msg; list.appendChild(m); }
      p.items.forEach((it, k) => {
        const r = document.createElement('div');
        r.className = 'fcrow' + (k === p.cur ? ' cur' : '') + (p.sel.has(k) ? ' sel' : '') + (it.dir ? ' dir' : '');
        r.innerHTML = '<span class="n"></span><span class="e"></span><span class="s"></span>';
        r.children[0].textContent = it.name; r.children[1].textContent = it.ext; r.children[2].textContent = it.dir ? it.show : fmtSize(it.show);
        r.title = it.dir ? (it.up ? 'up' : it.name + ': folder (Enter opens it)') : it.bin ? `${it.name}${it.ext ? '.' + it.ext : ''}  address ${oct(it.bin.addr)}  length ${oct(it.bin.len)} (${it.bin.len})` : `${it.name}.${it.ext}  ${it.size} bytes`;
        r.onmousedown = (e) => {
          e.preventDefault(); setAct(i);
          const now = performance.now(), dbl = e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && lastDown.i === i && lastDown.k === k && now - lastDown.t < 450;
          lastDown = dbl ? { t: 0 } : { i, k, t: now };
          p.cur = k;
          if (dbl) { draw(i); list.focus(); if (it.dir) enter(); else run(); return; }
          if (e.ctrlKey || e.metaKey) toggle(p, k);
          else if (e.shiftKey) { p.sel.add(k); }
          draw(i); list.focus();
        };
        list.appendChild(r);
      });
      const n = p.sel.size, bytes = [...p.sel].reduce((s, k) => s + (p.items[k] ? p.items[k].size : 0), 0);
      el.querySelector('.fcfoot').textContent = p.vol
        ? (n ? `${n} selected, ${fmtSize(bytes)}` : `${p.items.filter((x) => !x.dir).length} files`) + (p.vol.kind === 'RAM' ? ` · free ${fmtSize(p.vol.free())}` : '') : ' ';
      const c = list.children[p.cur]; if (c && i === act) c.scrollIntoView({ block: 'nearest' });
    }
    let lastDown = { t: 0 };
    const toggle = (p, k) => { if (!p.items[k] || p.items[k].up) return; if (p.sel.has(k)) p.sel.delete(k); else p.sel.add(k); };
    function setAct(i) { if (act !== i) { act = i; draw(0); draw(1); } }
    const picked = (p, dirs) => (p.sel.size ? [...p.sel].sort((a, b) => a - b).map((k) => p.items[k]) : (p.items[p.cur] ? [p.items[p.cur]] : [])).filter((it) => it && !it.up && (dirs || !it.dir));
    // files and folders picked → files with their paths from this directory (a folder: all files in it)
    function expand(p, list) {
      const out = [];
      for (const it of list) {
        if (!it.dir) { out.push({ rel: '', it, data: it.id.data, name: fname(it) }); continue; }
        if (!p.vol.filesIn) continue;
        for (const { rel, f } of p.vol.filesIn(it)) out.push({ rel: rel.replace(/[^/]*$/, ''), f, data: f.data, name: f.path.replace(/^.*\//, '') });
      }
      return out;
    }
    function enter() {
      const p = P[act], it = p.items[p.cur];
      if (!p.vol || !it || !it.dir) return false;
      const from = p.vol.path;
      p.dir = p.vol.enter(it);
      p.items = sortItems(p.vol.list(), p.sort); p.sel.clear(); p.cur = 0;
      if (it.up) { const back = from.slice(from.lastIndexOf('/') + 1); const k = p.items.findIndex((x) => x.dir && x.name === back); if (k >= 0) p.cur = k; }
      draw(act); return true;
    }
    function goUp() { const p = P[act]; if (p.items[0] && p.items[0].up) { p.cur = 0; enter(); return true; } return false; }
    function status(t, err) { $('fcstat').textContent = t || ''; $('fcstat').classList.toggle('err', !!err); }

    // ---- own small dialogs inside the window: ask({ title, text, ok }) → Promise<boolean>
    let dlgDone = null;
    // the dialog lives on the page (not in this window): its box is centred on the BK window, inside the screen
    const dlg = $('fcdlg'); document.body.appendChild(dlg);
    function placeDlg() {
      if (dlg.hidden) return;
      const box = dlg.querySelector('.box'), sw = $('screenwin'), vw = document.documentElement.clientWidth, vh = window.innerHeight;
      const r = sw ? sw.getBoundingClientRect() : { left: 0, top: 0, width: vw, height: vh };
      const bw = box.offsetWidth, bh = box.offsetHeight;
      box.style.left = Math.max(8, Math.min(r.left + (r.width - bw) / 2, vw - bw - 8)) + 'px';
      box.style.top = Math.max(8, Math.min(r.top + (r.height - bh) / 2, vh - bh - 8)) + 'px';
    }
    window.addEventListener('resize', placeDlg);
    // o.buttons: several answers (the index is returned, -1 = Esc); else OK / Cancel (true / false)
    function ask(o) {
      const d = $('fcdlg');
      d.querySelector('.t').textContent = o.title; d.querySelector('.x').textContent = o.text;
      const labels = o.buttons || [o.ok || 'OK', o.no || 'Cancel'];
      const bar = d.querySelector('.b'); bar.innerHTML = '';
      labels.forEach((l, i) => {
        const e = document.createElement('button'); e.textContent = l;
        if (i === 0) e.className = 'ok primary' + (o.danger ? ' danger' : '');
        else if (!o.buttons) e.className = 'no';
        e.onclick = () => dlgDone && dlgDone(o.buttons ? i : i === 0);
        bar.appendChild(e);
      });
      let inp = null; // a name to type (New folder, Save as): Enter takes it
      if (o.input !== undefined) { inp = document.createElement('input'); inp.className = 'dlgin'; inp.value = o.input; inp.spellcheck = false; inp.autocomplete = 'off'; d.querySelector('.x').appendChild(inp); }
      d.hidden = false; placeDlg(); if (inp) { inp.focus(); inp.select(); } else bar.querySelector('button').focus();
      return new Promise((res) => { dlgDone = (v) => { d.hidden = true; dlgDone = null; P[act].el.querySelector('.fclist').focus();
        res(inp ? (v === true ? inp.value.trim() : null) : o.buttons ? (v === true ? 0 : v === false ? -1 : v) : v); }; });
    }
    const askName = (title, text, value) => ask({ title, text, input: value, ok: 'OK' });
    $('fcdlg').addEventListener('keydown', (e) => {
      if (!dlgDone) return;
      const b = [...$('fcdlg').querySelectorAll('button')], at = b.indexOf(document.activeElement);
      if (e.target.tagName === 'INPUT') { if (e.key === 'Enter') dlgDone(true); else if (e.key === 'Escape') dlgDone(false); else { e.stopPropagation(); return; } e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === 'Escape') dlgDone(false);
      else if (e.key === 'Enter' || e.key === ' ') { (at >= 0 ? b[at] : b[0]).click(); } // the focused answer (also from on-screen keys)
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) b[(Math.max(0, at) - 1 + b.length) % b.length].focus();
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'Tab') b[(at + 1) % b.length].focus();
      else return;
      e.preventDefault(); e.stopPropagation();
    });
    const fname = (it) => it.name + (it.ext ? '.' + it.ext : '');
    const what = (list) => list.length === 1 ? fname(list[0]) + (list[0].dir ? ' (folder)' : '') : list.length + ' items (' + fmtSize(list.reduce((n, it) => n + it.size, 0)) + ')';
    const srcName = (p) => (SRC.find((x) => x[0] === p.src) || ['', p.src])[1];

    async function copy() {
      const s = P[act], t = P[1 - act];
      if (!s.vol || !t.vol) { status('Both panels need a set', true); return; }
      if (s.src === t.src && s.vol.dir() === t.vol.dir()) { status('Source and target are the same', true); return; }
      const list = picked(s, true); if (!list.length) return;
      const files = expand(s, list); if (!files.length) { status('Nothing to copy (empty folder)', true); return; }
      if (!await ask({ title: 'Copy', text: `Copy ${what(list)}\nfrom ${srcName(s)} to ${srcName(t)}${t.vol.path !== '/' ? ' ' + t.vol.path : ''}?`, ok: 'Copy' })) return;
      let ok = 0; const errs = [];
      for (const f of files) {
        const { base, ext } = splitName(f.name);
        try { t.vol.write({ name: base, ext, data: f.data.slice(), dir: f.rel }); ok++; } catch (e) { errs.push(f.rel + f.name + ': ' + e.message); }
      }
      load(1 - act); s.sel.clear(); draw(act);
      status(errs.length ? `Copied ${ok}, errors: ` + errs.join('; ') : `Copied ${ok} file${ok === 1 ? '' : 's'}`, errs.length > 0);
    }
    async function del() {
      const s = P[act]; if (!s.vol) return;
      const list = picked(s, true); if (!list.length) return;
      if (!await ask({ title: 'Delete', text: `Delete ${what(list)} from ${srcName(s)}?` + (s.vol.kind === 'ZIP' ? '\n(only in this page: server file stays)' : ''), ok: 'Delete', danger: true })) return;
      try { for (const it of list) s.vol.del(it); } catch (e) { status(e.message, true); load(act); return; }
      load(act); if (P[1 - act].src === s.src) load(1 - act);
      status(`Deleted ${list.length}`);
    }
    async function mkdir() {
      const s = P[act]; if (!s.vol) return;
      if (!s.vol.mkdir) { status(s.vol.kind + ': no folders here', true); return; }
      const name = await askName('New folder', 'Folder name:', 'NEWDIR'); if (!name) return;
      try { s.vol.mkdir(name); } catch (e) { status(e.message, true); return; }
      load(act); const k = s.items.findIndex((x) => x.dir && x.name === name.toUpperCase()); if (k >= 0) { s.cur = k; draw(act); }
      status('Folder ' + name.toUpperCase());
    }
    async function download() { // one file as is; several files or folders in FCfiles.zip (folders kept)
      const s = P[act]; if (!s.vol) return;
      const list = picked(s, true); if (!list.length) return;
      const files = expand(s, list).map((f) => ({ name: (f.rel + f.name).split('/').map((x) => x.replace(/[\\:*?"<>|]/g, '_')).join('/'), data: f.data }));
      if (!files.length) return;
      if (files.length === 1 && !list[0].dir) { api.download(files[0].name, files[0].data); return; }
      api.download(list.length === 1 && list[0].dir ? list[0].name + '.zip' : 'FCfiles.zip', await api.zip(files));
      status(`${files.length} files in zip`);
    }
    // Upload Files: files from the PC into this panel; a zip is unpacked with its folders (asZip: it opens as a new set)
    function upload(files, asSet) {
      const t = P[act];
      Promise.all([...files].map((fl) => fl.arrayBuffer().then((b) => [fl.name, new Uint8Array(b)]))).then(async (arr) => {
        let ok = 0; const errs = [];
        for (const [nm, data] of arr) {
          if (/\.zip$/i.test(nm)) {
            try {
              const set = await api.openZip(nm, data);
              if (asSet || !t.vol || t.vol.set.disk) { addSet(set, act); ok++; continue; }
              for (const f of set.files) { const { base, ext } = splitName(f.path.replace(/^.*\//, '')); try { t.vol.write({ name: base, ext, data: f.data, dir: f.path.replace(/[^/]*$/, '') }); ok++; } catch (e) { errs.push(f.path + ': ' + e.message); } }
            } catch (e) { errs.push(nm + ': ' + e.message); }
            continue;
          }
          if (!t.vol) { errs.push(nm + ': no set in this panel'); continue; }
          const { base, ext } = splitName(nm.replace(/^.*[\\/]/, ''));
          try { t.vol.write({ name: base, ext, data }); ok++; } catch (e) { errs.push(nm + ': ' + e.message); }
        }
        load(act);
        status(errs.length ? `Added ${ok}, errors: ` + errs.join('; ') : `Added ${ok} file${ok === 1 ? '' : 's'}`, errs.length > 0);
      });
    }
    let ownN = 0;
    function addSet(set, i) {
      const id = 'Z' + (++ownN);
      own.push({ id, name: set.name, set });
      fillSrc();
      const p = P[i]; p.src = p.want = id; p.cur = 0; p.dir = [];
      fillSrc(); load(i);
      return id;
    }

    function key(e) {
      const p = P[act];
      const k = e.key;
      if (k === 'Tab') { setAct(1 - act); return true; }
      if (k === 'ArrowDown') { p.cur = Math.min(p.items.length - 1, p.cur + 1); draw(act); return true; }
      if (k === 'ArrowUp') { p.cur = Math.max(0, p.cur - 1); draw(act); return true; }
      if (k === 'Home') { p.cur = 0; draw(act); return true; }
      if (k === 'End') { p.cur = Math.max(0, p.items.length - 1); draw(act); return true; }
      if (k === 'PageDown') { p.cur = Math.min(p.items.length - 1, p.cur + 10); draw(act); return true; }
      if (k === 'PageUp') { p.cur = Math.max(0, p.cur - 10); draw(act); return true; }
      if (k === 'Insert' || k === ' ') { if (p.items.length) { toggle(p, p.cur); p.cur = Math.min(p.items.length - 1, p.cur + 1); draw(act); } return true; }
      if (k === '+' || (k === 'a' && (e.ctrlKey || e.metaKey))) { p.items.forEach((it, i) => { if (!it.up) p.sel.add(i); }); draw(act); return true; }
      if (k === '-') { p.sel.clear(); draw(act); return true; }
      if (k === 'Enter') { if (!enter()) run(); return true; }
      if (k === 'Backspace') { goUp(); return true; }
      if (k === 'F3') { view(); return true; }
      if (k === 'F4') { edit(); return true; }
      if (k === 'F7') { mkdir(); return true; }
      if (k === 'F5') { copy(); return true; }
      if (k === 'F8' || k === 'Delete') { del(); return true; }
      if (k === 'F2') { fillSrc(); load(0); load(1); status('Re-read'); return true; }
      if (k === 'Escape') { show(false); return true; }
      if (k === 'F1') { show(false); return true; }
      // quick search: a letter / digit jumps to the next file starting with it
      if (k.length === 1 && /[0-9a-zа-я]/i.test(k) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const n = p.items.length, c = k.toUpperCase();
        for (let j = 1; j <= n; j++) { const q = (p.cur + j) % n; if (p.items[q].name.toUpperCase().startsWith(c)) { p.cur = q; draw(act); break; } }
        return true;
      }
      return false;
    }
    // Run: the file is started in the current model (the machine is reset); the set it is in becomes the "tape":
    // overlays and data files the program loads with EMT 36 are taken from it (its folder first)
    async function run() {
      const s = P[act]; if (!s.vol) return;
      const it = s.items[s.cur]; if (!it || it.dir) return;
      const ext = (it.ext || '').toUpperCase();
      if (api.isImage && api.isImage(fname(it), it.id.data)) {
        const r = await api.mount(fname(it), it.id.data, ask, s.vol.set && s.vol.set.url ? s.vol.set.url + '/' + it.id.path : null); if (!r) return;
        if (r.drive === undefined) { show(false); return; } // a tape
        select('D' + r.drive); // the drive in this panel: its files
        if (r.boot) show(false);
        return;
      }
      const err = api.run(s.vol, it.id, true);
      if (err) { status(err, true); return; }
      const q = ext === 'MSF' ? { title: 'Load state', text: `Load state ${fname(it)} from ${srcName(s)}?\nCurrent machine state will be lost.` }
        : ext === 'BKSCRIPT' ? { title: 'Run script', text: `Run script ${fname(it)} on ${api.modelName()}?\nIts text is typed into BK as from keyboard.`, ok: 'Run', no: 'Cancel' }
        : { title: 'Run', text: `Run ${fname(it)} from ${srcName(s)} on ${api.modelName()}?\nMachine will be reset.` };
      if (!await ask(Object.assign({ ok: 'Yes', no: 'No' }, q))) return;
      const res = api.run(s.vol, it.id, false);
      if (res) { status(res, true); return; }
      show(false);
    }
    function edit() {
      const s = P[act]; if (!s.vol) return;
      const it = s.items[s.cur]; if (!it || it.dir) return;
      const where = (p) => srcName(p) + (p.vol && p.vol.path !== '/' ? ' ' + p.vol.path : '');
      const f = s.vol.read(it), name = fname(it), vol = s.vol, src = s.src;
      editor.open({
        title: srcName(s) + ' ' + (vol.path !== '/' ? vol.path.slice(1) + '/' : '') + name, name, data: f.data, bin: !!it.bin,
        save: (b) => { const { base, ext } = splitName(name); vol.write({ name: base, ext, data: b, replace: true }); if (vol.set.disk && vol.set.reload) vol.set.reload(); P.forEach((p, i) => { if (p.src === src) load(i); }); return 'Saved to ' + where(s); },
        saveAs: (b, nm, panel) => { const p = P[panel]; if (!p.vol) throw new Error('no set in that panel'); const { base, ext } = splitName(nm.toUpperCase()); p.vol.write({ name: base, ext, data: b }); load(panel); return { title: srcName(p) + ' ' + nm.toUpperCase(), msg: 'Saved to ' + where(p) }; },
        targets: () => P.map((p, i) => [i, where(p)]), here: () => act,
      });
    }
    function view() {
      const s = P[act]; if (!s.vol) return;
      const it = s.items[s.cur]; if (!it || it.dir) return;
      viewer.open(s.vol.read(it), srcName(s) + ' ' + (s.vol.path !== '/' ? s.vol.path.slice(1) + '/' : '') + fname(it));
    }

    // a source in the active panel (a drive just mounted, a server set from Load)
    function select(id) { fillSrc(); const p = P[act]; p.src = p.want = id; p.cur = 0; p.dir = []; api.store('fc.src' + act, id); fillSrc(); load(act); }
    // ---- wiring
    P.forEach((p, i) => {
      const sel = p.el.querySelector('.fcsrc');
      sel.onchange = () => { p.src = p.want = sel.value; api.store('fc.src' + i, p.src); p.cur = 0; p.dir = []; setAct(i); load(i); setTimeout(() => p.el.querySelector('.fclist').focus(), 0); }; // after the list gives the focus back to its box
      const list = p.el.querySelector('.fclist');
      list.tabIndex = 0;
      list.addEventListener('focus', () => setAct(i));
      list.addEventListener('keydown', (e) => { if (key(e)) { e.preventDefault(); e.stopPropagation(); } });
      list.addEventListener('dragover', (e) => { e.preventDefault(); list.classList.add('drop'); });
      list.addEventListener('dragleave', () => list.classList.remove('drop'));
      list.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); list.classList.remove('drop'); setAct(i); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); });
    });
    P.forEach((p) => { p.el.querySelector('.fcboot').onclick = async () => {
      const d = +p.src.slice(1); if (!/^D\d$/.test(p.src)) return;
      if (!await ask({ title: 'Boot', text: `Boot from ${srcName(p)}?\nMachine restarts` + (d >= 4 ? '.' : (d ? ', image goes to A:.' : '.')), ok: 'Boot' })) return;
      const to = await api.boot(d); if (to === false) return;
      select('D' + to); show(false);
    }; });
    P.forEach((p, i) => { p.el.querySelector('.fceject').onclick = async () => {
      const d = +p.src.slice(1); if (!/^D\d$/.test(p.src)) return;
      if (!await ask({ title: 'Eject', text: `Take ${srcName(p)} out of the drive?` + (d >= 4 ? '\nMachine restarts (HDD).' : ''), ok: 'Eject' })) return;
      await api.eject(d); fillSrc(); load(0); load(1); status('Ejected');
    }; });
    P.forEach((p, i) => { const so = p.el.querySelector('.fcsort'); so.value = p.sort; so.onchange = () => { p.sort = so.value; api.store('fc.sort' + i, p.sort); p.items = p.vol ? sortItems(p.vol.list(), p.sort) : []; p.sel.clear(); setAct(i); draw(i); setTimeout(() => p.el.querySelector('.fclist').focus(), 0); }; });
    $('fcview').onclick = view; $('fcedit').onclick = edit; $('fcmkdir').onclick = mkdir;
    $('fccopy').onclick = copy; $('fcdel').onclick = del;
    let upAsSet = false;
    $('fcfile').onchange = (e) => { if (e.target.files.length) upload(e.target.files, upAsSet); e.target.value = ''; };
    // the menus under the buttons (Files): a small list of commands
    let mpop = null;
    function menuClose() { if (!mpop) return; mpop.btn.classList.remove('open'); mpop.remove(); mpop = null; }
    function menuBtn(btn, items) {
      btn.onclick = (e) => {
        e.stopPropagation();
        if (mpop && mpop.btn === btn) { menuClose(); return; }
        menuClose();
        const m = document.createElement('div'); m.className = 'fcmenupop'; m.btn = btn;
        for (const [t, hint, fn] of items) { const b = document.createElement('button'); b.innerHTML = '<span></span><i></i>'; b.children[0].textContent = t; b.children[1].textContent = hint; b.onclick = (ev) => { ev.stopPropagation(); menuClose(); fn(); }; m.appendChild(b); }
        win.appendChild(m); btn.classList.add('open'); mpop = m;
        const r = btn.getBoundingClientRect(), wr = win.getBoundingClientRect();
        m.style.left = Math.max(4, Math.min(r.right - wr.left - m.offsetWidth, wr.width - m.offsetWidth - 4)) + 'px'; m.style.top = (r.top - wr.top - m.offsetHeight - 2) + 'px';
      };
    }
    document.addEventListener('pointerdown', (e) => { if (mpop && !mpop.contains(e.target) && e.target !== mpop.btn) menuClose(); }, true);
    menuBtn($('fcfiles'), [['Download Files', 'to PC: one as is, more or folders as zip', () => download()],
      ['Upload Files', 'from PC: zip unpacked with folders', () => { upAsSet = false; $('fcfile').click(); }],
      ['Open zip as set', 'from PC: zip in panel list', () => { upAsSet = true; $('fcfile').click(); }]]);
    $('fcclose').onclick = () => show(false);
    // help: over the panels, ? in the title or Esc closes it
    // help: a window of its own at File Commander's side (right, or left when there is no room), then it can be dragged
    let helpFW = null;
    function helpShow(v) {
      const h = $('fchelp');
      if (!helpFW) helpFW = api.floatWin(h, 'fchelppos', () => ({ x: 0, y: 0 }));
      h.hidden = !v; $('fchelpbtn').classList.toggle('on', v);
      if (v) { const r = win.getBoundingClientRect(); h.style.height = Math.max(r.height, 360) + 'px'; helpFW.setPos(api.snapRight(r, h)); h.focus({ preventScroll: true }); }
      else if (!win.hidden) P[act].el.querySelector('.fclist').focus();
    }
    $('fchelpclose').onclick = () => helpShow(false);
    $('fchelp').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); helpShow(false); } });
    $('fchelpbtn').onclick = () => helpShow($('fchelp').hidden);
    win.addEventListener('keydown', (e) => { if (dlgDone || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.closest('.usel')) return; if (key(e)) { e.preventDefault(); e.stopPropagation(); } });
    // keys go to the active panel again whenever the window gets the focus back
    const focusList = () => { if (!win.hidden && !dlgDone && !viewer.hasFocus()) P[act].el.querySelector('.fclist').focus({ preventScroll: true }); };
    win.addEventListener('pointerup', (e) => { if (!e.target.closest('select, input, button, .fclist')) focusList(); });

    const viewer = makeViewer(api);
    const editor = makeEditor(api);
    function show(v) {
      if (!v && dlgDone) dlgDone(false);
      if (!v) { viewer.close(); editor.close(); }
      if (!v && !$('fchelp').hidden) helpShow(false);
      win.hidden = !v;
      $('fcbtn').classList.toggle('on', v); if ($('fctb')) $('fctb').classList.toggle('on', v);
      if (v) { fw.place(); fillSrc(); load(0); load(1); status('Tab: other panel · Space/Ins: select · Enter / double click: run, open folder · F3 view · F5 copy · F8 delete · F2 re-read · ? help'); P[act].el.querySelector('.fclist').focus(); }
      else if (api.onClose) api.onClose();
    }
    // the file under the cursor of the active panel (the monitor's "M" with an empty name)
    function current() { const p = P[act]; const it = p.items[p.cur]; return p.vol && it && !it.dir ? { vol: p.vol, file: it.id } : null; }
    return {
      show, get open() { return !win.hidden; }, hasFocus: () => win.contains(document.activeElement) || viewer.hasFocus() || editor.hasFocus(),
      current, ask, dialogOpen: () => !!dlgDone, addSet: (set, other) => addSet(set, other ? 1 - act : act), refresh: () => { if (!win.hidden) { fillSrc(); load(0); load(1); } },
      select,
    };
  }
  window.BKFC = { create, binInfo, bkName, splitName, setVolume, _test: { PDP } };
})();
