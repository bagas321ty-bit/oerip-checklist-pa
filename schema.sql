-- =====================================================================
--  Checklist Laporan Harian PA · Oerip Indonesia
--  Jalankan SEKALI di Supabase: menu SQL Editor -> New query -> tempel -> Run
-- =====================================================================

-- 1) Daftar orang yang boleh masuk dan haknya
create table if not exists public.members (
  email  text primary key,
  nama   text not null,
  peran  text not null check (peran in ('admin', 'edit', 'lihat'))
);

-- 2) Tugas harian per divisi
create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  tanggal      date not null,
  divisi       text not null check (divisi in ('hro','finance','marketing','produksi','rnd','procurement','supporting')),
  teks         text not null check (char_length(teks) between 1 and 240),
  selesai      boolean not null default false,
  status       text not null default '' check (status in ('', 'hijau', 'kuning', 'merah')),
  catatan      text not null default '' check (char_length(catatan) <= 600),
  diubah_oleh  text,
  dibuat       timestamptz not null default now(),
  diubah       timestamptz not null default now()
);
create index if not exists tasks_tanggal_idx on public.tasks (tanggal);

-- 3) Peran orang yang sedang login (dibaca dari tabel members)
create or replace function public.peran_saya()
returns text
language sql stable security definer set search_path = public
as $$
  select peran from public.members
  where lower(email) = lower(auth.jwt() ->> 'email')
$$;

-- 4) Nama pengubah dan waktu ubah diisi otomatis oleh server (tidak bisa dipalsukan)
create or replace function public.isi_pengubah()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.diubah_oleh := (select nama from public.members where lower(email) = lower(auth.jwt() ->> 'email'));
  new.diubah := now();
  if tg_op = 'INSERT' then new.dibuat := now(); end if;
  return new;
end;
$$;
drop trigger if exists tasks_isi_pengubah on public.tasks;
create trigger tasks_isi_pengubah before insert or update on public.tasks
  for each row execute function public.isi_pengubah();

-- 5) Hak akses: anggota boleh melihat; hanya peran 'edit' yang boleh mengubah
alter table public.members enable row level security;
alter table public.tasks   enable row level security;

drop policy if exists "anggota lihat members" on public.members;
create policy "anggota lihat members" on public.members
  for select to authenticated using (public.peran_saya() is not null);

drop policy if exists "anggota lihat tugas" on public.tasks;
create policy "anggota lihat tugas" on public.tasks
  for select to authenticated using (public.peran_saya() is not null);

drop policy if exists "editor tambah tugas" on public.tasks;
create policy "editor tambah tugas" on public.tasks
  for insert to authenticated with check (public.peran_saya() in ('admin','edit'));

drop policy if exists "editor ubah tugas" on public.tasks;
create policy "editor ubah tugas" on public.tasks
  for update to authenticated using (public.peran_saya() in ('admin','edit')) with check (public.peran_saya() in ('admin','edit'));

drop policy if exists "editor hapus tugas" on public.tasks;
create policy "editor hapus tugas" on public.tasks
  for delete to authenticated using (public.peran_saya() in ('admin','edit'));

-- Hanya admin (CEO) yang boleh menambah, mengubah, dan menghapus anggota
drop policy if exists "admin kelola members" on public.members;
create policy "admin kelola members" on public.members
  for all to authenticated using (public.peran_saya() = 'admin') with check (public.peran_saya() = 'admin');

-- Izin dasar untuk pengguna yang login (aturan di atas tetap membatasi barisnya)
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.members to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
revoke all on public.members from anon;
revoke all on public.tasks from anon;

-- 6) Perubahan langsung muncul di layar orang lain (realtime)
do $$ begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null; end $$;

-- 7) Admin pertama (CEO). Anggota lain ditambahkan dari menu "Kelola anggota" di aplikasi.
insert into public.members (email, nama, peran) values
  ('bagas321ty@gmail.com', 'Bagas Qolbu Cetta', 'admin')
on conflict (email) do update set nama = excluded.nama, peran = excluded.peran;
