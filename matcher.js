// ===== Shelf Count matcher: fuzzy part-number + description matching =====
const Matcher = (() => {
  const ONES = {zero:0,oh:0,none:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19};
  const TENS = {twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
  const END_HOMOPHONES = {won:1,to:2,too:2,tree:3,for:4,fore:4,ate:8};
  const LETTERS = {a:'A',alpha:'A',ay:'A',b:'B',bee:'B',be:'B',bravo:'B',c:'C',see:'C',sea:'C',charlie:'C',d:'D',dee:'D',delta:'D',e:'E',ee:'E',echo:'E',f:'F',eff:'F',ef:'F',foxtrot:'F',g:'G',gee:'G',golf:'G',h:'H',aitch:'H',hotel:'H',i:'I',eye:'I',india:'I',j:'J',jay:'J',juliet:'J',k:'K',kay:'K',kilo:'K',l:'L',el:'L',ell:'L',lima:'L',m:'M',em:'M',mike:'M',n:'N',en:'N',november:'N',o:'O',oscar:'O',p:'P',pee:'P',papa:'P'};
  const STOP = new Set('the a an of and with for to in on at is it its this that um uh okay ok so like part parts number pn p/n guess maybe think i im i\'m we got have has there here about around roughly approx approximately some just counted count qty quantity x times pcs pieces piece each of them units unit ea'.split(' '));
  const QTY_KEYS = new Set(['qty','quantity','count','counted','x','times','pcs','pieces','piece','each','ea','units','unit','of','have','got']);
  const LOC_FILLER = /\b(i'?m|i am|we'?re|now|moving|move|going|go|to|on|at|in|switching|switch|starting|start|next|the|okay|ok)\b/g;
  // sound-alike substitution pairs for part-number characters
  const ALIKE = [['A','8'],['O','0'],['I','1'],['L','1'],['S','5'],['B','8'],['Z','2'],['G','6'],['T','7'],['Q','0'],['D','0']];
  const alikeSet = new Set(ALIKE.flatMap(([a,b]) => [a+b, b+a]));

  const SYN = {sw:'switch',sws:'switch',xdcr:'transducer',xducer:'transducer',xmtr:'transmitter',vlv:'valve',vavle:'valve',reg:'regulator',regs:'regulator',psig:'psi',psgi:'psi',psid:'psi',assy:'assembly',elem:'element',comm:'communication',communications:'communication',temp:'temperature',thermo:'thermowell',touchscreen:'touchscreen',hmi:'hmi',xfmr:'transformer',ctrl:'controller',controllr:'controller',con:'controller',sol:'solenoid',filters:'filter',valves:'valve',kits:'kit',boards:'board',sensors:'sensor',gauges:'gauge',meters:'meter',motors:'motor',screens:'screen',relays:'relay',lesser:'leser',laser:'leser',lochinvar:'lochinvar',lock:'lock'};
  const syn = w => SYN[w] || w;
  const alnum = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g,'');

  function wordsToDigits(text) {
    let t = ' ' + text.toLowerCase()
      .replace(/[“”"]/g,' ')
      .replace(/\b(dash|hyphen|minus)\b/g,'-')
      .replace(/\b(point|dot)\b/g,'.')
      .replace(/\bslash\b/g,'/')
      .replace(/\bthree[ -]quarters?( of an?)?\b/g,'3/4').replace(/\b(one[ -])?half( an?)?(?= inch| hp| horse)/g,'1/2').replace(/\bquarter( inch)\b/g,'1/4$1')
      .replace(/\bhorse ?power\b/g,'hp').replace(/\ballen[ -]?bradley\b/g,'ab').replace(/\binches\b/g,'inch')
      .replace(/\bdouble (\w+)/g,'$1 $1')
      .replace(/\btriple (\w+)/g,'$1 $1 $1') + ' ';
    // tens + ones (twenty three -> 23)
    t = t.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[ -](one|two|three|four|five|six|seven|eight|nine)\b/g,(m,a,b)=>String(TENS[a]+ONES[b]));
    t = t.replace(/\b(one|two|three|four|five|six|seven|eight|nine) hundred(?: and)?(?: (\d+))?\b/g,(m,a,b)=>String(ONES[a]*100+(b?+b:0)));
    t = t.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g,m=>String(TENS[m]));
    t = t.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/g,m=>String(ONES[m]));
    // "oh" between digits -> 0
    t = t.replace(/(\d)\s+oh\b/g,'$1 0').replace(/\boh\s+(\d)/g,'0 $1');
    return t.replace(/\s+/g,' ').trim();
  }

  function lev(a, b, weighted) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = new Array(n+1), cur = new Array(n+1);
    for (let j=0;j<=n;j++) prev[j]=j;
    for (let i=1;i<=m;i++) {
      cur[0]=i;
      for (let j=1;j<=n;j++) {
        let sub = a[i-1]===b[j-1] ? 0 : (weighted && alikeSet.has(a[i-1]+b[j-1]) ? 0.4 : 1);
        cur[j] = Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+sub);
      }
      [prev,cur]=[cur,prev];
    }
    return prev[n];
  }
  const sim = (a,b,w) => 1 - lev(a,b,w)/Math.max(a.length,b.length);

  function tokenizeWords(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9.\/\-\s"]/g,' ').split(/[\s\/"]+/).map(w=>w.replace(/^[.\-]+|[.\-]+$/g,'')).filter(Boolean);
  }

  // ----- index a parts list -----
  function buildIndex(parts) {
    const df = new Map();
    const items = parts.map((p, i) => {
      const norm = alnum(p.id);
      const segs = String(p.id).toUpperCase().split(/[^A-Z0-9]+/).filter(s=>s.length>=2);
      const dw = new Map();
      for (const [src, wt] of [[p.type, 0.8], [p.desc, 1]]) for (const w of tokenizeWords(src)) {
        const ww = syn(w.replace(/[.\-]/g,''));
        if (ww.length >= 2 && !STOP.has(ww)) dw.set(ww, Math.max(dw.get(ww)||0, wt));
      }
      for (const w of dw.keys()) df.set(w, (df.get(w)||0)+1);
      return { i, part: p, norm, segs, words: [...dw] };
    });
    const N = parts.length;
    const idf = w => Math.log(1 + N / (df.get(w) || 0.5));
    return { items, idf, vocab: df, N };
  }

  // ----- location commands -----
  function parseLetter(w) { return LETTERS[w] || (/^[a-p]$/.test(w) ? w.toUpperCase() : null); }

  function parseLocation(t) {
    // rack = CI2 (letters+digits), shelf = A (single letter). returns {rack, bin, rest}
    let rack = null, bin = null, rest = t;
    rest = rest.replace(/\b(?:rack|shelf|shelve|shelves|self|selves|unit|cage)\s+([a-z]{1,3})\s?-?\s?(\d{1,2})\b/, (m,a,b)=>{ rack=(a+b).toUpperCase(); return ' '; });
    rest = rest.replace(/\b(?:shelf|shelve|self|bin|been|ben|bend|bins|box|slot|section|row|cubby|level)\s+(?:letter\s+)?([a-z]+)\b/, (m,w)=>{ const L=parseLetter(w); if (L){ bin=L; return ' '; } return m; });
    return { rack, bin, rest: rest.replace(/\s+/g,' ').trim() };
  }

  // ----- main parse of one utterance -----
  function parse(raw, index, ctx = {}) {
    const text = wordsToDigits(raw);
    if (!text) return null;
    const loc = parseLocation(text);
    const leftover = loc.rest.replace(LOC_FILLER,' ').replace(/[.,!?]/g,' ').trim();
    if ((loc.rack || loc.bin) && !leftover) {
      return { kind: 'location', raw, rack: loc.rack, bin: loc.bin };
    }
    const body = loc.rest;
    let tokens = body.split(/[\s,;]+/).map(t=>t.replace(/^[.\-]+|[.\-?!:]+$/g,'')).filter(Boolean);
    // zero / not found phrasing
    let zeroPhrase = /\b(not found|missing|none|no stock|can'?t find|cannot find|empty)\b/.test(body);

    const scored = scoreAll(tokens, index, ctx);
    const best = scored[0], second = scored[1];
    // quantity from tokens not consumed by the best match
    let qty = null, qtyTokenIdx = -1;
    const consumed = best ? best.consumed : new Set();
    const cands = [];
    tokens.forEach((t, k) => {
      if (consumed.has(k)) return;
      if (/^\d{1,3}$/.test(t)) cands.push(k);
      else if (k === tokens.length-1 && END_HOMOPHONES[t] != null) cands.push(k);
    });
    if (cands.length) {
      let pick = cands.find(k => QTY_KEYS.has(tokens[k-1]) || QTY_KEYS.has(tokens[k+1]));
      if (pick == null) pick = cands.find(k => !/^\d{2,}$/.test(tokens[k]) || cands.length === 1) ?? cands[0];
      // prefer the number nearest the description/PN (first unconsumed small number), unless a keyword says otherwise
      qtyTokenIdx = pick;
      const t = tokens[pick];
      qty = /^\d+$/.test(t) ? +t : END_HOMOPHONES[t];
    }
    if (qty == null && zeroPhrase) qty = 0;

    // run-together split: "ec3501" -> "ec350" + 1
    if (qty == null && best) {
      for (let k = tokens.length-1; k >= 0; k--) {
        const m = tokens[k].match(/^(.*[a-z0-9-])(\d)$/i);
        if (!m || m[1].replace(/[^a-z0-9]/gi,'').length < 3) continue;
        const t2 = tokens.slice(); t2[k] = m[1];
        const s2 = scoreAll(t2, index, ctx);
        if (s2[0] && s2[0].score > best.score + 0.05) {
          tokens = t2; qty = +m[2];
          return finish(raw, text, tokens, s2, qty, loc, ctx);
        }
      }
    }
    return finish(raw, text, tokens, scored, qty, loc, ctx);
  }

  function finish(raw, text, tokens, scored, qty, loc, ctx) {
    const best = scored[0], second = scored[1];
    const margin = best ? best.score - (second ? second.score : 0) : 0;
    let status;
    if (!best || best.score < 0.42) status = 'unknown';
    else if (best.score >= 0.72 && margin >= 0.08) status = 'matched';
    else status = 'check';
    if (qty == null && status === 'matched') status = 'needqty';
    // heard part-number-ish token for "Counted as" notes
    const heardPN = tokens.filter(t => /\d/.test(t) && /[a-z]/i.test(t) || /^\d{4,}/.test(t)).join(' ').toUpperCase();
    return {
      kind: 'count', raw, text,
      qty, foundBin: loc.bin || ctx.bin || null, inlineBin: !!loc.bin,
      status, best, top: scored.slice(0, 4), margin,
      heardPN, words: tokens
    };
  }

  function scoreAll(tokens, index, ctx) {
    const n = tokens.length;
    const up = tokens.map(t => alnum(t));
    const res = [];
    // utterance words for description match
    const uw = [];
    tokens.forEach((t,k) => {
      const w = syn(t.toLowerCase().replace(/[.\-]/g,''));
      if (!w || STOP.has(w)) return;
      if (/^\d+$/.test(w)) { uw.push({k, w, num: true}); return; }
      if (w.length < 2) return;
      uw.push({k, w, num: false});
    });
    for (const it of index.items) {
      // --- part number side ---
      let pn = 0, pnUsed = new Set(), pnExact = false;
      for (let a = 0; a < n; a++) {
        let span = '';
        for (let b = a; b < Math.min(n, a+5); b++) {
          span += up[b];
          if (!span) continue;
          const hasD = /\d/.test(span), hasL = /[A-Z]/.test(span);
          const pureDigits = hasD && !hasL;
          if (span.length < 3) continue;
          if (!hasD && span.length < 4) continue;
          let s = 0;
          for (const target of [it.norm, ...it.segs]) {
            let v = 0;
            if (target === span) v = (span.length >= 5 ? 1 : 0.7 + 0.06 * span.length) + 0.015 * Math.min(span.length, 12);
            else if (target.startsWith(span)) v = (pureDigits && span.length < 4) ? 0.5 : 0.6 + 0.4 * Math.min(1, span.length / Math.min(target.length, 7)) + 0.015 * Math.min(span.length, 12);
            else if (span.length >= 4 && target.includes(span)) v = 0.5 + 0.35 * Math.min(1, span.length / 8);
            else if (span.length >= 4 && (hasD || target === it.norm)) {
              const pre = target.slice(0, span.length + 1);
              v = Math.max(sim(span, target, true), sim(span, pre, true), sim(span, target.slice(0, span.length), true)) * 0.92;
              if (v < 0.6) v = 0;
            }
            if (target !== it.norm && v > 0) v *= 0.97;
            if (pureDigits && span.length < 4 && target !== span) v = Math.min(v, 0.5);
            s = Math.max(s, v);
          }
          if (s > pn) { pn = s; pnUsed = new Set(Array.from({length: b-a+1}, (_, x) => a + x)); pnExact = s >= 0.99; }
        }
      }
      // --- description side (idf weighted) ---
      let tot = 0, got = 0; const descUsed = new Set(); const biHit = new Set();
      for (let x = 0; x + 1 < uw.length; x++) {
        const a = uw[x], b = uw[x+1];
        if (b.k !== a.k + 1 || a.num || b.num) continue;
        const j = syn(a.w + b.w);
        const hit = it.words.find(([dw]) => dw === j || (j.length >= 6 && sim(j, dw, false) >= 0.85));
        if (hit) { const w = index.idf(hit[0]) * hit[1]; tot += w; got += w; biHit.add(a.k); biHit.add(b.k); descUsed.add(a.k); descUsed.add(b.k); }
      }
      for (const u of uw) {
        if (biHit.has(u.k)) continue;
        if (pnUsed.has(u.k) && pn >= 0.6) continue;
        const known = index.vocab.has(u.w);
        let bestSim = 0;
        for (const [dw, wt] of it.words) {
          let v;
          if (dw === u.w) v = 1;
          else if (u.num || /^\d+$/.test(dw)) v = 0;
          else if (u.w.length >= 4 && dw.length >= 4 && (dw.startsWith(u.w) || u.w.startsWith(dw))) v = 0.9;
          else if (u.w.length >= 4 && dw.length >= 4) { v = sim(u.w, dw, false); if (v < 0.75) v = 0; }
          else v = 0;
          v *= wt;
          if (v > bestSim) bestSim = v;
        }
        if (u.num) { const w = index.idf(u.w); if (bestSim > 0) { tot += w; got += w; descUsed.add(u.k); } else if (known && u.w.length >= 2) tot += w * 0.7; continue; }
        const w = known ? index.idf(u.w) : (bestSim > 0 ? index.idf(u.w) : 0.6);
        tot += w;
        if (bestSim > 0) { got += w * bestSim; descUsed.add(u.k); }
      }
      const K = 3.6;
      const desc = tot > 0 ? (got / tot) * Math.min(1, got / K) : 0;
      let score = Math.max(pn, desc) + 0.3 * Math.min(pn, desc);
      if (ctx.bin && it.part.bin === ctx.bin) score += 0.04;
      if (score <= 0.15) continue;
      const consumed = new Set([...(pn >= 0.55 ? pnUsed : []), ...descUsed]);
      // part-number-looking words this part doesn't explain (e.g. the "20S" in "HP kit 20S")
      let leftover = 0;
      tokens.forEach((t, k) => { if (!consumed.has(k) && /[a-z]/i.test(t) && /\d/.test(t) && t.length >= 2) leftover++; });
      score -= 0.08 * leftover;
      if (score <= 0.15) continue;
      res.push({ part: it.part, idx: it.i, score, pn, desc, pnExact, consumed, leftover, via: pn >= desc ? 'pn' : 'desc' });
    }
    res.sort((a, b) => b.score - a.score);
    return res;
  }

  // split a text box into utterances
  function splitUtterances(text) {
    return String(text).split(/\n+|\bnext\b[.,!]?|;|(?<=\D)\.(?=\s|$)/i).map(s => s.trim()).filter(s => s.replace(/[.,\s]/g,'').length);
  }

  return { parse, buildIndex, splitUtterances, wordsToDigits, alnum };
})();
if (typeof module !== 'undefined') module.exports = Matcher;
