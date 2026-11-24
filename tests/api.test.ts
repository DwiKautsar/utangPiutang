import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app';
import { createDatabase } from '../server/db';

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
