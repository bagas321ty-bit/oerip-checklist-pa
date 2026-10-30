/* Checklist Laporan Harian PA · Oerip Indonesia
   Data disimpan di Supabase (tabel public.tasks); hak akses diatur di schema.sql. */
(() => {
const DIVS = [
  {k:'hro', n:'HRO', who:'Ari Purnawan'},
  {k:'finance', n:'Finance', who:'Amatullah Noor Fajri'},
  {k:'marketing', n:'Marketing', who:'Trifosa Evria'},
  {k:'produksi', n:'Produksi', who:'Herman'},
  {k:'rnd', n:'R&D', who:'Ahmad Syarif'},
  {k:'procurement', n:'Procurement & Stok', who:'Dega Puji Rahayu'},
  {k:'supporting', n:'Supporting Office', who:'Riri'},
];
const HARI = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
const BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const STATUS = [{v:'hijau',l:'Hijau'},{v:'kuning',l:'Kuning'},{v:'merah',l:'Merah'}];

const pad = n => String(n).padStart(2,'0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate()+n); return iso(d); };
const longDate = s => { const d = parse(s); return `${HARI[d.getDay()]}, ${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`; };
const monday = s => { const d = parse(s); d.setDate(d.getDate()-((d.getDay()+6)%7)); return iso(d); };
const $ = id => document.getElementById(id);
const el = (tag, attrs={}, ...kids) => { const e = document.createElement(tag); for (const [k,v] of Object.entries(attrs)) { if (k==='text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v===true) e.setAttribute(k,''); else if (v!==false && v!=null) e.setAttribute(k, v); } for (const c of kids) if (c) e.append(c); return e; };

const cfg = window.OERIP_CONFIG || {};
if (!window.supabase || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('ISI-PROJECT')) {
  document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">Aplikasi belum disambungkan ke Supabase. Isi SUPABASE_URL dan SUPABASE_ANON_KEY di file config.js.</p>';
  return;
}
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

let canWrite = false, isAdmin = false, myEmail = '';
let day = iso(new Date());
let month = day.slice(0,7); // 'YYYY-MM'
let tasks = [], monthTasks = [];
let pendingDelete = null;
const openNotes = new Set();
let view = 'harian';
try { const v = localStorage.getItem('oerip-pa-view'); if (['rekap','anggota','rutin','riwayat'].includes(v)) view = v; } catch {}
let channel = null, refreshTimer = null;

const draft = {
  get(k){ try { return localStorage.getItem('oerip-draft:' + k) || ''; } catch { return ''; } },
  set(k, v){ try { v ? localStorage.setItem('oerip-draft:' + k, v) : localStorage.removeItem('oerip-draft:' + k); } catch {} },
};
function notice(msg, kind){ const n = $('notice'); if (!msg) { n.hidden = true; return; } n.textContent = msg; n.dataset.kind = kind || ''; n.hidden = false; }
function handleErr(e, kind){
  console.error(e);
  const msg = (e && (e.message || '')) + '';
  if (kind === 'load') { notice('Data belum termuat karena koneksi bermasalah. Periksa internet lalu muat ulang halaman.', 'err'); return; }
  if (/row-level security|permission|42501/i.test(msg)) notice('Perubahan ditolak. Akun ini hanya punya akses lihat.', 'err');
  else if (/JWT|session/i.test(msg)) notice('Sesi login habis. Muat ulang halaman lalu masuk lagi.', 'err');
  else notice('Perubahan belum tersimpan karena koneksi bermasalah. Coba lagi.', 'err');
}

/* ---------- data ---------- */
const fromRow = r => ({id:r.id, tpl:r.template_id, date:r.tanggal, div:r.divisi, text:r.teks, done:r.selesai, status:r.status, note:r.catatan, by:r.diubah_oleh, createdAt:r.dibuat, updatedAt:r.diubah});
let routineDone = new Set();
async function ensureRoutine(d){
  if (!canWrite || routineDone.has(d) || d !== iso(new Date()) || parse(d).getDay() === 0) return;
  routineDone.add(d);
  const { error } = await sb.rpc('buat_tugas_rutin', { p_tanggal: d });
  if (error) { routineDone.delete(d); console.error(error); }
}
async function loadDay(){
  const d = day;
  await ensureRoutine(d);
  if (d !== day) return;
  const { data, error } = await sb.from('tasks').select('*').eq('tanggal', d).order('dibuat');
  if (d !== day) return;          // the user moved to another date meanwhile
  if (error) return handleErr(error, 'load');
  tasks = data.map(fromRow); renderDay();
}
const monthStart = m => m + '-01';
const monthEnd = m => { const [y,mo] = m.split('-').map(Number); return iso(new Date(y, mo, 0)); };
const addMonths = (m, n) => { const [y,mo] = m.split('-').map(Number); const d = new Date(y, mo-1+n, 1); return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; };
let monthReq = 0;
async function loadMonth(){
  const req = ++monthReq, m = month, rows = [], PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('tasks').select('id,tanggal,divisi,teks,selesai,status,catatan,template_id,dibuat,diubah,diubah_oleh')
      .gte('tanggal', monthStart(m)).lte('tanggal', monthEnd(m)).order('id').range(from, from + PAGE - 1);
    if (error) return handleErr(error, 'load');
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  if (req !== monthReq) return;   // a newer month was requested meanwhile
  monthTasks = rows.map(fromRow); renderMonth();
}
function refreshSoon(){ clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { loadDay(); if (view === 'rekap') loadMonth(); }, 250); }
async function addTask(div, text){
  text = (text||'').trim(); if (!text) return;
  const { error } = await sb.from('tasks').insert({tanggal: day, divisi: div, teks: text});
  if (error) handleErr(error); else refreshSoon();
}
async function patch(id, fields){
  const map = {done:'selesai', status:'status', note:'catatan'}; const row = {};
  for (const [k,v] of Object.entries(fields)) row[map[k]] = v;
  const t = tasks.find(x => x.id === id); if (t) { Object.assign(t, fields); renderDay(); }
  const { error } = await sb.from('tasks').update(row).eq('id', id);
  if (error) { handleErr(error); loadDay(); } else refreshSoon();
}
async function removeTask(id){
  tasks = tasks.filter(t => t.id !== id); renderDay();
  const { error } = await sb.from('tasks').delete().eq('id', id);
  if (error) { handleErr(error); loadDay(); } else refreshSoon();
}
async function copyPrev(){
  $('copyprev').disabled = true;
  try {
    let src = null;
    for (let i = 1; i <= 7 && !src; i++) {
      const { data, error } = await sb.from('tasks').select('divisi,teks').eq('tanggal', addDays(day,-i)).is('template_id', null).order('dibuat');
      if (error) throw error;
      if (data.length) src = data;
    }
    if (!src) { notice('Tidak ada tugas khusus (non-rutin) di 7 hari terakhir untuk disalin.'); return; }
    const { error } = await sb.from('tasks').insert(src.map(r => ({tanggal: day, divisi: r.divisi, teks: r.teks})));
    if (error) throw error;
    notice(`${src.length} tugas disalin. Status dan centang dimulai dari awal.`);
    loadDay();
  } catch(e){ handleErr(e); }
  finally { $('copyprev').disabled = false; }
}

/* ---------- daily view ---------- */
function renderDay(){
  const focused = document.activeElement && document.activeElement.id;
  const caret = focused && document.activeElement.selectionStart;
  queueMicrotask(() => { if (focused) { const f = $(focused); if (f && f !== document.activeElement) { f.focus(); try { f.setSelectionRange(caret, caret); } catch {} } } });
  const isToday = day === iso(new Date());
  $('daytitle').innerHTML = '';
  $('daytitle').append(el('span',{text: isToday ? 'Hari ini' : 'Tanggal'}), document.createTextNode(longDate(day)));
  $('datepick').value = day;
  $('today').disabled = isToday;

  const total = tasks.length, done = tasks.filter(t => t.done).length;
  $('meter').style.width = total ? (done/total*100)+'%' : '0';
  $('sumtxt').textContent = `${done} / ${total} selesai`;
  const k = tasks.filter(t=>t.status==='kuning').length, m = tasks.filter(t=>t.status==='merah').length;
  const c = $('counts'); c.innerHTML = '';
  if (k) c.append(el('span',{class:'flag k',text:`${k} kuning`}));
  if (m) c.append(el('span',{class:'flag m',text:`${m} merah`}));
  $('copyprev').hidden = !(canWrite && total === 0);
  const today = iso(new Date());
  if (!total && day > today) notice('Tugas rutin untuk tanggal ini muncul otomatis pada harinya. Tugas khusus bisa ditambahkan sekarang.');
  else if (!total && day === today && !canWrite) notice('Tugas rutin hari ini muncul setelah PA, CEO, atau Vice CEO membuka checklist.');
  else if ($('notice').dataset.kind !== 'err' && /muncul otomatis|muncul setelah/.test($('notice').textContent)) notice('');

  const grid = $('grid'); grid.innerHTML = '';
  for (const d of DIVS) {
    const list = tasks.filter(t => t.div === d.k).sort((a,b) => (a.createdAt||'').localeCompare(b.createdAt||'') || a.text.localeCompare(b.text));
    const doneN = list.filter(t => t.done).length;
    const card = el('article',{class:'card','aria-label':d.n},
      el('div',{class:'card-h'}, el('h2',{text:d.n}), el('span',{class:'who',text:d.who}), el('span',{class:'frac',text:`${doneN}/${list.length}`})));
    const ul = el('ul',{class:'tasks'});
    if (!list.length) ul.append(el('li',{class:'empty',text: canWrite ? 'Belum ada tugas. Tambahkan di bawah.' : 'Belum ada tugas untuk hari ini.'}));
    for (const t of list) ul.append(taskRow(t));
    card.append(ul);
    if (canWrite) {
      const key = `add:${day}:${d.k}`;
      const inp = el('input',{id:`add-${d.k}`, type:'text', placeholder:'Tambah tugas khusus hari ini…', 'aria-label':`Tambah tugas ${d.n}`, maxlength:'240'});
      inp.value = draft.get(key);
      inp.addEventListener('input', () => draft.set(key, inp.value));
      card.append(el('form',{class:'add', onsubmit: e => { e.preventDefault(); addTask(d.k, inp.value); inp.value=''; draft.set(key, ''); }}, inp, el('button',{type:'submit',text:'Tambah'})));
    }
    grid.append(card);
  }
}
function taskRow(t){
  const li = el('li',{class:'task','data-status':t.status||''});
  const cb = el('input',{type:'checkbox', id:`cb-${t.id}`});
  cb.checked = !!t.done; cb.disabled = !canWrite;
  cb.addEventListener('change', () => patch(t.id, {done: cb.checked}));
  const txt = el('label',{class:'ttext'+(t.done?' done':''), for:`cb-${t.id}`, text:t.text});
  if (t.tpl) txt.append(el('span',{class:'badge',text:'rutin'}));
  let right = el('span');
  if (canWrite) {
    right = pendingDelete === t.id
      ? el('div',{class:'confirm'}, el('span',{text:'Hapus?'}),
          el('button',{class:'yes',text:'Hapus', onclick: () => { pendingDelete=null; removeTask(t.id); }}),
          el('button',{text:'Batal', onclick: () => { pendingDelete=null; renderDay(); }}))
      : el('button',{class:'del','aria-label':`Hapus tugas ${t.text}`, text:'Hapus', onclick: () => { pendingDelete=t.id; renderDay(); }});
  }
  li.append(cb, txt, right);

  const chips = el('div',{class:'chips',role:'group','aria-label':'Status'});
  for (const s of STATUS) {
    const b = el('button',{class:'chip','data-v':s.v,'aria-pressed':String(t.status===s.v), text:s.l});
    if (!canWrite) b.disabled = true; else b.addEventListener('click', () => patch(t.id, {status: t.status===s.v ? '' : s.v}));
    chips.append(b);
  }
  const meta = el('div',{class:'meta'}, chips);
  if (t.by) { const w = t.updatedAt ? new Date(t.updatedAt) : null; meta.append(el('span',{class:'by',text:`Diubah ${t.by}${w ? ' · ' + pad(w.getHours())+'.'+pad(w.getMinutes()) : ''}`})); }
  if (canWrite && !t.note && !openNotes.has(t.id) && !draft.get(`note:${t.id}`)) meta.append(el('button',{class:'del',text:'+ Catatan', onclick: () => { openNotes.add(t.id); renderDay(); setTimeout(()=>{ const n=$(`note-${t.id}`); n && n.focus(); },0); }}));
  li.append(meta);
  if (canWrite && (t.note || openNotes.has(t.id) || draft.get(`note:${t.id}`))) {
    const ta = el('textarea',{class:'note', id:`note-${t.id}`, rows:'1', placeholder:'Catatan / kendala…', 'aria-label':`Catatan ${t.text}`, maxlength:'600'});
    const nkey = `note:${t.id}`;
    ta.value = draft.get(nkey) || t.note || '';
    ta.addEventListener('input', () => draft.set(nkey, ta.value));
    ta.addEventListener('change', () => { openNotes.delete(t.id); draft.set(nkey, ''); patch(t.id, {note: ta.value.trim()}); });
    li.append(ta);
  } else if (!canWrite && t.note) li.append(el('div',{class:'notetxt',text:'Catatan: ' + t.note}));
  return li;
}

/* ---------- monthly view ---------- */
function pctPill(done, tot){
  if (!tot) return el('span',{class:'by',text:'—'});
  const p = Math.round(done/tot*100);
  return el('span',{class:'pct ' + (p>=90?'hi':p>=70?'mid':'lo'), text:`${p}%`});
}
function renderMonth(){
  const today = iso(new Date());
  const [y, mo] = month.split('-').map(Number);
  $('weektitle').innerHTML = '';
  $('weektitle').append(el('span',{text: month === today.slice(0,7) ? 'Bulan ini' : 'Bulan'}), document.createTextNode(`${BULAN[mo-1]} ${y}`));
  $('thisweek').disabled = month === today.slice(0,7);
  $('wnext').disabled = month >= today.slice(0,7);

  // only days that have already happened count toward the recap
  const counted = monthTasks.filter(t => t.date <= today);
  const allDays = []; for (let d = monthStart(month); d <= monthEnd(month); d = addDays(d,1)) allDays.push(d);
  const workDays = [...new Set(counted.map(t => t.date))].length;
  const done = counted.filter(t => t.done).length, total = counted.length;
  const red = counted.filter(t => t.status === 'merah').length, yellow = counted.filter(t => t.status === 'kuning').length;

  const sum = $('monthsum'); sum.innerHTML = '';
  const tile = (label, value, sub, cls) => el('div',{class:'tile' + (cls ? ' ' + cls : '')}, el('small',{text:label}), el('b',{text:value}), sub ? el('span',{text:sub}) : null);
  sum.append(
    tile('Tugas selesai', total ? `${Math.round(done/total*100)}%` : '—', total ? `${done} dari ${total} tugas` : 'Belum ada data'),
    tile('Hari tercatat', String(workDays), 'hari dengan tugas di checklist'),
    tile('Merah', String(red), 'tugas terhambat', red ? 'bad' : ''),
    tile('Kuning', String(yellow), 'tugas berisiko', yellow ? 'warn' : ''));

  const cellClass = (list, d) => {
    if (d > today) return 'sc sc-future';
    if (!list.length) return 'sc sc-none';
    const p = list.filter(x => x.done).length / list.length;
    return 'sc ' + (p >= .9 ? 'sc-hi' : p >= .7 ? 'sc-mid' : 'sc-lo');
  };
  const strip = (filterFn, label) => {
    const wrap = el('div',{class:'strip', role:'img', 'aria-label': label});
    for (const d of allDays) {
      const l = counted.filter(x => x.date === d && filterFn(x));
      const dd = parse(d);
      const tip = `${HARI[dd.getDay()]} ${dd.getDate()}: ` + (d > today ? 'belum terjadi' : l.length ? `${l.filter(x=>x.done).length}/${l.length} selesai` : 'tidak ada tugas');
      wrap.append(el('i',{class: cellClass(l, d) + (dd.getDay() === 0 ? ' sc-sun' : ''), title: tip}));
    }
    return wrap;
  };

  const t = $('rekaptable'); t.innerHTML = '';
  t.append(el('thead',{}, el('tr',{}, el('th',{text:'Divisi'}), el('th',{text:'Selesai'}), el('th',{text:'%'}),
    el('th',{text:'Merah'}), el('th',{text:'Kuning'}), el('th',{class:'stripcol', text:`Per hari (1–${allDays.length})`}))));
  const body = el('tbody');
  for (const dv of DIVS) {
    const l = counted.filter(x => x.div === dv.k), dn = l.filter(x => x.done).length;
    const m = l.filter(x => x.status === 'merah').length, k = l.filter(x => x.status === 'kuning').length;
    body.append(el('tr',{}, el('td',{text:dv.n}), el('td',{class:'num',text: l.length ? `${dn}/${l.length}` : '—'}), el('td',{}, pctPill(dn, l.length)),
      el('td',{class:'num'}, m ? el('span',{class:'flag m',text:String(m)}) : el('span',{class:'by',text:'0'})),
      el('td',{class:'num'}, k ? el('span',{class:'flag k',text:String(k)}) : el('span',{class:'by',text:'0'})),
      el('td',{class:'stripcol'}, strip(x => x.div === dv.k, `Penyelesaian harian ${dv.n}`))));
  }
  body.append(el('tr',{class:'total'}, el('td',{text:'Semua divisi'}), el('td',{class:'num',text: total ? `${done}/${total}` : '—'}), el('td',{}, pctPill(done,total)),
    el('td',{class:'num',text:String(red)}), el('td',{class:'num',text:String(yellow)}), el('td',{class:'stripcol'}, strip(() => true, 'Penyelesaian harian semua divisi'))));
  t.append(body);

  const issues = $('issues'); issues.innerHTML = '';
  const flagged = counted.filter(x => x.status==='merah' || x.status==='kuning' || (x.note && !x.done))
    .sort((p,q) => (q.status==='merah') - (p.status==='merah') || q.date.localeCompare(p.date));
  issues.append(el('h3',{text: flagged.length ? `Perlu perhatian bulan ini (${flagged.length})` : 'Perlu perhatian bulan ini'}));
  if (!flagged.length) { issues.append(el('p',{class:'by',text:'Tidak ada tugas berstatus kuning atau merah, dan tidak ada catatan kendala yang terbuka.'})); return; }
  const ul = el('ul');
  for (const x of flagged.slice(0, 40)) {
    const dv = DIVS.find(d=>d.k===x.div), dd = parse(x.date);
    ul.append(el('li',{}, el('span',{class:'flag '+(x.status==='merah'?'m':x.status==='kuning'?'k':''),text: x.status ? x.status.toUpperCase() : 'CATATAN'}),
      document.createTextNode(' ' + x.text + ' '),
      el('small',{text:`· ${dv ? dv.n : x.div} · ${HARI[dd.getDay()]} ${dd.getDate()}${x.done ? ' · selesai' : ''}${x.note ? ' · ' + x.note : ''}`})));
  }
  if (flagged.length > 40) ul.append(el('li',{}, el('small',{text:`+${flagged.length - 40} lainnya`})));
  issues.append(ul);
}

/* ---------- navigation ---------- */
function setView(v){
  view = v; try { localStorage.setItem('oerip-pa-view', v); } catch {}
  $('v-harian').setAttribute('aria-pressed', String(v==='harian'));
  $('v-rekap').setAttribute('aria-pressed', String(v==='rekap'));
  $('v-anggota').setAttribute('aria-pressed', String(v==='anggota'));
  $('v-rutin').setAttribute('aria-pressed', String(v==='rutin'));
  $('v-riwayat').setAttribute('aria-pressed', String(v==='riwayat'));
  $('view-riwayat').hidden = v !== 'riwayat';
  if (v === 'riwayat') loadHistory(true);
  $('view-rutin').hidden = v !== 'rutin';
  if (v === 'rutin') loadTemplates();
  $('view-harian').hidden = v !== 'harian'; $('view-rekap').hidden = v !== 'rekap'; $('view-anggota').hidden = v !== 'anggota';
  if (v === 'rekap') { renderMonth(); loadMonth(); }
  if (v === 'anggota') loadMembers();
}
const goDay = d => { day = d; pendingDelete = null; openNotes.clear(); tasks = []; renderDay(); loadDay(); };
$('prev').onclick = () => goDay(addDays(day,-1));
$('next').onclick = () => goDay(addDays(day,1));
$('today').onclick = () => goDay(iso(new Date()));
$('datepick').onchange = e => { if (e.target.value) goDay(e.target.value); };
$('copyprev').onclick = copyPrev;

/* ---------- WhatsApp report ---------- */
const ICON = {hijau:'🟢', kuning:'🟡', merah:'🔴'};
function waReport(){
  const total = tasks.length, done = tasks.filter(t => t.done).length;
  const pct = total ? Math.round(done/total*100) : 0;
  const red = tasks.filter(t => t.status === 'merah'), yellow = tasks.filter(t => t.status === 'kuning');
  const L = [];
  L.push('*LAPORAN HARIAN OERIP INDONESIA*');
  L.push(longDate(day));
  L.push('');
  if (!total) { L.push('Belum ada tugas tercatat untuk hari ini.'); return L.join('\n'); }
  L.push(`Selesai: *${done} dari ${total} tugas (${pct}%)*`);
  if (red.length || yellow.length) L.push([red.length ? `🔴 Merah: ${red.length}` : '', yellow.length ? `🟡 Kuning: ${yellow.length}` : ''].filter(Boolean).join(' · '));
  const attention = tasks.filter(t => t.status === 'merah' || t.status === 'kuning' || (t.note && !t.done))
    .sort((a,b) => (b.status === 'merah') - (a.status === 'merah'));
  if (attention.length) {
    L.push(''); L.push('*Perlu perhatian*');
    for (const t of attention) {
      const dv = DIVS.find(d => d.k === t.div);
      L.push(`${ICON[t.status] || '📝'} ${dv ? dv.n : t.div}: ${t.text}${t.done ? ' (selesai)' : ''}`);
      if (t.note) L.push(`    _Catatan: ${t.note}_`);
    }
  }
  L.push(''); L.push('*Per divisi*');
  for (const d of DIVS) {
    const list = tasks.filter(t => t.div === d.k).sort((a,b) => a.text.localeCompare(b.text));
    if (!list.length) continue;
    const dn = list.filter(t => t.done).length;
    L.push(`${dn === list.length ? '✅' : '⏳'} *${d.n}* ${dn}/${list.length}`);
    const open = list.filter(t => !t.done);
    for (const t of open.slice(0, 5)) L.push(`    • belum: ${t.text}`);
    if (open.length > 5) L.push(`    • +${open.length - 5} tugas lain belum selesai`);
  }
  L.push(''); L.push('_Dikirim dari Checklist Laporan Harian PA_');
  return L.join('\n');
}
$('wa-open').onclick = () => {
  $('wa-text').value = waReport();
  $('wa-msg').textContent = '“Buka WhatsApp” membuka WhatsApp dengan teks ini, lalu pilih grup atau orang tujuan.';
  const dlg = $('wa-dialog');
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open','');
};
$('wa-copy').onclick = async () => {
  const ta = $('wa-text');
  try { await navigator.clipboard.writeText(ta.value); $('wa-msg').textContent = 'Teks tersalin. Tempel di grup WhatsApp.'; }
  catch { ta.select(); $('wa-msg').textContent = 'Teks sudah dipilih. Tekan Ctrl+C (atau Salin) lalu tempel di WhatsApp.'; }
};
$('wa-send').onclick = () => {
  window.open('https://wa.me/?text=' + encodeURIComponent($('wa-text').value), '_blank', 'noopener');
};
$('wprev').onclick = () => { month = addMonths(month,-1); monthTasks = []; renderMonth(); loadMonth(); };
$('wnext').onclick = () => { month = addMonths(month,1); monthTasks = []; renderMonth(); loadMonth(); };
$('thisweek').onclick = () => { month = iso(new Date()).slice(0,7); monthTasks = []; renderMonth(); loadMonth(); };
$('v-harian').onclick = () => setView('harian');
$('v-rekap').onclick = () => setView('rekap');
$('v-anggota').onclick = () => setView('anggota');
$('v-rutin').onclick = () => setView('rutin');
$('v-riwayat').onclick = () => setView('riwayat');

/* ---------- history (admin) ---------- */
const HPAGE = 100;
let histRows = [], histReq = 0;
async function loadHistory(reset){
  const req = ++histReq;
  if (reset) { histRows = []; fillWhoFilter(); }
  let q = sb.from('riwayat').select('*').order('waktu', { ascending: false }).order('id', { ascending: false });
  const dt = $('h-date').value, who = $('h-who').value, obj = $('h-obj').value;
  if (dt) { const a = new Date(dt + 'T00:00:00'), b = new Date(a); b.setDate(b.getDate()+1); q = q.gte('waktu', a.toISOString()).lt('waktu', b.toISOString()); }
  if (who) q = q.eq('email', who);
  if (obj) q = q.eq('objek', obj);
  const { data, error } = await q.range(histRows.length, histRows.length + HPAGE - 1);
  if (req !== histReq) return;
  const hn = $('hnotice');
  if (error) { hn.textContent = 'Riwayat gagal dimuat. Coba lagi.'; hn.dataset.kind = 'err'; hn.hidden = false; return; }
  hn.hidden = true;
  histRows = histRows.concat(data);
  renderHistory(data.length === HPAGE);
}
async function fillWhoFilter(){
  const sel = $('h-who'); if (sel.options.length > 1) return;
  const { data } = await sb.from('members').select('email,nama').order('nama');
  for (const m of data || []) sel.append(el('option',{value:m.email.toLowerCase(), text:m.nama}));
}
function renderHistory(hasMore){
  const t = $('histtable'); t.innerHTML = '';
  t.append(el('thead',{}, el('tr',{}, el('th',{text:'Waktu'}), el('th',{text:'Siapa'}), el('th',{text:'Perubahan'}), el('th',{text:'Pada'}))));
  const body = el('tbody');
  if (!histRows.length) body.append(el('tr',{}, el('td',{colspan:'4', class:'by', text:'Belum ada perubahan yang cocok dengan filter ini.'})));
  for (const r of histRows) {
    const w = new Date(r.waktu);
    const when = `${w.getDate()} ${BULAN[w.getMonth()].slice(0,3)} ${w.getFullYear()} · ${pad(w.getHours())}.${pad(w.getMinutes())}`;
    const dv = DIVS.find(d => d.k === r.divisi);
    const where = r.objek === 'anggota' ? 'Anggota' : `${r.objek === 'tugas rutin' ? 'Tugas rutin' : 'Checklist'}${dv ? ' · ' + dv.n : ''}${r.tanggal ? ' · ' + longDate(r.tanggal) : ''}`;
    body.append(el('tr',{}, el('td',{class:'when', text:when}),
      el('td',{text: r.pelaku || r.email || 'Sistem'}),
      el('td',{class:'what'}, document.createTextNode(r.aksi), el('small',{text: r.teks || ''})),
      el('td',{class:'by', text: where})));
  }
  t.append(body);
  $('h-more').hidden = !hasMore;
}
$('h-more').onclick = () => loadHistory(false);
['h-date','h-who','h-obj'].forEach(id => $(id).addEventListener('change', () => loadHistory(true)));
$('h-reset').onclick = () => { $('h-date').value = ''; $('h-who').value = ''; $('h-obj').value = ''; loadHistory(true); };

/* ---------- routine tasks (master) ---------- */
let templates = [];
function rnotice(msg, kind){ const n=$('rnotice'); if(!msg){n.hidden=true;return;} n.textContent=msg; n.dataset.kind=kind||''; n.hidden=false; }
async function loadTemplates(){
  const { data, error } = await sb.from('templates').select('*').order('dibuat');
  if (error) return rnotice('Tugas rutin gagal dimuat. Coba lagi.', 'err');
  templates = data; renderTemplates();
}
function renderTemplates(){
  const focused = document.activeElement && document.activeElement.id;
  $('rutinhint').hidden = false;
  const grid = $('rutingrid'); grid.innerHTML = '';
  for (const d of DIVS) {
    const list = templates.filter(t => t.divisi === d.k).sort((a,b) => a.teks.localeCompare(b.teks));
    const on = list.filter(t => t.aktif).length;
    const card = el('article',{class:'card','aria-label':`Tugas rutin ${d.n}`},
      el('div',{class:'card-h'}, el('h2',{text:d.n}), el('span',{class:'who',text:''}), el('span',{class:'frac',text:`${on} aktif`})));
    const ul = el('ul',{class:'tasks'});
    if (!list.length) ul.append(el('li',{class:'empty',text: canWrite ? 'Belum ada tugas rutin. Tambahkan di bawah.' : 'Belum ada tugas rutin.'}));
    for (const t of list) {
      const li = el('li',{class:'rtask' + (t.aktif ? '' : ' off')});
      const inp = el('input',{type:'text', id:`tpl-${t.id}`, maxlength:'240', 'aria-label':`Ubah tugas rutin ${t.teks}`});
      inp.value = t.teks; inp.readOnly = !canWrite;
      inp.addEventListener('change', async () => {
        const v = inp.value.trim(); if (!v) { inp.value = t.teks; return; }
        const { error } = await sb.from('templates').update({teks: v}).eq('id', t.id);
        if (error) rnotice('Perubahan gagal disimpan.', 'err'); else { t.teks = v; rnotice('Tersimpan. Berlaku untuk checklist hari berikutnya.'); }
      });
      li.append(inp);
      if (canWrite) {
        li.append(el('button',{class:'tog', text: t.aktif ? 'Jeda' : 'Aktifkan', title: t.aktif ? 'Berhenti muncul sementara' : 'Muncul lagi setiap hari', onclick: async () => {
          const { error } = await sb.from('templates').update({aktif: !t.aktif}).eq('id', t.id);
          if (error) return rnotice('Perubahan gagal disimpan.', 'err');
          t.aktif = !t.aktif; renderTemplates();
        }}));
        li.append(el('button',{class:'del', text:'Hapus', 'aria-label':`Hapus tugas rutin ${t.teks}`, onclick: (e) => {
          const box = e.target; box.replaceWith(el('div',{class:'confirm'}, el('span',{text:'Hapus?'}),
            el('button',{class:'yes',text:'Hapus', onclick: async () => {
              const { error } = await sb.from('templates').delete().eq('id', t.id);
              if (error) return rnotice('Tugas rutin gagal dihapus.', 'err');
              templates = templates.filter(x => x.id !== t.id); renderTemplates();
            }}),
            el('button',{text:'Batal', onclick: renderTemplates})));
        }}));
      }
      ul.append(li);
    }
    card.append(ul);
    if (canWrite) {
      const key = `tpl-add:${d.k}`;
      const inp = el('input',{id:`tpladd-${d.k}`, type:'text', placeholder:'Tambah tugas rutin…', 'aria-label':`Tambah tugas rutin ${d.n}`, maxlength:'240'});
      inp.value = draft.get(key);
      inp.addEventListener('input', () => draft.set(key, inp.value));
      card.append(el('form',{class:'add', onsubmit: async e => {
        e.preventDefault(); const v = inp.value.trim(); if (!v) return;
        const { data, error } = await sb.from('templates').insert({divisi: d.k, teks: v}).select().single();
        if (error) return rnotice('Tugas rutin gagal ditambahkan.', 'err');
        draft.set(key, ''); templates.push(data); renderTemplates();
        routineDone.clear();
        rnotice('Ditambahkan. Tugas ini muncul di checklist hari ini dan setiap hari kerja berikutnya.');
      }}, inp, el('button',{type:'submit',text:'Tambah'})));
    }
    grid.append(card);
  }
  if (focused) { const f = $(focused); if (f) f.focus(); }
}

/* ---------- members (admin) ---------- */
const AKUN_DOMAIN = 'akun.oerip.id';
const toLogin = id => { id = (id || '').trim().toLowerCase(); return id.includes('@') ? id : `${id}@${AKUN_DOMAIN}`; };
const showLogin = email => email.endsWith('@' + AKUN_DOMAIN) ? email.slice(0, -(AKUN_DOMAIN.length + 1)) : email;
const PERAN = {admin:'Admin (bisa kelola anggota)', edit:'Bisa mengubah', lihat:'Lihat saja'};
function mnotice(msg, kind){ const n=$('mnotice'); if(!msg){n.hidden=true;return;} n.textContent=msg; n.dataset.kind=kind||''; n.hidden=false; }
async function akun(body){
  const { data, error } = await sb.functions.invoke('kelola-akun', { body });
  if (!error) return { ok: true, data };
  let msg = 'Server akun tidak bisa dihubungi. Coba lagi.';
  try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch {}
  return { ok: false, msg };
}
async function loadMembers(){
  const { data, error } = await sb.from('members').select('email,nama,peran').order('nama');
  if (error) return mnotice('Daftar anggota gagal dimuat. Coba lagi.', 'err');
  const t = $('membertable'); t.innerHTML = '';
  t.append(el('thead',{}, el('tr',{}, el('th',{text:'Nama'}), el('th',{text:'Username / email login'}), el('th',{text:'Hak akses'}), el('th',{text:''}))));
  const body = el('tbody');
  for (const m of data) {
    const self = m.email.toLowerCase() === myEmail;
    const sel = el('select',{'aria-label':`Hak akses ${m.nama}`});
    for (const [v,l] of Object.entries(PERAN)) { const o = el('option',{value:v,text:l}); if (v===m.peran) o.selected = true; sel.append(o); }
    sel.disabled = self;
    sel.addEventListener('change', async () => {
      const { error } = await sb.from('members').update({peran: sel.value}).eq('email', m.email);
      if (error) mnotice('Hak akses gagal diubah.', 'err'); else mnotice(`Hak akses ${m.nama} diubah.`);
    });
    const cell = el('td',{class:'actions'});
    const showActions = () => {
      cell.innerHTML = '';
      if (self) { cell.append(el('span',{class:'by',text:'Akun Anda'})); return; }
      cell.append(
        el('button',{class:'del',text:'Atur / reset kata sandi', onclick: () => {
          cell.innerHTML = '';
          const inp = el('input',{type:'password', class:'pwreset', placeholder:'Kata sandi baru (min. 8)', autocomplete:'new-password', 'aria-label':`Kata sandi baru untuk ${m.nama}`, minlength:'8'});
          cell.append(el('form',{class:'confirm', onsubmit: async e => {
            e.preventDefault();
            if (inp.value.length < 8) return mnotice('Kata sandi minimal 8 karakter.', 'err');
            const r = await akun({ action:'reset_password', username: m.email, password: inp.value });
            if (!r.ok) return mnotice(r.msg, 'err');
            mnotice(r.data && r.data.created ? `Akun login ${m.nama} dibuat. Login: ${showLogin(m.email)} dengan kata sandi yang tadi diisi.` : `Kata sandi ${m.nama} sudah direset dan akunnya aktif. Berikan kata sandi baru itu kepadanya secara langsung.`); showActions();
          }}, inp, el('button',{type:'submit',class:'yes',text:'Simpan'}), el('button',{type:'button',text:'Batal', onclick: showActions})));
          inp.focus();
        }}),
        el('button',{class:'del',text:'Hapus', onclick: () => {
          cell.innerHTML = '';
          cell.append(el('div',{class:'confirm'}, el('span',{text:'Hapus akun & cabut akses?'}),
            el('button',{class:'yes',text:'Hapus', onclick: async () => {
              const { error } = await sb.from('members').delete().eq('email', m.email);
              if (error) return mnotice('Anggota gagal dihapus.', 'err');
              const r = await akun({ action:'delete', username: m.email });
              mnotice(r.ok ? `${m.nama} sudah dihapus dan tidak bisa masuk lagi.` : `${m.nama} sudah tidak punya akses, tetapi akun loginnya gagal dihapus: ${r.msg}`, r.ok ? '' : 'err');
              loadMembers();
            }}),
            el('button',{text:'Batal', onclick: showActions})));
        }}));
    };
    showActions();
    body.append(el('tr',{}, el('td',{text:m.nama}), el('td',{text:showLogin(m.email)}), el('td',{}, sel), cell));
  }
  t.append(body);
}
$('memberform').addEventListener('submit', async e => {
  e.preventDefault();
  const nama = $('m-nama').value.trim(), username = $('m-user').value.trim().toLowerCase(), peran = $('m-peran').value, password = $('m-pass').value;
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return mnotice('Username 3–32 karakter: huruf kecil, angka, titik, garis bawah, atau strip. Tanpa spasi.', 'err');
  if (password.length < 8) return mnotice('Kata sandi awal minimal 8 karakter.', 'err');
  const btn = $('m-save'); btn.disabled = true; btn.textContent = 'Membuat akun…';
  try {
    const r = await akun({ action:'create', username, nama, password });
    if (!r.ok) return mnotice(r.msg, 'err');
    const { error } = await sb.from('members').upsert({ email: toLogin(username), nama, peran });
    if (error) return mnotice('Akun login dibuat, tetapi gagal didaftarkan sebagai anggota. Coba simpan lagi.', 'err');
    mnotice(`Akun ${nama} siap. Login: username “${username}” dengan kata sandi awal yang tadi diisi. Minta dia menggantinya lewat tombol “Ganti kata sandi”.`);
    $('memberform').reset(); loadMembers();
  } finally { btn.disabled = false; btn.textContent = 'Buat akun'; }
});
$('logout').onclick = async () => {
  const b = $('logout'); b.disabled = true; b.textContent = 'Keluar…';
  try { await Promise.race([sb.auth.signOut({ scope: 'local' }), new Promise(r => setTimeout(r, 3000))]); } catch {}
  try { Object.keys(localStorage).filter(k => k.startsWith('sb-')).forEach(k => localStorage.removeItem(k)); } catch {}
  location.replace(location.pathname);
};

/* ---------- login & start ---------- */
$('loginform').addEventListener('submit', async e => {
  e.preventDefault();
  $('loginbtn').disabled = true; $('loginerr').hidden = true;
  const email = toLogin($('email').value), password = $('password').value;
  const showErr = (m, kind) => { $('loginerr').textContent = m; $('loginerr').dataset.kind = kind || ''; $('loginerr').hidden = false; };
  const { error } = await sb.auth.signInWithPassword({ email, password });
  $('loginbtn').disabled = false;
  if (error) {
    if (/confirm/i.test(error.message)) return showErr('Akun ini belum aktif. Minta admin menekan “Reset kata sandi” untuk akun Anda.');
    if (error.status === 429 || /rate limit/i.test(error.message)) return showErr('Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.');
    return showErr('Username atau kata sandi salah.');
  }
  start();
});

/* ---------- password ---------- */
let recoveryMode = false;
function openPw(recovery){
  recoveryMode = !!recovery;
  $('pw-form').reset(); $('pw-msg').textContent = '';
  $('pw-hint').textContent = recovery ? 'Buat kata sandi baru untuk akun Anda (minimal 8 karakter).' : 'Kata sandi baru minimal 8 karakter.';
  const d = $('pw-dialog'); if (d.showModal) d.showModal(); else d.setAttribute('open','');
}
$('pw-open').onclick = () => openPw(false);
$('pw-close').onclick = () => $('pw-dialog').close();
$('pw-form').addEventListener('submit', async e => {
  e.preventDefault();
  const a = $('pw-new').value, b = $('pw-again').value;
  if (a.length < 8) { $('pw-msg').textContent = 'Kata sandi minimal 8 karakter.'; return; }
  if (a !== b) { $('pw-msg').textContent = 'Kedua kata sandi tidak sama. Ketik ulang.'; return; }
  $('pw-save').disabled = true;
  const { error } = await sb.auth.updateUser({ password: a });
  $('pw-save').disabled = false;
  if (error) { $('pw-msg').textContent = /same|different/i.test(error.message) ? 'Kata sandi baru harus berbeda dari yang lama.' : 'Kata sandi gagal diganti. Coba lagi.'; return; }
  $('pw-form').reset();
  $('pw-msg').textContent = 'Kata sandi berhasil diganti. Gunakan kata sandi baru saat masuk berikutnya.';
  if (recoveryMode) { recoveryMode = false; history.replaceState(null, '', location.pathname); setTimeout(() => { $('pw-dialog').close(); start(); }, 1200); }
});
sb.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') openPw(true); });
async function start(){
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { $('login').hidden = false; $('app').hidden = true; return; }
  const email = (session.user.email || '').toLowerCase();
  const { data: me, error } = await sb.from('members').select('nama,peran').ilike('email', email).maybeSingle();
  if (error || !me) {
    $('login').hidden = false; $('app').hidden = true;
    $('loginerr').textContent = 'Akun ini belum didaftarkan sebagai anggota. Hubungi admin.'; $('loginerr').dataset.kind=''; $('loginerr').hidden = false;
    await sb.auth.signOut(); return;
  }
  myEmail = email;
  isAdmin = me.peran === 'admin';
  canWrite = isAdmin || me.peran === 'edit';
  $('v-anggota').hidden = !isAdmin;
  $('v-riwayat').hidden = !isAdmin;
  if (!isAdmin && (view === 'anggota' || view === 'riwayat')) view = 'harian';
  $('whoami').textContent = `${me.nama} · ${isAdmin ? 'admin' : canWrite ? 'bisa mengubah' : 'lihat saja'}`;
  $('login').hidden = true; $('app').hidden = false;
  if (!canWrite) notice('Mode lihat saja. Hanya PA, CEO, dan Vice CEO yang bisa menambah, mencentang, dan menghapus tugas.');
  setView(view); renderDay(); loadDay();
  channel = sb.channel('tasks-live').on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, refreshSoon).subscribe();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshSoon(); });
}
start();
})();
