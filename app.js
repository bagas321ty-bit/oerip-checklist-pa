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
let signupMode = false;
let day = iso(new Date());
let week = monday(day);
let tasks = [], weekTasks = [];
let pendingDelete = null;
const openNotes = new Set();
let view = 'harian';
try { const v = localStorage.getItem('oerip-pa-view'); if (v === 'rekap' || v === 'anggota' || v === 'rutin') view = v; } catch {}
let channel = null, refreshTimer = null;

const draft = {
  get(k){ try { return localStorage.getItem('oerip-draft:' + k) || ''; } catch { return ''; } },
  set(k, v){ try { v ? localStorage.setItem('oerip-draft:' + k, v) : localStorage.removeItem('oerip-draft:' + k); } catch {} },
};
function notice(msg, kind){ const n = $('notice'); if (!msg) { n.hidden = true; return; } n.textContent = msg; n.dataset.kind = kind || ''; n.hidden = false; }
function handleErr(e){
  console.error(e);
  const msg = (e && (e.message || '')) + '';
  if (/row-level security|permission|42501/i.test(msg)) notice('Perubahan ditolak. Akun ini hanya punya akses lihat.', 'err');
  else if (/JWT|session/i.test(msg)) notice('Sesi login habis. Muat ulang halaman lalu masuk lagi.', 'err');
  else notice('Perubahan belum tersimpan karena koneksi bermasalah. Coba lagi.', 'err');
}

/* ---------- data ---------- */
const fromRow = r => ({id:r.id, tpl:r.template_id, date:r.tanggal, div:r.divisi, text:r.teks, done:r.selesai, status:r.status, note:r.catatan, by:r.diubah_oleh, createdAt:r.dibuat, updatedAt:r.diubah});
let routineDone = new Set();
async function ensureRoutine(d){
  if (!canWrite || routineDone.has(d) || d < iso(new Date()) || parse(d).getDay() === 0) return;
  routineDone.add(d);
  const { error } = await sb.rpc('buat_tugas_rutin', { p_tanggal: d });
  if (error) { routineDone.delete(d); console.error(error); }
}
async function loadDay(){
  const d = day;
  await ensureRoutine(d);
  if (d !== day) return;
  const { data, error } = await sb.from('tasks').select('*').eq('tanggal', day).order('dibuat');
  if (error) return handleErr(error);
  tasks = data.map(fromRow); renderDay();
}
async function loadWeek(){
  const { data, error } = await sb.from('tasks').select('*').gte('tanggal', week).lte('tanggal', addDays(week,6));
  if (error) return handleErr(error);
  weekTasks = data.map(fromRow); renderWeek();
}
function refreshSoon(){ clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { loadDay(); if (view === 'rekap') loadWeek(); }, 250); }
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
      const { data, error } = await sb.from('tasks').select('divisi,teks').eq('tanggal', addDays(day,-i)).order('dibuat');
      if (error) throw error;
      if (data.length) src = data;
    }
    if (!src) { notice('Tidak ada tugas di 7 hari terakhir untuk disalin.'); return; }
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

/* ---------- weekly view ---------- */
function pctPill(done, tot){
  if (!tot) return el('span',{class:'by',text:'—'});
  const p = Math.round(done/tot*100);
  return el('span',{class:'pct ' + (p>=90?'hi':p>=70?'mid':'lo'), text:`${p}%`});
}
function renderWeek(){
  const a = parse(week), b = parse(addDays(week,6));
  $('weektitle').innerHTML = '';
  $('weektitle').append(el('span',{text: week === monday(iso(new Date())) ? 'Minggu ini' : 'Minggu'}),
    document.createTextNode(`${a.getDate()} ${BULAN[a.getMonth()].slice(0,3)} – ${b.getDate()} ${BULAN[b.getMonth()].slice(0,3)} ${b.getFullYear()}`));
  const days = Array.from({length:6}, (_,i) => addDays(week, i));
  if (weekTasks.some(t => t.date === addDays(week,6))) days.push(addDays(week,6));

  const t = $('rekaptable'); t.innerHTML = '';
  const head = el('tr',{}, el('th',{text:'Divisi'}));
  for (const d of days) { const dd = parse(d); head.append(el('th',{text:`${HARI[dd.getDay()].slice(0,3)} ${dd.getDate()}`})); }
  head.append(el('th',{text:'Selesai'}), el('th',{text:'Status'}));
  t.append(el('thead',{}, head));
  const body = el('tbody'); let gD=0, gT=0;
  for (const dv of DIVS) {
    const tr = el('tr',{}, el('td',{text:dv.n})); let done=0, tot=0, k=0, m=0;
    for (const d of days) {
      const l = weekTasks.filter(x => x.div===dv.k && x.date===d), dn = l.filter(x=>x.done).length;
      done += dn; tot += l.length; k += l.filter(x=>x.status==='kuning').length; m += l.filter(x=>x.status==='merah').length;
      tr.append(l.length ? el('td',{class:'day'}, el('b',{text:`${dn}/${l.length}`})) : el('td',{class:'none',text:'—'}));
    }
    gD+=done; gT+=tot;
    const fl = el('div',{class:'flags'});
    if (k) fl.append(el('span',{class:'flag k',text:`${k} K`}));
    if (m) fl.append(el('span',{class:'flag m',text:`${m} M`}));
    if (!k && !m) fl.append(el('span',{class:'by',text: tot ? 'aman' : '—'}));
    tr.append(el('td',{}, pctPill(done,tot)), el('td',{}, fl)); body.append(tr);
  }
  const tot = el('tr',{class:'total'}, el('td',{text:'Semua divisi'}));
  for (const d of days) { const l = weekTasks.filter(x=>x.date===d); tot.append(el('td',{text: l.length ? `${l.filter(x=>x.done).length}/${l.length}` : '—'})); }
  tot.append(el('td',{}, pctPill(gD,gT)), el('td')); body.append(tot); t.append(body);

  const issues = $('issues'); issues.innerHTML = '';
  const flagged = weekTasks.filter(x => x.status==='merah' || x.status==='kuning' || (x.note && !x.done))
    .sort((p,q) => (q.status==='merah') - (p.status==='merah') || p.date.localeCompare(q.date));
  issues.append(el('h3',{text: flagged.length ? `Perlu perhatian minggu ini (${flagged.length})` : 'Perlu perhatian minggu ini'}));
  if (!flagged.length) { issues.append(el('p',{class:'by',text:'Tidak ada tugas berstatus kuning atau merah, dan tidak ada catatan kendala yang terbuka.'})); return; }
  const ul = el('ul');
  for (const x of flagged) {
    const dv = DIVS.find(d=>d.k===x.div), dd = parse(x.date);
    ul.append(el('li',{}, el('span',{class:'flag '+(x.status==='merah'?'m':x.status==='kuning'?'k':''),text: x.status ? x.status.toUpperCase() : 'CATATAN'}),
      document.createTextNode(' ' + x.text + ' '),
      el('small',{text:`· ${dv ? dv.n : x.div} · ${HARI[dd.getDay()]} ${dd.getDate()}${x.done ? ' · selesai' : ''}${x.note ? ' · ' + x.note : ''}`})));
  }
  issues.append(ul);
}

/* ---------- navigation ---------- */
function setView(v){
  view = v; try { localStorage.setItem('oerip-pa-view', v); } catch {}
  $('v-harian').setAttribute('aria-pressed', String(v==='harian'));
  $('v-rekap').setAttribute('aria-pressed', String(v==='rekap'));
  $('v-anggota').setAttribute('aria-pressed', String(v==='anggota'));
  $('v-rutin').setAttribute('aria-pressed', String(v==='rutin'));
  $('view-rutin').hidden = v !== 'rutin';
  if (v === 'rutin') loadTemplates();
  $('view-harian').hidden = v !== 'harian'; $('view-rekap').hidden = v !== 'rekap'; $('view-anggota').hidden = v !== 'anggota';
  if (v === 'rekap') { renderWeek(); loadWeek(); }
  if (v === 'anggota') loadMembers();
}
const goDay = d => { day = d; pendingDelete = null; openNotes.clear(); tasks = []; renderDay(); loadDay(); };
$('prev').onclick = () => goDay(addDays(day,-1));
$('next').onclick = () => goDay(addDays(day,1));
$('today').onclick = () => goDay(iso(new Date()));
$('datepick').onchange = e => { if (e.target.value) goDay(e.target.value); };
$('copyprev').onclick = copyPrev;
$('wprev').onclick = () => { week = addDays(week,-7); renderWeek(); loadWeek(); };
$('wnext').onclick = () => { week = addDays(week,7); renderWeek(); loadWeek(); };
$('thisweek').onclick = () => { week = monday(iso(new Date())); renderWeek(); loadWeek(); };
$('v-harian').onclick = () => setView('harian');
$('v-rekap').onclick = () => setView('rekap');
$('v-anggota').onclick = () => setView('anggota');
$('v-rutin').onclick = () => setView('rutin');

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
const PERAN = {admin:'Admin (bisa kelola anggota)', edit:'Bisa mengubah', lihat:'Lihat saja'};
function mnotice(msg, kind){ const n=$('mnotice'); if(!msg){n.hidden=true;return;} n.textContent=msg; n.dataset.kind=kind||''; n.hidden=false; }
async function loadMembers(){
  const { data, error } = await sb.from('members').select('email,nama,peran').order('nama');
  if (error) return mnotice('Daftar anggota gagal dimuat. Coba lagi.', 'err');
  const t = $('membertable'); t.innerHTML = '';
  t.append(el('thead',{}, el('tr',{}, el('th',{text:'Nama'}), el('th',{text:'Email'}), el('th',{text:'Hak akses'}), el('th',{text:''}))));
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
    let act;
    if (self) act = el('span',{class:'by',text:'Akun Anda'});
    else act = el('button',{class:'del',text:'Hapus', onclick: async (e) => {
      const cell = e.target.parentElement; cell.innerHTML = '';
      cell.append(el('div',{class:'confirm'}, el('span',{text:'Cabut akses?'}),
        el('button',{class:'yes',text:'Hapus', onclick: async () => {
          const { error } = await sb.from('members').delete().eq('email', m.email);
          if (error) mnotice('Anggota gagal dihapus.', 'err'); else { mnotice(`${m.nama} tidak lagi punya akses.`); loadMembers(); } }}),
        el('button',{text:'Batal', onclick: loadMembers})));
    }});
    body.append(el('tr',{}, el('td',{text:m.nama}), el('td',{text:m.email}), el('td',{}, sel), el('td',{}, act)));
  }
  t.append(body);
}
$('memberform').addEventListener('submit', async e => {
  e.preventDefault();
  const row = { nama: $('m-nama').value.trim(), email: $('m-email').value.trim().toLowerCase(), peran: $('m-peran').value };
  const { error } = await sb.from('members').upsert(row);
  if (error) return mnotice('Anggota gagal disimpan. Periksa email lalu coba lagi.', 'err');
  mnotice(`${row.nama} terdaftar. Minta dia membuka aplikasi, pilih “Buat akun”, lalu pakai email ${row.email}.`);
  $('memberform').reset(); loadMembers();
});
$('logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };

/* ---------- login & start ---------- */
$('loginform').addEventListener('submit', async e => {
  e.preventDefault();
  $('loginbtn').disabled = true; $('loginerr').hidden = true;
  const email = $('email').value.trim().toLowerCase(), password = $('password').value;
  const showErr = (m, kind) => { $('loginerr').textContent = m; $('loginerr').dataset.kind = kind || ''; $('loginerr').hidden = false; };
  if (signupMode) {
    const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
    $('loginbtn').disabled = false;
    if (error) return showErr(/registered|exists/i.test(error.message) ? 'Email ini sudah punya akun. Pilih “Sudah punya akun? Masuk”.' : /password/i.test(error.message) ? 'Kata sandi minimal 6 karakter.' : 'Akun gagal dibuat. Coba lagi.');
    if (!data.session) return showErr('Akun dibuat. Buka email Anda dan klik tautan konfirmasi, lalu masuk.', 'ok');
    return start();
  }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  $('loginbtn').disabled = false;
  if (error) return showErr(/confirm/i.test(error.message) ? 'Email belum dikonfirmasi. Cek kotak masuk email Anda.' : 'Email atau kata sandi salah.');
  start();
});

$('togglemode').addEventListener('click', () => {
  signupMode = !signupMode;
  $('loginbtn').textContent = signupMode ? 'Buat akun' : 'Masuk';
  $('togglemode').textContent = signupMode ? 'Sudah punya akun? Masuk' : 'Belum punya kata sandi? Buat akun';
  $('loginhint').textContent = signupMode ? 'Pakai email yang sudah didaftarkan CEO, lalu buat kata sandi (minimal 6 karakter).' : 'Masuk dengan email yang sudah didaftarkan CEO.';
  $('password').setAttribute('autocomplete', signupMode ? 'new-password' : 'current-password');
  $('loginerr').hidden = true;
});

async function start(){
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { $('login').hidden = false; $('app').hidden = true; return; }
  const email = (session.user.email || '').toLowerCase();
  const { data: me, error } = await sb.from('members').select('nama,peran').ilike('email', email).maybeSingle();
  if (error || !me) {
    $('login').hidden = false; $('app').hidden = true;
    $('loginerr').textContent = 'Email ini belum didaftarkan CEO, jadi belum bisa membuka checklist.'; $('loginerr').dataset.kind=''; $('loginerr').hidden = false;
    await sb.auth.signOut(); return;
  }
  myEmail = email;
  isAdmin = me.peran === 'admin';
  canWrite = isAdmin || me.peran === 'edit';
  $('v-anggota').hidden = !isAdmin;
  if (!isAdmin && view === 'anggota') view = 'harian';
  $('whoami').textContent = `${me.nama} · ${isAdmin ? 'admin' : canWrite ? 'bisa mengubah' : 'lihat saja'}`;
  $('login').hidden = true; $('app').hidden = false;
  if (!canWrite) notice('Mode lihat saja. Hanya PA, CEO, dan Vice CEO yang bisa menambah, mencentang, dan menghapus tugas.');
  setView(view); renderDay(); loadDay();
  channel = sb.channel('tasks-live').on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, refreshSoon).subscribe();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshSoon(); });
}
start();
})();
