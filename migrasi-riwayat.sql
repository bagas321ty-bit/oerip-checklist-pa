-- =====================================================================
--  Tambahan: Riwayat perubahan (siapa mengubah apa, kapan)
--  + perbaikan: tugas rutin hanya dibuat untuk hari ini (waktu Jakarta)
--  Jalankan sekali di Supabase: SQL Editor -> New query -> tempel -> Run
-- =====================================================================

create table if not exists public.riwayat (
  id          bigint generated always as identity primary key,
  waktu       timestamptz not null default now(),
  pelaku      text,           -- nama dari tabel members
  email       text,
  objek       text not null,  -- 'tugas' | 'tugas rutin' | 'anggota'
  aksi        text not null,  -- ringkasan yang mudah dibaca
  tanggal     date,           -- tanggal checklist (untuk tugas)
  divisi      text,
  teks        text            -- nama tugas / anggota
);
create index if not exists riwayat_waktu_idx on public.riwayat (waktu desc);

alter table public.riwayat enable row level security;
drop policy if exists "admin lihat riwayat" on public.riwayat;
create policy "admin lihat riwayat" on public.riwayat
  for select to authenticated using (public.peran_saya() = 'admin');
-- Tidak ada izin tulis/ubah/hapus untuk pengguna: riwayat hanya diisi oleh trigger di bawah.
grant select on public.riwayat to authenticated;
revoke all on public.riwayat from anon;

create or replace function public.catat_riwayat()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_email  text := lower(auth.jwt() ->> 'email');
  v_nama   text := (select nama from public.members where lower(email) = v_email);
  v_aksi   text;
  v_parts  text[] := '{}';
begin
  -- Pembuatan tugas rutin otomatis tidak perlu dicatat satu per satu
  -- (dicek bertingkat: PL/pgSQL tidak berhenti di 'and', jadi kolom template_id hanya dibaca untuk tabel tasks)
  if tg_table_name = 'tasks' and tg_op = 'INSERT' then
    if new.template_id is not null then return new; end if;
  end if;

  if tg_table_name = 'tasks' then
    if tg_op = 'INSERT' then
      insert into public.riwayat (pelaku, email, objek, aksi, tanggal, divisi, teks)
      values (v_nama, v_email, 'tugas', 'Menambah tugas', new.tanggal, new.divisi, new.teks);
    elsif tg_op = 'DELETE' then
      insert into public.riwayat (pelaku, email, objek, aksi, tanggal, divisi, teks)
      values (v_nama, v_email, 'tugas', 'Menghapus tugas', old.tanggal, old.divisi, old.teks);
    else
      if new.selesai is distinct from old.selesai then
        v_parts := v_parts || case when new.selesai then 'Mencentang selesai' else 'Membatalkan centang' end;
      end if;
      if new.status is distinct from old.status then
        v_parts := v_parts || ('Status: ' || coalesce(nullif(old.status,''),'kosong') || ' → ' || coalesce(nullif(new.status,''),'kosong'));
      end if;
      if new.catatan is distinct from old.catatan then
        v_parts := v_parts || case when new.catatan = '' then 'Menghapus catatan' else ('Catatan: "' || left(new.catatan, 120) || '"') end;
      end if;
      if new.teks is distinct from old.teks then
        v_parts := v_parts || ('Nama tugas diubah dari "' || old.teks || '"');
      end if;
      if array_length(v_parts, 1) is null then return new; end if;
      insert into public.riwayat (pelaku, email, objek, aksi, tanggal, divisi, teks)
      values (v_nama, v_email, 'tugas', array_to_string(v_parts, ' · '), new.tanggal, new.divisi, new.teks);
    end if;

  elsif tg_table_name = 'templates' then
    if tg_op = 'INSERT' then v_aksi := 'Menambah tugas rutin';
    elsif tg_op = 'DELETE' then v_aksi := 'Menghapus tugas rutin';
    else
      if new.teks is distinct from old.teks then v_parts := v_parts || ('Mengganti nama dari "' || old.teks || '"'); end if;
      if new.aktif is distinct from old.aktif then v_parts := v_parts || case when new.aktif then 'Mengaktifkan lagi' else 'Menjeda' end; end if;
      if array_length(v_parts, 1) is null then return new; end if;
      v_aksi := array_to_string(v_parts, ' · ');
    end if;
    insert into public.riwayat (pelaku, email, objek, aksi, divisi, teks)
    values (v_nama, v_email, 'tugas rutin', v_aksi,
            case when tg_op = 'DELETE' then old.divisi else new.divisi end,
            case when tg_op = 'DELETE' then old.teks else new.teks end);

  elsif tg_table_name = 'members' then
    if tg_op = 'INSERT' then v_aksi := 'Mendaftarkan anggota (' || new.peran || ')';
    elsif tg_op = 'DELETE' then v_aksi := 'Mencabut akses anggota';
    else
      if new.peran is distinct from old.peran then v_aksi := 'Hak akses: ' || old.peran || ' → ' || new.peran;
      elsif new.nama is distinct from old.nama then v_aksi := 'Mengganti nama dari "' || old.nama || '"';
      else return new; end if;
    end if;
    insert into public.riwayat (pelaku, email, objek, aksi, teks)
    values (v_nama, v_email, 'anggota', v_aksi,
            case when tg_op = 'DELETE' then old.nama || ' <' || old.email || '>' else new.nama || ' <' || new.email || '>' end);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists riwayat_tasks on public.tasks;
create trigger riwayat_tasks after insert or update or delete on public.tasks
  for each row execute function public.catat_riwayat();
drop trigger if exists riwayat_templates on public.templates;
create trigger riwayat_templates after insert or update or delete on public.templates
  for each row execute function public.catat_riwayat();
drop trigger if exists riwayat_members on public.members;
create trigger riwayat_members after insert or update or delete on public.members
  for each row execute function public.catat_riwayat();

-- Perbaikan: tugas rutin hanya dibuat untuk hari ini (waktu Jakarta), bukan untuk tanggal yang belum tiba
create or replace function public.buat_tugas_rutin(p_tanggal date)
returns integer
language plpgsql security invoker set search_path = public
as $$
declare jumlah integer := 0;
begin
  if p_tanggal <> (now() at time zone 'Asia/Jakarta')::date then return 0; end if;
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
