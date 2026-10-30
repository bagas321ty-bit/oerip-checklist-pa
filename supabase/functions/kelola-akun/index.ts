// Fungsi server: admin membuat, mereset kata sandi, dan menghapus akun login karyawan.
// Data anggota (nama, hak akses) ditulis oleh aplikasi sendiri agar tercatat di Riwayat atas nama admin.
// Kunci service_role tersedia otomatis di lingkungan Edge Function Supabase dan tidak pernah dikirim ke browser.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const DOMAIN = "akun.oerip.id"; // username "handayani" -> email login internal "handayani@akun.oerip.id"
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Metode tidak didukung." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // 1) Pastikan pemanggil sudah login dan berperan admin
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user?.email) return json({ error: "Sesi tidak valid. Masuk ulang." }, 401);
  const { data: me } = await admin.from("members").select("peran").ilike("email", who.user.email).maybeSingle();
  if (me?.peran !== "admin") return json({ error: "Hanya admin yang boleh mengelola akun." }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Permintaan tidak valid." }, 400); }
  const action = String(body.action || "");
  const loginId = String(body.username || "").trim().toLowerCase();
  const email = loginId.includes("@") ? loginId : `${loginId}@${DOMAIN}`;
  const password = String(body.password || "");

  if (!/^[a-z0-9._-]{3,32}$/.test(loginId) && !loginId.includes("@")) {
    return json({ error: "Username 3–32 karakter: huruf kecil, angka, titik, garis bawah, atau strip." }, 400);
  }
  if (email.toLowerCase() === who.user.email.toLowerCase() && action === "delete") {
    return json({ error: "Akun Anda sendiri tidak bisa dihapus dari sini." }, 400);
  }

  // Cari akun login berdasarkan email (jumlah pengguna kecil, cukup satu halaman)
  const findUser = async () => {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw error;
    return data.users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase()) || null;
  };

  try {
    if (action === "create") {
      const nama = String(body.nama || "").trim();
      if (password.length < 8) return json({ error: "Kata sandi awal minimal 8 karakter." }, 400);
      if (await findUser()) return json({ error: "Username ini sudah dipakai. Pilih username lain." }, 409);
      const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nama } });
      if (error) return json({ error: "Akun gagal dibuat: " + error.message }, 400);
      return json({ ok: true, email });
    }

    if (action === "reset_password") {
      if (password.length < 8) return json({ error: "Kata sandi baru minimal 8 karakter." }, 400);
      const u = await findUser();
      if (!u) {
        // Anggota lama yang belum punya akun login: buatkan sekarang (langsung aktif)
        const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (error) return json({ error: "Akun gagal dibuat: " + error.message }, 400);
        return json({ ok: true, created: true });
      }
      const { error } = await admin.auth.admin.updateUserById(u.id, { password, email_confirm: true });
      if (error) return json({ error: "Kata sandi gagal direset: " + error.message }, 400);
      return json({ ok: true });
    }

    if (action === "delete") {
      const u = await findUser();
      if (u) {
        const { error } = await admin.auth.admin.deleteUser(u.id);
        if (error) return json({ error: "Akun gagal dihapus: " + error.message }, 400);
      }
      return json({ ok: true });
    }

    return json({ error: "Aksi tidak dikenal." }, 400);
  } catch (e) {
    return json({ error: "Terjadi kesalahan di server: " + (e instanceof Error ? e.message : String(e)) }, 500);
  }
});
