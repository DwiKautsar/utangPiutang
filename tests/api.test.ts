import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { createDatabase } from '../server/db.js';

function extractCookie(res: Response): string {
  const raw = res.headers.get('set-cookie') || '';
  return raw.split(';')[0] || '';
}

async function jsonRequest(
  app: ReturnType<typeof createApp>['app'],
  path: string,
  options: {
    method?: string;
    cookie?: string;
    body?: unknown;
    includeCsrf?: boolean;
  } = {}
) {
  const headers: Record<string, string> = {};
  if (options.includeCsrf !== false) {
    headers['X-Requested-With'] = 'BukuUtang';
  }
  if (options.cookie) {
    headers['Cookie'] = options.cookie;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  return app.request(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
}

test('Alur lengkap: auth, sinkronisasi piutang multi-user, BOLA/IDOR, CSRF, dan pelunasan 2 arah', async () => {
  const db = createDatabase({ url: ':memory:' });
  const { app } = createApp({ db, enableRateLimit: false });

  try {
    // 1. CSRF guard menolak mutasi tanpa header X-Requested-With
    const csrfBlocked = await jsonRequest(app, '/api/auth/register', {
      method: 'POST',
      includeCsrf: false,
      body: { username: 'user1', displayName: 'Andi', password: 'password123' }
    });
    assert.equal(csrfBlocked.status, 403);

    // 2. Registrasi 3 pengguna (User 1, User 2, User 3)
    const reg1 = await jsonRequest(app, '/api/auth/register', {
      method: 'POST',
      body: { username: 'andi', displayName: 'Andi Pratama', password: 'password123' }
    });
    assert.equal(reg1.status, 201);
    const cookie1 = extractCookie(reg1);
    assert.match(cookie1, /^bukuutang_sid=/);
    const user1 = ((await reg1.json()) as { user: { id: number } }).user;

    const reg2 = await jsonRequest(app, '/api/auth/register', {
      method: 'POST',
      body: { username: 'budi', displayName: 'Budi Santoso', password: 'password123' }
    });
    assert.equal(reg2.status, 201);
    const cookie2 = extractCookie(reg2);
    const user2 = ((await reg2.json()) as { user: { id: number } }).user;

    const reg3 = await jsonRequest(app, '/api/auth/register', {
      method: 'POST',
      body: { username: 'citra', displayName: 'Citra Dewi', password: 'password123' }
    });
    assert.equal(reg3.status, 201);
    const cookie3 = extractCookie(reg3);
    const user3 = ((await reg3.json()) as { user: { id: number } }).user;

    // 3. Username duplikat ditolak (409) & password salah ditolak (401)
    const dupReg = await jsonRequest(app, '/api/auth/register', {
      method: 'POST',
      body: { username: 'ANDI', displayName: 'Duplicate', password: 'password123' }
    });
    assert.equal(dupReg.status, 409);

    const badLogin = await jsonRequest(app, '/api/auth/login', {
      method: 'POST',
      body: { username: 'andi', password: 'wrongpassword' }
    });
    assert.equal(badLogin.status, 401);

    // 4. User 1 mencatat piutang batch ke User 2 (Rp50.000) dan User 3 (Rp75.000)
    const createRes = await jsonRequest(app, '/api/debts', {
      method: 'POST',
      cookie: cookie1,
      body: {
        items: [
          { debtorId: user2.id, amountIdr: 50000, description: 'Patungan makan siang', dueDate: '2026-12-01' },
          { debtorId: user3.id, amountIdr: 75000, description: 'Patungan makan siang + kopi' }
        ]
      }
    });
    assert.equal(createRes.status, 201);
    const createdData = (await createRes.json()) as { items: Array<{ id: number; debtorId: number }> };
    assert.equal(createdData.items.length, 2);

    const debtForUser2 = createdData.items.find((d) => d.debtorId === user2.id)!;
    const debtForUser3 = createdData.items.find((d) => d.debtorId === user3.id)!;

    // 5. User 2 otomatis melihat tagihan Rp50.000 ke User 1
    const user2BillsRes = await jsonRequest(app, '/api/debts?role=debtor&status=all', {
      cookie: cookie2
    });
    assert.equal(user2BillsRes.status, 200);
    const user2Bills = (await user2BillsRes.json()) as {
      summary: { totalPayableIdr: number; netBalanceIdr: number; activeBillCount: number };
      items: Array<{ id: number; creditorId: number; amountIdr: number; status: string }>;
    };
    assert.equal(user2Bills.items.length, 1);
    assert.equal(user2Bills.items[0].creditorId, user1.id);
    assert.equal(user2Bills.items[0].amountIdr, 50000);
    assert.equal(user2Bills.summary.totalPayableIdr, 50000);
    assert.equal(user2Bills.summary.netBalanceIdr, -50000);
    assert.equal(user2Bills.summary.activeBillCount, 1);

    // 6. User 3 otomatis melihat tagihan Rp75.000 ke User 1 (dan tidak melihat tagihan User 2)
    const user3BillsRes = await jsonRequest(app, '/api/debts?role=debtor&status=all', {
      cookie: cookie3
    });
    const user3Bills = (await user3BillsRes.json()) as {
      items: Array<{ id: number; amountIdr: number }>;
    };
    assert.equal(user3Bills.items.length, 1);
    assert.equal(user3Bills.items[0].id, debtForUser3.id);
    assert.equal(user3Bills.items[0].amountIdr, 75000);

    // 7. Uji BOLA/IDOR: User 3 tidak boleh menandai bayar tagihan milik User 2
    const idorPay = await jsonRequest(app, `/api/debts/${debtForUser2.id}/pay`, {
      method: 'PATCH',
      cookie: cookie3,
      body: { paymentNote: 'Hack' }
    });
    assert.equal(idorPay.status, 403);

    // Uji BOLA/BFLA: User 2 tidak boleh langsung melunaskan tagihannya sendiri
    const selfConfirm = await jsonRequest(app, `/api/debts/${debtForUser2.id}/confirm`, {
      method: 'PATCH',
      cookie: cookie2
    });
    assert.equal(selfConfirm.status, 403);

    // 8. Alur pelunasan 2 arah: User 2 tandai bayar -> User 1 konfirmasi lunas
    const payRes = await jsonRequest(app, `/api/debts/${debtForUser2.id}/pay`, {
      method: 'PATCH',
      cookie: cookie2,
      body: { paymentNote: 'Transfer BCA jam 14.00' }
    });
    assert.equal(payRes.status, 200);

    const confirmRes = await jsonRequest(app, `/api/debts/${debtForUser2.id}/confirm`, {
      method: 'PATCH',
      cookie: cookie1
    });
    assert.equal(confirmRes.status, 200);

    // Saldo User 2 kini 0, saldo User 1 tinggal Rp75.000 (dari User 3)
    const afterUser2 = (await (
      await jsonRequest(app, '/api/debts?role=debtor&status=active', { cookie: cookie2 })
    ).json()) as { summary: { totalPayableIdr: number }; items: unknown[] };
    assert.equal(afterUser2.summary.totalPayableIdr, 0);
    assert.equal(afterUser2.items.length, 0);

    const afterUser1 = (await (
      await jsonRequest(app, '/api/debts?role=creditor&status=active', { cookie: cookie1 })
    ).json()) as { summary: { totalReceivableIdr: number } };
    assert.equal(afterUser1.summary.totalReceivableIdr, 75000);

    // 9. Logout menghapus sesi di server
    const logoutRes = await jsonRequest(app, '/api/auth/logout', {
      method: 'POST',
      cookie: cookie1
    });
    assert.equal(logoutRes.status, 200);

    const afterLogoutMe = await jsonRequest(app, '/api/auth/me', { cookie: cookie1 });
    assert.equal(afterLogoutMe.status, 200);
    assert.equal(((await afterLogoutMe.json()) as { user: unknown }).user, null);

    const afterLogoutDebts = await jsonRequest(app, '/api/debts', { cookie: cookie1 });
    assert.equal(afterLogoutDebts.status, 401);
  } finally {
    db.close();
  }
});

test('RBAC Admin: proteksi 403 user biasa, kelola akun, reset password, dan moderasi utang piutang', async () => {
  const db = createDatabase({ url: ':memory:' });
  const { app } = createApp({ db, enableRateLimit: false });

  try {
    // User pertama otomatis jadi admin
    const regAdmin = await jsonRequest(app, '/api/auth/register', {
      method: 'POST',
      body: { username: 'owner', displayName: 'Owner Kas', password: 'password123' }
    });
    assert.equal(regAdmin.status, 201);
    const adminCookie = extractCookie(regAdmin);
    const adminUser = ((await regAdmin.json()) as { user: { id: number; role: string } }).user;
    assert.equal(adminUser.role, 'admin');

    // User kedua otomatis jadi user biasa
    const regUser = await jsonRequest(app, '/api/auth/register', {
      method: 'POST',
      body: { username: 'member', displayName: 'Member Satu', password: 'password123' }
    });
    assert.equal(regUser.status, 201);
    const userCookie = extractCookie(regUser);
    const normalUser = ((await regUser.json()) as { user: { id: number; role: string } }).user;
    assert.equal(normalUser.role, 'user');

    // User biasa ditolak (403) mengakses endpoint admin
    const forbiddenOverview = await jsonRequest(app, '/api/admin/overview', { cookie: userCookie });
    assert.equal(forbiddenOverview.status, 403);

    const forbiddenDelete = await jsonRequest(app, `/api/admin/users/${adminUser.id}`, {
      method: 'DELETE',
      cookie: userCookie
    });
    assert.equal(forbiddenDelete.status, 403);

    // Admin tidak boleh menurunkan role atau menghapus akun sendiri
    const selfDemote = await jsonRequest(app, `/api/admin/users/${adminUser.id}/role`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { role: 'user' }
    });
    assert.equal(selfDemote.status, 400);

    const selfDelete = await jsonRequest(app, `/api/admin/users/${adminUser.id}`, {
      method: 'DELETE',
      cookie: adminCookie
    });
    assert.equal(selfDelete.status, 400);

    // Buat catatan piutang lalu admin ubah status & hapus
    const debtRes = await jsonRequest(app, '/api/debts', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        items: [{ debtorId: normalUser.id, amountIdr: 25000, description: 'Uji moderasi admin' }]
      }
    });
    const debtId = ((await debtRes.json()) as { items: Array<{ id: number }> }).items[0].id;

    const statusUpdate = await jsonRequest(app, `/api/admin/debts/${debtId}/status`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { status: 'paid' }
    });
    assert.equal(statusUpdate.status, 200);

    const delDebt = await jsonRequest(app, `/api/admin/debts/${debtId}`, {
      method: 'DELETE',
      cookie: adminCookie
    });
    assert.equal(delDebt.status, 200);

    // Admin reset password user -> sesi lama user otomatis gugur
    const resetRes = await jsonRequest(app, `/api/admin/users/${normalUser.id}/reset-password`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { newPassword: 'newpassword123' }
    });
    assert.equal(resetRes.status, 200);

    const oldSessionCheck = await jsonRequest(app, '/api/debts', { cookie: userCookie });
    assert.equal(oldSessionCheck.status, 401);

    // Admin hapus akun member
    const delUser = await jsonRequest(app, `/api/admin/users/${normalUser.id}`, {
      method: 'DELETE',
      cookie: adminCookie
    });
    assert.equal(delUser.status, 200);
  } finally {
    db.close();
  }
});

test('Revisi: admin tidak bisa ditagih & catatan piutang/utang manual tanpa akun berfungsi', async () => {
  const db = createDatabase({ url: ':memory:' });
  const { app } = createApp({ db, enableRateLimit: false });

  try {
    // User pertama otomatis admin, user kedua user biasa
    const regAdmin = await jsonRequest(app, '/api/auth/register', {
      method: 'POST',
      body: { username: 'bos_admin', displayName: 'Bos Admin', password: 'password123' }
    });
    const adminUser = ((await regAdmin.json()) as { user: { id: number } }).user;

    const regMember = await jsonRequest(app, '/api/auth/register', {
      method: 'POST',
      body: { username: 'rina', displayName: 'Rina Sari', password: 'password123' }
    });
    const memberCookie = extractCookie(regMember);

    // 1. Admin tidak muncul di GET /api/users untuk ditagih
    const usersRes = await jsonRequest(app, '/api/users', { cookie: memberCookie });
    const usersData = (await usersRes.json()) as { users: Array<{ id: number }> };
    assert.equal(
      usersData.users.some((u) => u.id === adminUser.id),
      false
    );

    // 2. Menagih admin secara langsung lewat API ditolak (400)
    const tagAdminRes = await jsonRequest(app, '/api/debts', {
      method: 'POST',
      cookie: memberCookie,
      body: {
        items: [{ recordType: 'receivable', debtorId: adminUser.id, amountIdr: 10000, description: 'Coba tagih admin' }]
      }
    });
    assert.equal(tagAdminRes.status, 400);

    // 3. Catat piutang manual ke orang tanpa akun
    const manualRecRes = await jsonRequest(app, '/api/debts', {
      method: 'POST',
      cookie: memberCookie,
      body: {
        items: [{ recordType: 'receivable', debtorName: 'Pak Joko Bengkel', amountIdr: 60000, description: 'Pinjam beli oli' }]
      }
    });
    assert.equal(manualRecRes.status, 201);
    const manualRec = ((await manualRecRes.json()) as {
      items: Array<{ id: number; debtorId: number | null; debtorName: string; isManual: boolean }>;
    }).items[0];
    assert.equal(manualRec.debtorId, null);
    assert.equal(manualRec.debtorName, 'Pak Joko Bengkel');
    assert.equal(manualRec.isManual, true);

    // 4. Catat utang manual ke pihak luar tanpa akun & lunaskan sendiri
    const manualPayRes = await jsonRequest(app, '/api/debts', {
      method: 'POST',
      cookie: memberCookie,
      body: {
        items: [{ recordType: 'payable', creditorName: 'Warung Bu Siti', amountIdr: 20000, description: 'Beli galon & telur' }]
      }
    });
    assert.equal(manualPayRes.status, 201);
    const manualPay = ((await manualPayRes.json()) as {
      items: Array<{ id: number; creditorId: number | null; creditorName: string; isManual: boolean }>;
    }).items[0];
    assert.equal(manualPay.creditorId, null);
    assert.equal(manualPay.creditorName, 'Warung Bu Siti');
    assert.equal(manualPay.isManual, true);

    // Pencatat utang manual boleh langsung menandai lunas
    const settleManualPay = await jsonRequest(app, `/api/debts/${manualPay.id}/confirm`, {
      method: 'PATCH',
      cookie: memberCookie
    });
    assert.equal(settleManualPay.status, 200);

    // 5. Catat utang ke akun terdaftar lain -> otomatis muncul di Piutang Saya milik pemberi utang
    const regFriend = await jsonRequest(app, '/api/auth/register', {
      method: 'POST',
      body: { username: 'doni', displayName: 'Doni Saputra', password: 'password123' }
    });
    const friendCookie = extractCookie(regFriend);
    const friendUser = ((await regFriend.json()) as { user: { id: number } }).user;

    const linkedPayRes = await jsonRequest(app, '/api/debts', {
      method: 'POST',
      cookie: memberCookie,
      body: {
        items: [{ recordType: 'payable', creditorId: friendUser.id, amountIdr: 30000, description: 'Pinjam beli bensin' }]
      }
    });
    assert.equal(linkedPayRes.status, 201);

    const friendReceivables = (await (
      await jsonRequest(app, '/api/debts?role=creditor&status=active', { cookie: friendCookie })
    ).json()) as { items: Array<{ amountIdr: number; creditorId: number }> };
    assert.equal(friendReceivables.items.length, 1);
    assert.equal(friendReceivables.items[0].amountIdr, 30000);
    assert.equal(friendReceivables.items[0].creditorId, friendUser.id);
  } finally {
    db.close();
  }
});

test('Arsip Excel 3 bulanan, proteksi CSV formula injection, dan penomoran ulang displayNumber', async () => {
  const db = createDatabase({ url: ':memory:' });
  const { app } = createApp({ db, enableRateLimit: false });

  try {
    const regAdmin = await jsonRequest(app, '/api/auth/register', {
      method: 'POST',
      body: { username: 'admin_arsip', displayName: 'Admin Arsip', password: 'password123' }
    });
    const adminCookie = extractCookie(regAdmin);

    // Buat 3 catatan: #1 (4 bulan lalu, lunas, deskripsi formula injection), #2 (4 bulan lalu, belum lunas), #3 (hari ini)
    const createRes = await jsonRequest(app, '/api/debts', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        items: [
          { recordType: 'receivable', debtorName: 'Pelanggan Lama', amountIdr: 100000, description: '=CMD|calc' },
          { recordType: 'receivable', debtorName: 'Pelanggan Belum Bayar', amountIdr: 50000, description: 'Masih jalan' },
          { recordType: 'receivable', debtorName: 'Pelanggan Baru', amountIdr: 25000, description: 'Transaksi baru' }
        ]
      }
    });
    assert.equal(createRes.status, 201);
    const created = ((await createRes.json()) as { items: Array<{ id: number; displayNumber: number }> }).items;
    assert.deepEqual(
      created.map((i) => i.displayNumber),
      [1, 2, 3]
    );

    // Tandai #1 lunas dan mundurkan tanggal #1 dan #2 menjadi 4 bulan lalu
    await jsonRequest(app, `/api/admin/debts/${created[0].id}/status`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { status: 'paid' }
    });
    await db.execute({
      sql: "UPDATE debts SET created_at = datetime('now', '-4 months') WHERE id IN (?, ?)",
      args: [created[0].id, created[1].id]
    });

    // Preview default (includeUnpaid=0) hanya menghitung 1 catatan (#1 yang sudah lunas > 3 bulan)
    const prevRes = await jsonRequest(app, '/api/admin/archive/preview?months=3&includeUnpaid=0', {
      cookie: adminCookie
    });
    const prevData = (await prevRes.json()) as { preview: { count: number; totalAmountIdr: number } };
    assert.equal(prevData.preview.count, 1);
    assert.equal(prevData.preview.totalAmountIdr, 100000);

    // Export CSV memproteksi formula injection (=CMD|calc -> '=CMD|calc)
    const exportRes = await jsonRequest(app, '/api/admin/archive/export?scope=archive&months=3&includeUnpaid=0', {
      cookie: adminCookie
    });
    assert.equal(exportRes.status, 200);
    const csvText = await exportRes.text();
    assert.ok(csvText.includes('"\'=CMD|calc"'));
    assert.ok(!csvText.includes('"=CMD|calc"'));

    // Purge default hanya menghapus #1, mempertahankan #2 (unpaid) & #3 (baru)
    const purgeRes = await jsonRequest(app, '/api/admin/archive/purge', {
      method: 'POST',
      cookie: adminCookie,
      body: { months: 3, includeUnpaid: false }
    });
    const purgeData = (await purgeRes.json()) as { deletedCount: number };
    assert.equal(purgeData.deletedCount, 1);

    // Sisa 2 catatan otomatis terurut ulang displayNumber menjadi 1 dan 2 (tidak bolong)
    const remainingRes = await jsonRequest(app, '/api/admin/debts?status=all', {
      cookie: adminCookie
    });
    const remaining = ((await remainingRes.json()) as { items: Array<{ displayNumber: number }> }).items;
    assert.equal(remaining.length, 2);
    assert.deepEqual(
      remaining.map((i) => i.displayNumber).sort((a, b) => a - b),
      [1, 2]
    );

    // Uji single-roundtrip /api/admin/bootstrap (overview + analytics 6 bulan + top debtors)
    const adminBootRes = await jsonRequest(app, '/api/admin/bootstrap?status=all&months=3&includeUnpaid=0', {
      cookie: adminCookie
    });
    assert.equal(adminBootRes.status, 200);
    const adminBoot = (await adminBootRes.json()) as {
      analytics: {
        monthlyTrend: Array<{ monthKey: string }>;
        statusBreakdown: { unpaid: { count: number } };
        topActiveDebtors: Array<{ name: string; activeIdr: number }>;
      };
      items: unknown[];
    };
    assert.equal(adminBoot.analytics.monthlyTrend.length, 6);
    assert.equal(adminBoot.analytics.statusBreakdown.unpaid.count, 2);
    assert.equal(adminBoot.analytics.topActiveDebtors[0].activeIdr, 50000);
    assert.equal(adminBoot.items.length, 2);

    // Uji /api/bootstrap untuk sesi admin (mengembalikan user tanpa beban query personal)
    const bootRes = await jsonRequest(app, '/api/bootstrap', { cookie: adminCookie });
    assert.equal(bootRes.status, 200);
    const bootData = (await bootRes.json()) as { user: { role: string } };
    assert.equal(bootData.user.role, 'admin');
  } finally {
    db.close();
  }
});
