/**
 * Basic integration tests — npm test
 * Uses Node built-in test runner (Node ≥ 18) + in-memory SQLite.
 */
'use strict';

process.env.SESSION_SECRET = 'test-secret-ci';
process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const path   = require('node:path');

// ── Patch db require to use in-memory DB ───────────────────────────────────
const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');

const testDb = new Database(':memory:');
testDb.pragma('journal_mode = WAL');
testDb.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    phone TEXT DEFAULT NULL,
    avatar TEXT DEFAULT NULL,
    blocked INTEGER DEFAULT 0,
    role TEXT DEFAULT 'user'
  );
  CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    discount INTEGER DEFAULT 0,
    status INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    description TEXT DEFAULT '',
    composition TEXT DEFAULT '',
    size TEXT DEFAULT '',
    color TEXT DEFAULT '',
    currency TEXT DEFAULT 'TJS',
    tag TEXT DEFAULT '',
    tag_bg TEXT DEFAULT '',
    image1 TEXT DEFAULT '',
    image2 TEXT DEFAULT '',
    image3 TEXT DEFAULT '',
    likes INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    user_id INTEGER,
    status TEXT DEFAULT 'pending_payment',
    recipient_type TEXT DEFAULT 'self',
    name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    comment TEXT DEFAULT '',
    card_text TEXT DEFAULT '',
    schedule TEXT DEFAULT 'now',
    schedule_time TEXT DEFAULT '',
    subtotal REAL NOT NULL DEFAULT 0,
    extras_total REAL NOT NULL DEFAULT 0,
    delivery_fee REAL NOT NULL DEFAULT 10,
    total REAL NOT NULL DEFAULT 0,
    points_earned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER,
    product_name TEXT NOT NULL DEFAULT '',
    product_price REAL NOT NULL DEFAULT 0,
    product_discount INTEGER DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,
    extra_image TEXT DEFAULT NULL
  );
  CREATE TABLE order_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    sender_type TEXT NOT NULL,
    message TEXT,
    image_path TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE order_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    photo_path TEXT NOT NULL,
    caption TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE loyalty_points (
    user_id INTEGER PRIMARY KEY,
    points INTEGER DEFAULT 0,
    lifetime_points INTEGER DEFAULT 0
  );
  CREATE TABLE favorites (user_id INTEGER, product_id INTEGER, PRIMARY KEY(user_id, product_id));
  CREATE TABLE product_translations (
    product_id INTEGER NOT NULL, lang TEXT NOT NULL,
    name TEXT DEFAULT '', description TEXT DEFAULT '', tag TEXT DEFAULT '',
    color TEXT DEFAULT '', composition TEXT DEFAULT '', size TEXT DEFAULT '',
    PRIMARY KEY(product_id, lang)
  );
  CREATE TABLE reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    user_login TEXT NOT NULL,
    rating INTEGER NOT NULL,
    text TEXT NOT NULL,
    photos TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE review_reactions (
    user_id INTEGER NOT NULL, review_id INTEGER NOT NULL, type TEXT NOT NULL,
    PRIMARY KEY(user_id, review_id)
  );
  CREATE TABLE payment_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    receipt_path TEXT NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending',
    admin_notes TEXT DEFAULT '',
    reviewed_at DATETIME,
    reviewed_by TEXT DEFAULT ''
  );
  CREATE TABLE hero_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    slide1_img TEXT DEFAULT '',
    slide2_img TEXT DEFAULT '',
    slide3_img TEXT DEFAULT '',
    slide4_img TEXT DEFAULT '',
    quotes_ru TEXT DEFAULT '[]',
    quotes_en TEXT DEFAULT '[]',
    quotes_tj TEXT DEFAULT '[]'
  );
  CREATE TABLE site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
  CREATE TABLE chat_sessions (id TEXT PRIMARY KEY, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_msg DATETIME DEFAULT CURRENT_TIMESTAMP, unread INTEGER DEFAULT 0, user_name TEXT DEFAULT NULL, guest_num INTEGER DEFAULT NULL);
  CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, dir TEXT NOT NULL, text TEXT, photo TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, read_at DATETIME);
  CREATE TABLE chat_triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, keywords TEXT NOT NULL, reply TEXT NOT NULL, active INTEGER DEFAULT 1);
  CREATE TABLE push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    is_admin INTEGER DEFAULT 0,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

testDb.prepare("INSERT INTO site_settings VALUES ('bank_card_number','4000 0000 0000 0000')").run();
testDb.prepare("INSERT INTO site_settings VALUES ('bank_card_name','Test')").run();
testDb.prepare("INSERT INTO site_settings VALUES ('bank_card_bank','TestBank')").run();
testDb.prepare("INSERT INTO hero_settings (id) VALUES (1)").run();

// Seed one product (price=100, no discount, status=1)
testDb.prepare("INSERT INTO products (name, price, discount, status) VALUES ('Тестовый букет', 100, 0, 1)").run();
const PRODUCT_ID = testDb.prepare('SELECT id FROM products LIMIT 1').get().id;

// Seed admin user upfront
const _adminHash = bcrypt.hashSync('adminpass', 10);
testDb.prepare("INSERT OR IGNORE INTO users (login, password, role) VALUES ('testadmin',?,'admin')").run(_adminHash);

// Intercept require('../database/db') before server.js loads
const Module = require('module');
const _origLoad = Module._load.bind(Module);
Module._load = function(req, parent, isMain) {
  const abs = parent ? path.resolve(path.dirname(parent.filename), req) : '';
  if (req.endsWith('database/db') || abs.endsWith('database\\db') || abs.endsWith('database/db')) {
    return testDb;
  }
  return _origLoad(req, parent, isMain);
};

const app    = require('./server');
const server = http.createServer(app);
let port;

// ── HTTP helper ────────────────────────────────────────────────────────────
function rq(method, urlPath, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method: method.toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(cookie ? { Cookie: cookie } : {})
      }
    };
    const r = http.request(opts, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let json;
        try { json = JSON.parse(raw); } catch { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// Extract Set-Cookie session value
function extractCookie(res) {
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) return null;
  return setCookie.map(c => c.split(';')[0]).join('; ');
}

// ── Lifecycle ──────────────────────────────────────────────────────────────
before(() => new Promise((res, rej) => server.listen(0, '127.0.0.1', () => {
  port = server.address().port;
  res();
})));

after(() => new Promise((res) => server.close(res)));

// ── Tests ──────────────────────────────────────────────────────────────────

test('register — creates new user', async () => {
  const r = await rq('POST', '/register', { body: { login: 'testuser', phone: '+992901234567', password: 'pass1234' } });
  assert.equal(r.status, 200);
  assert.ok(r.body.ok);
});

test('register — duplicate login rejected', async () => {
  const r = await rq('POST', '/register', { body: { login: 'testuser', phone: '+992901234568', password: 'pass1234' } });
  assert.equal(r.status, 409);
});

test('login — correct credentials', async () => {
  const r = await rq('POST', '/login', { body: { login: 'testuser', password: 'pass1234' } });
  assert.equal(r.status, 200);
  assert.ok(r.body.ok);
});

test('login — wrong password', async () => {
  const r = await rq('POST', '/login', { body: { login: 'testuser', password: 'wrong' } });
  assert.equal(r.status, 401);
});

test('login — blocked user rejected', async () => {
  testDb.prepare("UPDATE users SET blocked=1 WHERE login='testuser'").run();
  const r = await rq('POST', '/login', { body: { login: 'testuser', password: 'pass1234' } });
  assert.equal(r.status, 403);
  testDb.prepare("UPDATE users SET blocked=0 WHERE login='testuser'").run();
});

test('GET /api/products — returns product list', async () => {
  const r = await rq('GET', '/api/products');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
  assert.ok(r.body.length >= 1);
  // mapProduct() maps db.name → response.title
  assert.equal(r.body[0].title, 'Тестовый букет');
});

test('POST /api/orders — unauthorized without session', async () => {
  const r = await rq('POST', '/api/orders', {
    body: { name: 'Тест', phone: '+992', address: 'ул. 1', items: [{ product_id: PRODUCT_ID, qty: 1 }] }
  });
  assert.equal(r.status, 401);
});

test('POST /api/orders — creates order with server-side price', async () => {
  // Login to get session
  const login = await rq('POST', '/login', { body: { login: 'testuser', password: 'pass1234' } });
  const cookie = extractCookie(login);
  assert.ok(cookie, 'should have session cookie');

  const r = await rq('POST', '/api/orders', {
    cookie,
    body: {
      name: 'Иван', phone: '+992901234567', address: 'ул. Тест 1',
      items: [{ product_id: PRODUCT_ID, qty: 2 }],
      extras: []
    }
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.order_number);

  // Verify server computed price (100*2 + 10 delivery = 210)
  const order = testDb.prepare('SELECT total, subtotal FROM orders WHERE order_number=?').get(r.body.order_number);
  assert.equal(order.subtotal, 200);
  assert.equal(order.total, 210);

  // Verify order_items uses product.name not product.title
  const items = testDb.prepare('SELECT product_name FROM order_items WHERE order_id=(SELECT id FROM orders WHERE order_number=?)').all(r.body.order_number);
  assert.equal(items[0].product_name, 'Тестовый букет');
});

test('POST /api/orders — rejects manipulated price (server recalculates)', async () => {
  const login = await rq('POST', '/login', { body: { login: 'testuser', password: 'pass1234' } });
  const cookie = extractCookie(login);

  const r = await rq('POST', '/api/orders', {
    cookie,
    body: {
      name: 'Иван', phone: '+992901234567', address: 'ул. Тест 1',
      items: [{ product_id: PRODUCT_ID, qty: 1, price: 1 }], // client tries to set price=1
      extras: []
    }
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const order = testDb.prepare('SELECT total FROM orders WHERE order_number=?').get(r.body.order_number);
  assert.equal(order.total, 110, 'server should use real price 100 + delivery 10, ignoring client price=1');
});

test('GET /api/products/:id — returns single product', async () => {
  const r = await rq('GET', '/api/products/' + PRODUCT_ID);
  assert.equal(r.status, 200);
  assert.equal(r.body.id, PRODUCT_ID);
  assert.equal(r.body.title, 'Тестовый букет');
});

test('GET /api/products/999999 — returns 404', async () => {
  const r = await rq('GET', '/api/products/999999');
  assert.equal(r.status, 404);
});

test('GET /api/me — blocked user session destroyed', async () => {
  const login = await rq('POST', '/login', { body: { login: 'testuser', password: 'pass1234' } });
  const cookie = extractCookie(login);

  testDb.prepare("UPDATE users SET blocked=1 WHERE login='testuser'").run();
  const r = await rq('GET', '/api/me', { cookie });
  testDb.prepare("UPDATE users SET blocked=0 WHERE login='testuser'").run();

  assert.equal(r.status, 200);
  assert.equal(r.body.loggedIn, false, '/api/me should return loggedIn:false for blocked user');
});

test('order chat — user sends message', async () => {
  const login = await rq('POST', '/login', { body: { login: 'testuser', password: 'pass1234' } });
  const cookie = extractCookie(login);

  // Create an order first
  const orderRes = await rq('POST', '/api/orders', {
    cookie,
    body: {
      name: 'Иван', phone: '+992901234567', address: 'ул. Тест 1',
      items: [{ product_id: PRODUCT_ID, qty: 1 }], extras: []
    }
  });
  assert.equal(orderRes.status, 200);
  const orderNum = orderRes.body.order_number;

  // Send message
  const msgRes = await rq('POST', `/api/orders/${orderNum}/messages`, {
    cookie,
    body: { message: 'Здравствуйте, когда доставят?' }
  });
  assert.equal(msgRes.status, 200, JSON.stringify(msgRes.body));
  assert.ok(msgRes.body.ok);
  assert.equal(msgRes.body.message.message, 'Здравствуйте, когда доставят?');
  assert.equal(msgRes.body.message.sender_type, 'user');
});

test('order chat — admin replies', async () => {
  // Get admin cookie
  const adminLogin = await rq('POST', '/login', { body: { login: 'testadmin', password: 'adminpass' } });
  const adminCookie = extractCookie(adminLogin);

  // Find an order with messages
  const order = testDb.prepare("SELECT id FROM orders LIMIT 1").get();
  assert.ok(order);

  const r = await rq('POST', `/api/admin/orders/${order.id}/messages`, {
    cookie: adminCookie,
    body: { message: 'Добрый день! Доставим через час.' }
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.ok);
  assert.equal(r.body.message.sender_type, 'admin');
});

test('order chat — user cannot access other user order', async () => {
  // Register second user
  await rq('POST', '/register', { body: { login: 'testuser2', phone: '+992901234999', password: 'pass5678' } });
  const login2 = await rq('POST', '/login', { body: { login: 'testuser2', password: 'pass5678' } });
  const cookie2 = extractCookie(login2);

  // Get an order belonging to testuser
  const order = testDb.prepare("SELECT order_number FROM orders WHERE user_id=(SELECT id FROM users WHERE login='testuser') LIMIT 1").get();
  if (!order) return; // skip if no orders

  const r = await rq('POST', `/api/orders/${order.order_number}/messages`, {
    cookie: cookie2,
    body: { message: 'Чужой заказ' }
  });
  assert.equal(r.status, 404, 'user2 cannot send to user1 order');
});

test('order chat — GET messages without auth returns 401', async () => {
  const order = testDb.prepare('SELECT order_number FROM orders LIMIT 1').get();
  if (!order) return;
  const r = await rq('GET', `/api/orders/${order.order_number}/messages`);
  assert.equal(r.status, 401);
});

test('receipt upload — unauthorized without session', async () => {
  const http = require('http');
  const order = testDb.prepare('SELECT order_number FROM orders LIMIT 1').get();
  if (!order) return;

  // Multipart with no session should return 401
  const boundary = '----TestBoundary123';
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="receipt"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\nFAKEIMAGEDATA\r\n--${boundary}--\r\n`;

  const opts = {
    hostname: '127.0.0.1', port,
    path: `/api/orders/${order.order_number}/receipt`,
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': Buffer.byteLength(body)
    }
  };
  const statusCode = await new Promise((resolve, reject) => {
    const req = http.request(opts, res => resolve(res.statusCode));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
  assert.equal(statusCode, 401);
});

test('GET /api/admin/products — blocked for regular user', async () => {
  const login = await rq('POST', '/login', { body: { login: 'testuser', password: 'pass1234' } });
  const cookie = extractCookie(login);

  const r = await rq('GET', '/api/admin/products', { cookie });
  assert.equal(r.status, 403);
});

test('GET /api/admin/products — allowed for admin', async () => {
  // Create admin in test DB
  const hash = bcrypt.hashSync('adminpass', 10);
  testDb.prepare("INSERT OR IGNORE INTO users (login, password, role) VALUES ('testadmin','','admin')").run();
  testDb.prepare("UPDATE users SET password=?, role='admin' WHERE login='testadmin'").run(hash);

  const login = await rq('POST', '/login', { body: { login: 'testadmin', password: 'adminpass' } });
  const cookie = extractCookie(login);
  assert.ok(cookie);

  const r = await rq('GET', '/api/admin/products', { cookie });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

test('favorites API — toggle and list for logged-in user', async () => {
  const login = await rq('POST', '/login', { body: { login: 'testuser', password: 'pass1234' } });
  const cookie = extractCookie(login);
  assert.ok(cookie);

  // Add to favorites
  const add = await rq('POST', `/api/favorites/${PRODUCT_ID}`, { cookie });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  assert.equal(add.body.liked, true);

  // List favorites — should include the product
  const list = await rq('GET', '/api/favorites', { cookie });
  assert.equal(list.status, 200);
  assert.ok((list.body.ids || []).includes(PRODUCT_ID));

  // Toggle again to remove
  const remove = await rq('POST', `/api/favorites/${PRODUCT_ID}`, { cookie });
  assert.equal(remove.status, 200);
  assert.equal(remove.body.liked, false);
});

test('GET /api/user/unread-messages — 401 without session', async () => {
  const r = await rq('GET', '/api/user/unread-messages');
  assert.equal(r.status, 401);
  assert.ok(r.body.error);
});

test('GET /api/user/unread-messages — returns count when logged in', async () => {
  const login = await rq('POST', '/login', { body: { login: 'testuser', password: 'pass1234' } });
  const cookie = extractCookie(login);
  assert.ok(cookie);

  const r = await rq('GET', '/api/user/unread-messages', { cookie });
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.count, 'number');
});

test('POST /api/user/change-password — changes password successfully', async () => {
  const login = await rq('POST', '/login', { body: { login: 'testuser', password: 'pass1234' } });
  const cookie = extractCookie(login);
  assert.ok(cookie);

  const change = await rq('POST', '/api/user/change-password', {
    cookie,
    body: { currentPassword: 'pass1234', newPassword: 'newpass5678' }
  });
  assert.equal(change.status, 200, JSON.stringify(change.body));
  assert.ok(change.body.ok);

  // Login with new password must work
  const relogin = await rq('POST', '/login', { body: { login: 'testuser', password: 'newpass5678' } });
  assert.equal(relogin.status, 200);
  assert.ok(relogin.body.ok);

  // Restore original password for other tests
  const cookie2 = extractCookie(relogin);
  await rq('POST', '/api/user/change-password', {
    cookie: cookie2,
    body: { currentPassword: 'newpass5678', newPassword: 'pass1234' }
  });
});

test('POST /api/user/change-password — rejects wrong current password', async () => {
  const login = await rq('POST', '/login', { body: { login: 'testuser', password: 'pass1234' } });
  const cookie = extractCookie(login);
  assert.ok(cookie);

  const r = await rq('POST', '/api/user/change-password', {
    cookie,
    body: { currentPassword: 'wrongpassword', newPassword: 'anything' }
  });
  assert.notEqual(r.status, 200, 'should reject wrong current password');
});

test('POST /api/user/avatar — requires auth', async () => {
  const boundary = '----TestBoundaryAvatar';
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="test.png"\r\nContent-Type: image/png\r\n\r\nFAKEPNGDATA\r\n--${boundary}--\r\n`;

  const opts = {
    hostname: '127.0.0.1', port,
    path: '/api/user/avatar',
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': Buffer.byteLength(body)
    }
  };
  const statusCode = await new Promise((resolve, reject) => {
    const req = http.request(opts, res => resolve(res.statusCode));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
  assert.equal(statusCode, 401, 'avatar upload without session should return 401');
});
