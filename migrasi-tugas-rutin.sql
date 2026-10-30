-- =====================================================================
--  Tambahan: Tugas rutin (master) yang otomatis muncul setiap hari kerja
--  Jalankan sekali di Supabase: SQL Editor -> New query -> tempel -> Run
-- =====================================================================

-- Daftar tugas rutin per divisi
create table if not exists public.templates (
  id      uuid primary key default gen_random_uuid(),
  divisi  text not null check (divisi in ('hro','finance','marketing','produksi','rnd','procurement','supporting')),
  teks    text not null check (char_length(teks) between 1 and 240),
  aktif   boolean not null default true,
  dibuat  timestamptz not null default now()
);

-- Penanda tugas harian yang berasal dari tugas rutin
alter table public.tasks add column if not exists template_id uuid references public.templates(id) on delete set null;

-- Catatan tugas rutin mana yang sudah dibuat untuk tanggal tertentu.
-- Dengan ini, tugas rutin yang sengaja dihapus dari satu hari tidak muncul lagi di hari itu.
create table if not exists public.routine_runs (
  tanggal      date not null,
  template_id  uuid not null references public.templates(id) on delete cascade,
  primary key (tanggal, template_id)
);

alter table public.templates    enable row level security;
alter table public.routine_runs enable row level security;

drop policy if exists "anggota lihat rutin" on public.templates;
create policy "anggota lihat rutin" on public.templates
  for select to authenticated using (public.peran_saya() is not null);
drop policy if exists "editor kelola rutin" on public.templates;
create policy "editor kelola rutin" on public.templates
  for all to authenticated using (public.peran_saya() in ('admin','edit')) with check (public.peran_saya() in ('admin','edit'));

drop policy if exists "anggota lihat run" on public.routine_runs;
create policy "anggota lihat run" on public.routine_runs
  for select to authenticated using (public.peran_saya() is not null);
drop policy if exists "editor tambah run" on public.routine_runs;
create policy "editor tambah run" on public.routine_runs
  for insert to authenticated with check (public.peran_saya() in ('admin','edit'));

grant select, insert, update, delete on public.templates to authenticated;
grant select, insert on public.routine_runs to authenticated;
revoke all on public.templates from anon;
revoke all on public.routine_runs from anon;

-- Membuat tugas rutin untuk satu tanggal (hari Minggu dilewati).
-- Aman dipanggil berkali-kali dan oleh beberapa orang sekaligus: tiap tugas rutin hanya dibuat sekali per tanggal.
create or replace function public.buat_tugas_rutin(p_tanggal date)
returns integer
language plpgsql security invoker set search_path = public
as $$
declare jumlah integer := 0;
begin
  if extract(isodow from p_tanggal) = 7 then return 0; end if;
  if coalesce(public.peran_saya(), '') not in ('admin','edit') then return 0; end if;
  with baru as (
    insert into public.routine_runs (tanggal, template_id)
    select p_tanggal, t.id from public.templates t where t.aktif
    on conflict do nothing
    returning template_id
  ), dibuat as (
    insert into public.tasks (tanggal, divisi, teks, template_id)
    select p_tanggal, t.divisi, t.teks, t.id
    from public.templates t join baru b on b.template_id = t.id
    returning 1
  )
  select count(*) into jumlah from dibuat;
  return jumlah;
end;
$$;
revoke all on function public.buat_tugas_rutin(date) from public, anon;
grant execute on function public.buat_tugas_rutin(date) to authenticated;
