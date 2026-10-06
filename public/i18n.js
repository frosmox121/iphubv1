/* IPHub — traducción total de la interfaz (idiomas + banderas + país).
 * El HTML base está en español. Cada texto se traduce vía /api/i18n (cache en servidor y en el navegador)
 * y un MutationObserver traduce también todo lo que la app genere después (toasts, tablas, errores...). */
(function () {
  const LANGS = [ // [código, nombre nativo, bandera, ]
    ['es','Español','es'],['en','English','us'],['pt','Português','br'],['fr','Français','fr'],['de','Deutsch','de'],['it','Italiano','it'],['nl','Nederlands','nl'],
    ['sv','Svenska','se'],['da','Dansk','dk'],['nb','Norsk','no'],['fi','Suomi','fi'],['is','Íslenska','is'],['pl','Polski','pl'],['cs','Čeština','cz'],['sk','Slovenčina','sk'],
    ['hu','Magyar','hu'],['ro','Română','ro'],['bg','Български','bg'],['el','Ελληνικά','gr'],['hr','Hrvatski','hr'],['sr','Српски','rs'],['sl','Slovenščina','si'],['mk','Македонски','mk'],
    ['sq','Shqip','al'],['lt','Lietuvių','lt'],['lv','Latviešu','lv'],['et','Eesti','ee'],['ru','Русский','ru'],['uk','Українська','ua'],['tr','Türkçe','tr'],['ka','ქართული','ge'],
    ['hy','Հայերեն','am'],['az','Azərbaycanca','az'],['kk','Қазақша','kz'],['uz','Oʻzbekcha','uz'],['mn','Монгол','mn'],['ar','العربية','sa'],['he','עברית','il'],['fa','فارسی','ir'],
    ['ur','اردو','pk'],['hi','हिन्दी','in'],['bn','বাংলা','bd'],['ta','தமிழ்','in'],['te','తెలుగు','in'],['ne','नेपाली','np'],['si','සිංහල','lk'],['th','ไทย','th'],['vi','Tiếng Việt','vn'],
    ['id','Bahasa Indonesia','id'],['ms','Bahasa Melayu','my'],['fil','Filipino','ph'],['zh-CN','简体中文','cn'],['zh-TW','繁體中文','tw'],['ja','日本語','jp'],['ko','한국어','kr'],
    ['my','မြန်မာ','mm'],['km','ខ្មែរ','kh'],['lo','ລາວ','la'],['sw','Kiswahili','ke'],['am','አማርኛ','et'],['af','Afrikaans','za'],['ca','Català','es-ct'],['eu','Euskara','es-pv'],
    ['gl','Galego','es-ga'],['ga','Gaeilge','ie'],['cy','Cymraeg','gb-wls'],
  ];
  const RTL = ['ar', 'he', 'fa', 'ur'];
  const CODES = 'AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(' ');
  const CL = {}; // país -> idioma
  ('es:AR BO CL CO CR CU DO EC SV GT HN MX NI PA PY PE PR UY VE ES GQ;pt:BR PT AO MZ CV GW ST;fr:FR MC LU BJ BF BI CD CG CI CM DJ GA GN HT MG ML NE SN TD TG RW CF KM VU GF GP MQ RE PF NC PM WF BL MF;de:DE AT CH LI;it:IT SM VA;nl:NL SR BQ AW CW SX;ru:RU BY KG;kk:KZ;uz:UZ;ar:SA AE EG DZ BH IQ JO KW LB LY MA OM PS QA SD SY TN YE MR EH;zh-CN:CN;zh-TW:TW HK MO;ja:JP;ko:KR KP;hi:IN;bn:BD;ur:PK;fa:IR AF;tr:TR;pl:PL;uk:UA;cs:CZ;sk:SK;hu:HU;ro:RO MD;bg:BG;el:GR CY;sv:SE AX;da:DK GL FO;nb:NO SJ;fi:FI;he:IL;th:TH;vi:VN;id:ID;ms:MY BN;fil:PH;ca:AD;hr:HR;sr:RS ME;sl:SI;lt:LT;lv:LV;et:EE;sw:KE TZ;is:IS;sq:AL XK;mk:MK;ka:GE;hy:AM;az:AZ;mn:MN;ne:NP;si:LK;my:MM;km:KH;lo:LA;am:ET;ga:IE')
    .split(';').forEach(g => { const [l, cs] = g.split(':'); cs.split(' ').forEach(c => CL[c] = l); });

  const flag = cc => { const c = String(cc || '').toLowerCase(); return `<img class="flag-img" src="https://flagcdn.com/w40/${c}.png" srcset="https://flagcdn.com/w80/${c}.png 2x" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`; };
  window.countryFlag = flag;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  const known = c => LANGS.find(l => l[0].toLowerCase() === String(c).toLowerCase());
  const matchLang = c => { if (!c) return null; const f = known(c); if (f) return f[0]; const b = c.split('-')[0]; if (b === 'zh') return /TW|HK|MO|Hant/i.test(c) ? 'zh-TW' : 'zh-CN'; if (b === 'no') return 'nb'; if (b === 'tl') return 'fil'; const k = known(b); return k ? k[0] : null; };

  let CUR = 'es', MAP = {};
  const detectCountry = () => { for (const l of navigator.languages || [navigator.language]) { const m = /-([A-Za-z]{2})$/.exec(l || ''); if (m) return m[1].toUpperCase(); } return ''; };
  window.IPHUB_LANG = () => CUR;
  window.IPHUB_COUNTRY = () => lsGet('iphub_country') || detectCountry() || '';

  /* ---------- Motor ---------- */
  const orig = new WeakMap(), origA = new WeakMap(), ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  const SKIP = '[data-no-i18n],script,style,code,pre,textarea,svg,canvas,#user-name,#user-email,#api-key,.net-ip,noscript';
  const WS = /^(\s*)([\s\S]*?)(\s*)$/;
  const okStr = t => t.length > 1 && t.length <= 1500 && /\p{L}/u.test(t) && !/^[\d\s.,:;\/%+\-–—·×()#\[\]]*$/.test(t) && !/^\S+@\S+$/.test(t) && !/^https?:/.test(t) && !/^[\w-]+(\.[\w-]+)+$/.test(t) && t !== 'IPHub';
  let pending = new Set(), tried = new Set(), done = new Set(), timer = null, inflight = 0, saveT = null, applying = false;
  const bar = document.createElement('div'); bar.className = 'i18n-bar hidden'; bar.setAttribute('data-no-i18n', ''); document.body.appendChild(bar);

  function queue(s) { if (!s || tried.has(s) || pending.has(s)) return; pending.add(s); clearTimeout(timer); timer = setTimeout(flush, 60); }
  /* Textos con números ("esperá 5 min", "12 dispositivos"): se traduce la plantilla con {1},{2}… una sola vez y se reponen los números */
  const NUM = /\d+(?:[.,]\d+)*/g;
  const tplOf = core => { const nums = []; const tpl = core.replace(NUM, m => { nums.push(m); return '{' + nums.length + '}'; }); return { tpl, nums }; };
  function lookup(core) {
    if (MAP[core] != null) return MAP[core];
    if (!/\d/.test(core)) return null;
    const { tpl, nums } = tplOf(core); if (!nums.length || nums.length > 6) return null;
    const t = MAP[tpl]; if (t == null) return null;
    for (let i = 1; i <= nums.length; i++) if (!t.includes('{' + i + '}')) return null; // el traductor perdió un número: se usa el texto completo
    return t.replace(/\{(\d+)\}/g, (m, i) => nums[i - 1] != null ? nums[i - 1] : m);
  }
  function want(core) { // qué se le pide al servidor: la plantilla (si sirve) o el texto literal
    if (!/\d/.test(core)) return core;
    const { tpl, nums } = tplOf(core); if (!nums.length || nums.length > 6) return core;
    if (MAP[tpl] != null || done.has(tpl)) return core; // la plantilla ya volvió y no sirvió: se pide el texto literal
    return tried.has(tpl) ? null : tpl; // todavía en camino: esperar
  }
  /* Traducción masiva: el servidor devuelve TODA la interfaz de una vez (desde caché si ya estaba) */
  let bundleP = null;
  function startBundle(code) {
    if (code === 'es') return;
    inflight++; bar.classList.remove('hidden');
    bundleP = (async () => {
      try {
        for (let i = 0; i < 40 && code === CUR; i++) {
          const r = await fetch('/api/i18n/bundle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: code }), signal: AbortSignal.timeout(20000) });
          if (!r.ok) break;
          const d = await r.json();
          if (code === CUR && d.map && Object.keys(d.map).length) { Object.assign(MAP, d.map); retranslate(); persist(); }
          if (!d.partial) break;
          await new Promise(ok => setTimeout(ok, 1500));
        }
      } catch (_) {}
      finally { inflight--; if (inflight <= 0) bar.classList.add('hidden'); bundleP = null; }
    })();
  }
  async function clientGtx(strs, lang) { // respaldo: el navegador consulta al traductor directamente
    const out = {}, tl = ({ he: 'iw', nb: 'no', fil: 'tl' })[lang] || lang, groups = []; let cur = [], len = 0;
    for (const x of strs) { if (len + x.length > 1500 || cur.length >= 30) { groups.push(cur); cur = []; len = 0; } cur.push(x); len += x.length + 1; }
    if (cur.length) groups.push(cur);
    for (const g of groups) {
      try {
        const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=es&dt=t&tl=' + encodeURIComponent(tl) + '&q=' + encodeURIComponent(g.join('\n')));
        const d = await r.json(), lines = d[0].map(x => x[0]).join('').split('\n').map(x => x.trim());
        if (lines.length === g.length) g.forEach((x, i) => { if (lines[i]) out[x] = lines[i]; });
      } catch (_) {}
    }
    return out;
  }
  let warned = ''; const retryN = {};
  async function flush() {
    const list = [...pending].filter(x => MAP[x] == null); pending.clear(); if (!list.length || CUR === 'es') { if (CUR !== 'es') retranslate(); return; }
    const lang = CUR; list.forEach(s => tried.add(s));
    const chunks = []; for (let i = 0; i < list.length; i += 100) chunks.push(list.slice(i, i + 100));
    inflight += chunks.length; bar.classList.remove('hidden');
    let q = 0, got = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (q < chunks.length) {
        const ch = chunks[q++]; let map = {};
        try {
          const r = await fetch('/api/i18n', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang, strings: ch }) });
          if (r.ok) map = (await r.json()).map || {};
        } catch (_) {}
        const miss = ch.filter(x => !map[x]);
        if (miss.length) Object.assign(map, await clientGtx(miss, lang));
        got += Object.keys(map).length; ch.forEach(x => done.add(x));
        const lost = ch.filter(x => !map[x]); // lo que no se pudo traducir se reintenta más tarde (máx. 3 veces), sin saturar al traductor
        if (lost.length && lang === CUR && (retryN[lang] = (retryN[lang] || 0) + 1) <= 3) setTimeout(() => { if (CUR === lang) { lost.forEach(x => tried.delete(x)); lost.forEach(queue); } }, 20000 * retryN[lang]);
        if (lang === CUR && Object.keys(map).length) { Object.assign(MAP, map); retranslate(); persist(); }
        inflight--; if (inflight <= 0) bar.classList.add('hidden');
      }
    }));
    if (!got && lang === CUR && warned !== lang) { warned = lang; try { toast('No se pudo conectar con el traductor. Revisá tu conexión a internet y la consola del servidor.', true); } catch (_) {} }
  }
  function persist() { clearTimeout(saveT); saveT = setTimeout(() => lsSet('iphub_i18n_' + CUR, JSON.stringify(MAP)), 600); }

  function doText(n) {
    const par = n.parentElement; if (!par || par.closest(SKIP)) return;
    let rec = orig.get(n);
    if (!rec || n.data !== rec.s) { rec = { o: n.data, s: n.data }; orig.set(n, rec); }
    if (CUR === 'es') { if (rec.s !== rec.o) { rec.s = rec.o; n.data = rec.o; } return; }
    const m = WS.exec(rec.o), core = m[2].replace(/\s+/g, ' '); if (!okStr(core)) return;
    const tr = lookup(core);
    if (tr != null) { const next = m[1] + tr + m[3]; rec.s = next; if (n.data !== next) n.data = next; } else queue(want(core));
  }
  function doAttrs(el) {
    if (el.closest && el.closest(SKIP)) return;
    for (const a of ATTRS) {
      if (!el.hasAttribute || !el.hasAttribute(a)) continue;
      let rec = origA.get(el); if (!rec) origA.set(el, rec = {});
      const cur = el.getAttribute(a);
      if (!rec[a] || cur !== rec[a].s) rec[a] = { o: cur, s: cur };
      if (CUR === 'es') { if (rec[a].s !== rec[a].o) { rec[a].s = rec[a].o; el.setAttribute(a, rec[a].o); } continue; }
      const t = rec[a].o.trim().replace(/\s+/g, ' '); if (!okStr(t)) continue;
      const tr = lookup(t); if (tr != null) { rec[a].s = tr; if (cur !== tr) el.setAttribute(a, tr); } else queue(want(t));
    }
  }
  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1) return;
    if (root.closest && root.closest(SKIP)) return;
    doAttrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: n => n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    let n; while ((n = tw.nextNode())) n.nodeType === 3 ? doText(n) : doAttrs(n);
  }
  function retranslate() {
    applying = true; walk(document.body); translateTitle();
    // lo que el observer registre por nuestros cambios se ignora (se compara contra rec.s)
    setTimeout(() => { applying = false; }, 0);
  }
  const TITLE_O = document.title;
  function translateTitle() { if (CUR === 'es') { document.title = TITLE_O; return; } const t = lookup(TITLE_O.replace(/\s+/g, ' ')); if (t) document.title = t; else if (okStr(TITLE_O)) queue(TITLE_O); }
  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doAttrs(m.target);
      else m.addedNodes.forEach(n => walk(n));
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });

  /* ---------- Cambio de idioma ---------- */
  const OrigLS = Date.prototype.toLocaleString, OrigLD = Date.prototype.toLocaleDateString, OrigLT = Date.prototype.toLocaleTimeString;
  const loc = l => l || (CUR === 'es' ? undefined : CUR);
  Date.prototype.toLocaleString = function (l, o) { return OrigLS.call(this, loc(l), o); };
  Date.prototype.toLocaleDateString = function (l, o) { return OrigLD.call(this, loc(l), o); };
  Date.prototype.toLocaleTimeString = function (l, o) { return OrigLT.call(this, loc(l), o); };

  function setLang(code, manual) {
    code = matchLang(code) || 'es';
    CUR = code; if (manual) { lsSet('iphub_lang', code); lsSet('iphub_lang_manual', '1'); }
    try { MAP = JSON.parse(lsGet('iphub_i18n_' + code) || '{}'); } catch (_) { MAP = {}; }
    tried = new Set(); done = new Set(); pending.clear(); retryN[code] = 0;
    const h = document.documentElement; h.lang = code; h.dir = RTL.includes(code.split('-')[0]) ? 'rtl' : 'ltr';
    retranslate(); startBundle(code);
    document.dispatchEvent(new CustomEvent('iphub:lang', { detail: code }));
    if (manual && typeof TOKEN !== 'undefined' && TOKEN) fetch('/api/auth/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify({ lang: code }) }).catch(() => {});
  }
  window.IPHUB_setLang = setLang;

  /* ---------- Selectores con banderas ---------- */
  function picker(host, kind) {
    if (!host) return;
    const items = () => {
      if (kind === 'lang') return LANGS.map(l => ({ id: l[0], cc: l[2], label: l[1], sub: l[0] }));
      let dn = null; try { dn = new Intl.DisplayNames([CUR === 'es' ? 'es' : CUR], { type: 'region' }); } catch (_) {}
      return CODES.map(c => ({ id: c, cc: c, label: (dn && dn.of(c)) || c, sub: c })).sort((a, b) => a.label.localeCompare(b.label));
    };
    const cur = () => kind === 'lang' ? CUR : window.IPHUB_COUNTRY();
    host.innerHTML = `<button type="button" class="lp-btn"></button><div class="lp-panel hidden"><input type="search" class="lp-search" placeholder="🔍" autocomplete="off"><div class="lp-list"></div></div>`;
    const btn = host.querySelector('.lp-btn'), panel = host.querySelector('.lp-panel'), list = host.querySelector('.lp-list'), search = host.querySelector('.lp-search');
    const label = () => { const it = items().find(i => i.id.toLowerCase() === String(cur()).toLowerCase()); btn.innerHTML = it ? `${flag(it.cc)}<span>${esc(it.label)}</span><i>▾</i>` : `<span>🌐</span><span>${kind === 'lang' ? 'Idioma' : 'País'}</span><i>▾</i>`; };
    const fill = q => {
      q = (q || '').toLowerCase().trim(); const c = String(cur()).toLowerCase();
      list.innerHTML = items().filter(i => !q || (i.label + ' ' + i.sub).toLowerCase().includes(q)).map(i => `<button type="button" class="lp-item${i.id.toLowerCase() === c ? ' sel' : ''}" data-id="${i.id}">${flag(i.cc)}<span>${esc(i.label)}</span><small>${esc(i.sub)}</small></button>`).join('');
    };
    btn.addEventListener('click', e => { e.stopPropagation(); document.querySelectorAll('.lp-panel').forEach(p => p !== panel && p.classList.add('hidden')); panel.classList.toggle('hidden'); if (!panel.classList.contains('hidden')) { search.value = ''; fill(''); search.focus(); const s = list.querySelector('.sel'); if (s) s.scrollIntoView({ block: 'center' }); } });
    search.addEventListener('input', () => fill(search.value));
    panel.addEventListener('click', e => e.stopPropagation());
    list.addEventListener('click', e => {
      const b = e.target.closest('.lp-item'); if (!b) return; panel.classList.add('hidden');
      if (kind === 'lang') setLang(b.dataset.id, true);
      else {
        lsSet('iphub_country', b.dataset.id); label();
        const l = CL[b.dataset.id] || 'en'; setLang(l, true);
        if (typeof TOKEN !== 'undefined' && TOKEN) fetch('/api/auth/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify({ country: b.dataset.id, lang: l }) }).catch(() => {});
      }
    });
    document.addEventListener('click', () => panel.classList.add('hidden'));
    document.addEventListener('iphub:lang', label); label();
  }
  window.IPHUB_applyUser = u => { // al iniciar sesión: respeta la elección manual; si no, usa la del perfil
    if (!u) return;
    if (u.country && !lsGet('iphub_country')) lsSet('iphub_country', u.country);
    if (!lsGet('iphub_lang_manual') && u.lang && u.lang !== 'es') setLang(u.lang, false);
    document.dispatchEvent(new CustomEvent('iphub:lang', { detail: CUR }));
  };

  // Arranque: elección manual > idioma del navegador > español
  const start = lsGet('iphub_lang_manual') ? lsGet('iphub_lang') : (matchLang(navigator.language) || 'es');
  picker(document.getElementById('lang-auth'), 'lang'); picker(document.getElementById('lang-top'), 'lang');
  picker(document.getElementById('lang-acc'), 'lang'); picker(document.getElementById('country-acc'), 'country');
  setLang(start, false);
})();
