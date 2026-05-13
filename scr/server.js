require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express  = require('express');
const session  = require('express-session');
const bcrypt   = require('bcryptjs');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const webpush  = require('web-push');
const db       = require('../database/db');

// ─── WEB PUSH ───
webpush.setVapidDetails(
  'mailto:admin@gulrez.tj',
  process.env.VAPID_PUBLIC_KEY  || '',
  process.env.VAPID_PRIVATE_KEY || ''
);

function _sendPush(sub, payload) {
  return webpush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    JSON.stringify(payload)
  ).catch(e => {
    if (e.statusCode === 410 || e.statusCode === 404)
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(sub.endpoint);
  });
}
function sendPushToUser(userId, payload) {
  if (!userId) return;
  db.prepare('SELECT * FROM push_subscriptions WHERE user_id=? AND is_admin=0').all(userId)
    .forEach(s => _sendPush(s, payload));
}
function sendPushToAdmins(payload) {
  db.prepare('SELECT * FROM push_subscriptions WHERE is_admin=1').all()
    .forEach(s => _sendPush(s, payload));
}

const app  = express();
const PORT = 3001;

// ─── PATHS ───
const ROOT       = path.join(__dirname, '..');           // project root
const PUBLIC     = path.join(ROOT, 'public');            // /public
const imagesDir       = path.join(ROOT, 'images');
const avatarsDir      = path.join(ROOT, 'avatars');
const reviewPhotosDir = path.join(ROOT, 'review-photos');
const chatImagesDir   = path.join(ROOT, 'chat-images');    // order chat images
const orderPhotosDir  = path.join(ROOT, 'order-photos');   // admin progress photos

if (!fs.existsSync(imagesDir))       fs.mkdirSync(imagesDir);
if (!fs.existsSync(avatarsDir))      fs.mkdirSync(avatarsDir);
if (!fs.existsSync(reviewPhotosDir)) fs.mkdirSync(reviewPhotosDir);
if (!fs.existsSync(chatImagesDir))   fs.mkdirSync(chatImagesDir);
if (!fs.existsSync(orderPhotosDir))  fs.mkdirSync(orderPhotosDir);

// ─── MIDDLEWARE ───
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Cookie parser (inline, no extra package needed)
app.use((req, _res, next) => {
  req.cookies = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k && k.trim()) req.cookies[k.trim()] = decodeURIComponent(v.join('='));
  });
  next();
});
app.use(session({
  secret: process.env.SESSION_SECRET || 'gulrez-secret-fallback',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

// Static files
app.use(express.static(PUBLIC));
app.use('/images',        express.static(imagesDir));
app.use('/avatars',       express.static(avatarsDir));
app.use('/review-photos', express.static(reviewPhotosDir));
app.use('/chat-images',   express.static(chatImagesDir));
app.use('/order-photos',  express.static(orderPhotosDir));
app.use('/icons',         express.static(path.join(ROOT, 'icons')));

// ─── MULTER (image upload → /images/) ───
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, imagesDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Только изображения'));
  }
});

// ─── MULTER (avatar upload → /avatars/) ───
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, avatarsDir),
    filename:    (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `av_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`);
    }
  }),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Только изображения'));
  }
});

// ─── MULTER (review photos → /review-photos/) ───
const reviewPhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, reviewPhotosDir),
    filename:    (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `rv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Только изображения'));
  }
});

// ─── MULTER (order progress photos) ───
const orderPhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, orderPhotosDir),
    filename:    (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `op_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`);
    }
  }),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Только изображения'));
  }
});

// ─── MULTER (order chat images → /chat-images/) ───
const chatImageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, chatImagesDir),
    filename:    (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `ci_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Только изображения'));
  }
});

// ─── SSE CLIENTS (Live order tracking) ───
// orderSseClients: Map<orderNumber, Set<res>>
const orderSseClients = new Map();

function notifyOrderStatus(orderNumber, status) {
  const clients = orderSseClients.get(String(orderNumber));
  if (!clients || clients.size === 0) return;
  const payload = JSON.stringify({ status, ts: Date.now() });
  clients.forEach(client => {
    try { client.write(`data: ${payload}\n\n`); } catch (_) {}
  });
}

// ─── AUTH GUARD ───
function requireAdmin(req, res, next) {
  if (req.session && req.session.userId && req.session.role === 'admin') return next();
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  res.status(403).json({ error: 'Forbidden' });
}

// ══════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════

// POST /register
app.post('/register', (req, res) => {
  const { login, phone, password } = req.body;
  if (!login || !phone || !password)
    return res.status(400).json({ error: 'Заполните все поля' });

  const digits = phone.replace(/\D/g, '');
  const fullPhone = digits.startsWith('992') ? '+' + digits : '+992' + digits.slice(-9);
  if (digits.length < 9)
    return res.status(400).json({ error: 'Введите 9 цифр номера телефона' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Пароль — минимум 6 символов' });
  if (db.prepare('SELECT id FROM users WHERE login = ?').get(login))
    return res.status(409).json({ error: 'Этот логин уже занят' });
  if (db.prepare('SELECT id FROM users WHERE phone = ?').get(fullPhone))
    return res.status(409).json({ error: 'Этот номер телефона уже зарегистрирован' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (login, phone, password, role) VALUES (?,?,?,?)').run(login, fullPhone, hash, 'user');

  req.session.userId = result.lastInsertRowid;
  req.session.login  = login;
  req.session.phone  = fullPhone;
  req.session.role   = 'user';
  res.json({ ok: true, login, role: 'user' });
});

// POST /login — by login or phone
app.post('/login', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password)
    return res.status(400).json({ error: 'Введите логин и пароль' });

  // Normalise: if looks like a phone number, format it
  const digits = login.replace(/\D/g, '');
  const asPhone = digits.length >= 9 ? '+992' + digits.slice(-9) : null;

  const user = db.prepare('SELECT * FROM users WHERE login = ? OR (phone IS NOT NULL AND phone = ?)').get(login, asPhone || '');
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  if (user.blocked)
    return res.status(403).json({ error: 'Ваш аккаунт заблокирован' });

  req.session.userId = user.id;
  req.session.login  = user.login;
  req.session.phone  = user.phone || '';
  req.session.role   = user.role;

  return res.json({ ok: true, login: user.login, role: user.role });
});

// POST /logout
app.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// GET /api/me
app.get('/api/me', (req, res) => {
  if (req.session && req.session.userId) {
    const user = db.prepare('SELECT avatar, blocked FROM users WHERE id = ?').get(req.session.userId);
    if (!user || user.blocked) {
      req.session.destroy(() => {});
      return res.json({ loggedIn: false });
    }
    return res.json({
      loggedIn: true,
      login:  req.session.login,
      phone:  req.session.phone || '',
      role:   req.session.role,
      avatar: user.avatar || null
    });
  }
  res.json({ loggedIn: false });
});

// POST /api/user/change-password
app.post('/api/user/change-password', (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Не авторизован' });
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Заполните все поля' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Минимум 6 символов' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(currentPassword, user.password))
    return res.status(401).json({ error: 'Неверный текущий пароль' });
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.session.userId);
  res.json({ ok: true });
});

// POST /api/user/avatar — upload avatar (any logged-in user)
app.post('/api/user/avatar', avatarUpload.single('avatar'), (req, res) => {
  if (!req.session || !req.session.userId)
    return res.status(401).json({ error: 'Не авторизован' });
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });

  // Delete old avatar file if it was user-uploaded
  const existing = db.prepare('SELECT avatar FROM users WHERE id = ?').get(req.session.userId);
  if (existing && existing.avatar && existing.avatar.startsWith('avatars/av_')) {
    const oldPath = path.join(ROOT, existing.avatar);
    if (fs.existsSync(oldPath)) { try { fs.unlinkSync(oldPath); } catch (_) {} }
  }

  const avatarUrl = `avatars/${req.file.filename}`;
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatarUrl, req.session.userId);
  res.json({ ok: true, avatar: avatarUrl });
});

// DELETE /api/user/avatar — remove avatar
app.delete('/api/user/avatar', (req, res) => {
  if (!req.session || !req.session.userId)
    return res.status(401).json({ error: 'Не авторизован' });
  const existing = db.prepare('SELECT avatar FROM users WHERE id = ?').get(req.session.userId);
  if (existing && existing.avatar && existing.avatar.startsWith('avatars/av_')) {
    const oldPath = path.join(ROOT, existing.avatar);
    if (fs.existsSync(oldPath)) { try { fs.unlinkSync(oldPath); } catch (_) {} }
  }
  db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(req.session.userId);
  res.json({ ok: true });
});

// GET /catalog — public catalog page
app.get('/catalog', (req, res) => {
  res.sendFile(path.join(PUBLIC, 'catalog.html'));
});

// GET /product/:id — public product detail page
app.get('/product/:id', (req, res) => {
  res.sendFile(path.join(PUBLIC, 'product.html'));
});

// GET /user — user profile page
app.get('/user', (req, res) => {
  if (!req.session || !req.session.userId) return res.redirect('/login.html');
  res.sendFile(path.join(PUBLIC, 'user.html'));
});

// ══════════════════════════════════════════
//  PUBLIC PRODUCTS API
// ══════════════════════════════════════════

const TRANS_JOIN = `
  LEFT JOIN product_translations t_en ON t_en.product_id = p.id AND t_en.lang = 'EN'
  LEFT JOIN product_translations t_tj ON t_tj.product_id = p.id AND t_tj.lang = 'TJ'
`;
const TRANS_COLS = `,
  t_en.name as en_name, t_en.description as en_desc, t_en.tag as en_tag,
  t_en.color as en_color, t_en.composition as en_composition, t_en.size as en_size,
  t_tj.name as tj_name, t_tj.description as tj_desc, t_tj.tag as tj_tag,
  t_tj.color as tj_color, t_tj.composition as tj_composition, t_tj.size as tj_size
`;

// Public: always only active products
app.get('/api/products', (req, res) => {
  const rows = db.prepare(`SELECT p.*${TRANS_COLS} FROM products p ${TRANS_JOIN} WHERE p.status = 1 ORDER BY p.sort_order ASC, p.id ASC`).all();
  res.json(rows.map(mapProduct));
});

// Public: single product by id
app.get('/api/products/:id', (req, res) => {
  const row = db.prepare(`SELECT p.*${TRANS_COLS} FROM products p ${TRANS_JOIN} WHERE p.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Не найден' });
  res.json(mapProduct(row));
});

// Admin: all products including inactive
app.get('/api/admin/products', requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT p.*${TRANS_COLS} FROM products p ${TRANS_JOIN} ORDER BY p.sort_order ASC, p.id ASC`).all();
  res.json(rows.map(mapProduct));
});

// ══════════════════════════════════════════
//  ADMIN PRODUCTS API
// ══════════════════════════════════════════

// Create product
app.post('/api/admin/products', requireAdmin, (req, res) => {
  const f = req.body;
  const result = db.prepare(`
    INSERT INTO products
      (sort_order, name, description, composition, size, color, price, currency, discount, status, tag, tag_bg, image1, image2, image3, likes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    num(f.sort_order, 0), str(f.name), str(f.description),
    str(f.composition), str(f.size), str(f.color),
    flt(f.price, 0), str(f.currency, 'TJS'),
    num(f.discount, 0), num(f.status, 1),
    str(f.tag), str(f.tag_bg, 'var(--rose)'),
    str(f.image1), str(f.image2), str(f.image3),
    num(f.likes, 0)
  );
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
  res.json(mapProduct(product));
});

// Update product
app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const ex = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!ex) return res.status(404).json({ error: 'Товар не найден' });

  const f = req.body;
  db.prepare(`
    UPDATE products SET
      sort_order=?, name=?, description=?, composition=?, size=?, color=?,
      price=?, currency=?, discount=?, status=?, tag=?, tag_bg=?,
      image1=?, image2=?, image3=?, likes=?
    WHERE id=?
  `).run(
    f.sort_order !== undefined ? num(f.sort_order) : ex.sort_order,
    f.name        !== undefined ? str(f.name)        : ex.name,
    f.description !== undefined ? str(f.description) : ex.description,
    f.composition !== undefined ? str(f.composition) : ex.composition,
    f.size        !== undefined ? str(f.size)        : ex.size,
    f.color       !== undefined ? str(f.color)       : ex.color,
    f.price       !== undefined ? flt(f.price)       : ex.price,
    f.currency    !== undefined ? str(f.currency)    : ex.currency,
    f.discount    !== undefined ? num(f.discount)    : ex.discount,
    f.status      !== undefined ? num(f.status)      : ex.status,
    f.tag         !== undefined ? str(f.tag)         : ex.tag,
    f.tag_bg      !== undefined ? str(f.tag_bg)      : ex.tag_bg,
    f.image1      !== undefined ? str(f.image1)      : ex.image1,
    f.image2      !== undefined ? str(f.image2)      : ex.image2,
    f.image3      !== undefined ? str(f.image3)      : ex.image3,
    f.likes       !== undefined ? num(f.likes)       : ex.likes,
    id
  );
  res.json(mapProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(id)));
});

// Delete product
app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  if (!db.prepare('SELECT id FROM products WHERE id = ?').get(id))
    return res.status(404).json({ error: 'Товар не найден' });
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Toggle status (active ↔ inactive)
app.post('/api/admin/products/:id/toggle', requireAdmin, (req, res) => {
  const { id } = req.params;
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) return res.status(404).json({ error: 'Не найдено' });
  const newStatus = product.status === 1 ? 0 : 1;
  db.prepare('UPDATE products SET status = ? WHERE id = ?').run(newStatus, id);
  res.json({ ok: true, status: newStatus });
});

// GET translations for one product
app.get('/api/admin/products/:id/translations', requireAdmin, (req, res) => {
  const { id } = req.params;
  const rows = db.prepare('SELECT lang, name, description, tag, color, composition, size FROM product_translations WHERE product_id = ?').all(id);
  const result = {};
  rows.forEach(r => {
    result[r.lang] = { title: r.name || '', desc: r.description || '', tag: r.tag || '', color: r.color || '', composition: r.composition || '', size: r.size || '' };
  });
  res.json(result);
});

// PUT translations for one product (upsert EN + TJ)
app.put('/api/admin/products/:id/translations', requireAdmin, (req, res) => {
  const { id } = req.params;
  if (!db.prepare('SELECT id FROM products WHERE id = ?').get(id))
    return res.status(404).json({ error: 'Товар не найден' });

  const upsert = db.prepare(`
    INSERT INTO product_translations (product_id, lang, name, description, tag, color, composition, size)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(product_id, lang) DO UPDATE SET
      name        = excluded.name,
      description = excluded.description,
      tag         = excluded.tag,
      color       = excluded.color,
      composition = excluded.composition,
      size        = excluded.size
  `);

  const save = db.transaction(() => {
    ['EN', 'TJ'].forEach(lang => {
      const t = req.body[lang];
      if (!t) return;
      upsert.run(id, lang, str(t.title), str(t.desc), str(t.tag), str(t.color), str(t.composition), str(t.size));
    });
  });
  save();
  res.json({ ok: true });
});

// Upload image
app.post('/api/admin/upload', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  res.json({ url: `images/${req.file.filename}` });
});

// ─── MEDIA LIBRARY ───

// Uploaded files have the img_TIMESTAMP_RAND pattern — only those can be deleted
function isUploaded(filename) { return /^img_\d+_[a-z0-9]+\./i.test(filename); }

// GET /api/admin/media — list all images with usage & size info
app.get('/api/admin/media', requireAdmin, (req, res) => {
  const products = db.prepare('SELECT id, name, image1, image2, image3 FROM products').all();

  // Build map: imageUrl → [product names]
  const usedMap = {};
  products.forEach(p => {
    [p.image1, p.image2, p.image3].forEach(url => {
      if (!url) return;
      if (!usedMap[url]) usedMap[url] = [];
      usedMap[url].push(p.name);
    });
  });

  const files = [];
  try {
    fs.readdirSync(imagesDir).forEach(filename => {
      if (!isUploaded(filename)) return; // show only admin-uploaded files
      const filepath = path.join(imagesDir, filename);
      const stat = fs.statSync(filepath);
      if (!stat.isFile()) return;
      const url = `images/${filename}`;
      files.push({
        filename, url,
        size: stat.size,
        date: stat.mtime.toISOString(),
        usedBy: usedMap[url] || [],
        canDelete: true
      });
    });
  } catch (_) {}

  res.json(files);
});

// DELETE /api/admin/media/unused — delete all unused uploaded files (must be before :filename)
app.delete('/api/admin/media/unused', requireAdmin, (req, res) => {
  const products = db.prepare('SELECT image1, image2, image3 FROM products').all();
  const usedUrls = new Set();
  products.forEach(p => {
    [p.image1, p.image2, p.image3].forEach(url => { if (url) usedUrls.add(url); });
  });

  let deleted = 0;
  try {
    fs.readdirSync(imagesDir).forEach(filename => {
      if (!isUploaded(filename)) return; // never delete static files
      const url = `images/${filename}`;
      if (!usedUrls.has(url)) {
        const filepath = path.join(imagesDir, filename);
        if (fs.statSync(filepath).isFile()) { fs.unlinkSync(filepath); deleted++; }
      }
    });
  } catch (_) {}
  res.json({ ok: true, deleted });
});

// DELETE /api/admin/media/:filename — delete a single uploaded file
app.delete('/api/admin/media/:filename', requireAdmin, (req, res) => {
  const { filename } = req.params;
  if (!filename || filename.includes('/') || filename.includes('..') || !isUploaded(filename))
    return res.status(400).json({ error: 'Недопустимый файл' });
  const filepath = path.join(imagesDir, filename);
  if (!fs.existsSync(filepath))
    return res.status(404).json({ error: 'Файл не найден' });
  fs.unlinkSync(filepath);
  res.json({ ok: true });
});

// ─── STATS (dashboard) ───
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const total    = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  const active   = db.prepare('SELECT COUNT(*) as c FROM products WHERE status=1').get().c;
  const inactive = db.prepare('SELECT COUNT(*) as c FROM products WHERE status=0').get().c;
  const users    = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  res.json({ total, active, inactive, users });
});

// ─── USERS ───
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT id, login, role, blocked, created_at FROM users ORDER BY id ASC').all();
  res.json(rows);
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { login, password, role } = req.body;
  if (!login || !password) return res.status(400).json({ error: 'Введите логин и пароль' });
  if (db.prepare('SELECT id FROM users WHERE login=?').get(login))
    return res.status(409).json({ error: 'Логин уже занят' });
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (login, password, role) VALUES (?,?,?)').run(login, hash, role || 'admin');
  res.json({ id: result.lastInsertRowid, login, role: role || 'admin' });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.session.userId)
    return res.status(400).json({ error: 'Нельзя удалить самого себя' });
  if (!db.prepare('SELECT id FROM users WHERE id=?').get(id))
    return res.status(404).json({ error: 'Пользователь не найден' });
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  res.json({ ok: true });
});

app.put('/api/admin/users/:id/block', requireAdmin, (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.session.userId)
    return res.status(400).json({ error: 'Нельзя заблокировать самого себя' });
  const user = db.prepare('SELECT id, blocked FROM users WHERE id=?').get(id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const newBlocked = user.blocked ? 0 : 1;
  db.prepare('UPDATE users SET blocked=? WHERE id=?').run(newBlocked, id);
  res.json({ ok: true, blocked: newBlocked });
});

// ─── CHANGE PASSWORD ───
app.post('/api/admin/change-password', requireAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Заполните все поля' });
  if (newPassword.length < 4) return res.status(400).json({ error: 'Минимум 4 символа' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
  if (!bcrypt.compareSync(currentPassword, user.password))
    return res.status(401).json({ error: 'Неверный текущий пароль' });
  db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(newPassword, 10), req.session.userId);
  res.json({ ok: true });
});

// ─── ADMIN PAGE ───
app.get('/admin', (req, res) => {
  if (!req.session || !req.session.userId) return res.redirect('/login.html');
  if (req.session.role !== 'admin') return res.redirect('/user');
  res.sendFile(path.join(PUBLIC, 'admin.html'));
});

// ══════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════

function str(v, def = '') { return v !== undefined && v !== null ? String(v) : def; }
function num(v, def = 0)  { const n = parseInt(v); return isNaN(n) ? def : n; }
function flt(v, def = 0)  { const n = parseFloat(v); return isNaN(n) ? def : n; }

const SVG_COMPOSITION = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>';
const SVG_SIZE        = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
const SVG_COLOR       = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>';
const SVG_FRESH       = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>';

function mapProduct(row) {
  const images = [row.image1, row.image2, row.image3].filter(Boolean);
  if (!images.length) images.push('images/1.jpg');

  // EN / TJ translation overrides (empty string means "fall back to RU")
  const translations = {};
  if (row.en_name !== undefined) {
    translations.EN = {
      title:       row.en_name        || '',
      desc:        row.en_desc        || '',
      tag:         row.en_tag         || '',
      color:       row.en_color       || '',
      composition: row.en_composition || '',
      size:        row.en_size        || ''
    };
  }
  if (row.tj_name !== undefined) {
    translations.TJ = {
      title:       row.tj_name        || '',
      desc:        row.tj_desc        || '',
      tag:         row.tj_tag         || '',
      color:       row.tj_color       || '',
      composition: row.tj_composition || '',
      size:        row.tj_size        || ''
    };
  }

  return {
    id:          row.id,
    sort_order:  row.sort_order,
    status:      row.status,
    tag:         row.tag    || '',
    tagBg:       row.tag_bg || 'var(--rose)',
    title:       row.name,
    desc:        row.description || '',
    price:       row.price,
    currency:    row.currency || 'TJS',
    discount:    row.discount  || 0,
    likes:       row.likes     || 0,
    images,
    composition: row.composition || '',
    size:        row.size        || '',
    color:       row.color       || '',
    translations,
    info: [
      { icon: SVG_COMPOSITION, label: 'Состав',   value: row.composition || '—' },
      { icon: SVG_SIZE,        label: 'Размер',   value: row.size        || '—' },
      { icon: SVG_COLOR,       label: 'Цвет',     value: row.color       || '—' },
      { icon: SVG_FRESH,       label: 'Свежесть', value: '7+ дней'              }
    ]
  };
}

// ══════════════════════════════════════════
//  REVIEWS API
// ══════════════════════════════════════════

// GET /api/reviews — public
app.get('/api/reviews', (req, res) => {
  const userId = req.session && req.session.userId ? req.session.userId : null;
  const rows = db.prepare(`
    SELECT r.*,
      u.avatar AS user_avatar,
      (SELECT COUNT(*) FROM review_reactions rr WHERE rr.review_id = r.id AND rr.type = 'like')    AS likes,
      (SELECT COUNT(*) FROM review_reactions rr WHERE rr.review_id = r.id AND rr.type = 'dislike') AS dislikes
    FROM reviews r
    LEFT JOIN users u ON u.id = r.user_id
    ORDER BY r.created_at DESC
  `).all();

  const myReactions = userId
    ? db.prepare('SELECT review_id, type FROM review_reactions WHERE user_id = ?').all(userId)
    : [];
  const myMap = {};
  myReactions.forEach(r => { myMap[r.review_id] = r.type; });

  const stats = db.prepare('SELECT AVG(rating) AS avg, COUNT(*) AS total FROM reviews').get();

  res.json({
    reviews: rows.map(r => ({
      ...r,
      photos: (() => { try { return JSON.parse(r.photos || '[]'); } catch { return []; } })(),
      myReaction: myMap[r.id] || null
    })),
    stats: { avg: stats.avg ? Math.round(stats.avg * 10) / 10 : 0, total: stats.total }
  });
});

// POST /api/reviews — auth required (multipart/form-data)
app.post('/api/reviews', reviewPhotoUpload.array('photos', 3), (req, res) => {
  if (!req.session || !req.session.userId)
    return res.status(401).json({ error: 'Войдите в аккаунт, чтобы оставить отзыв' });
  const { rating, text } = req.body;
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Оценка от 1 до 5' });
  if (!text || !text.trim()) return res.status(400).json({ error: 'Напишите текст отзыва' });
  if (text.trim().length > 800) return res.status(400).json({ error: 'Не более 800 символов' });

  const photos = (req.files || []).map(f => `review-photos/${f.filename}`);

  const result = db.prepare(
    'INSERT INTO reviews (user_id, user_login, rating, text, photos) VALUES (?,?,?,?,?)'
  ).run(req.session.userId, req.session.login, num(rating), text.trim(), JSON.stringify(photos));

  const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(result.lastInsertRowid);
  res.json({ ...review, photos, likes: 0, dislikes: 0, myReaction: null });
});

// POST /api/reviews/:id/react — auth required
app.post('/api/reviews/:id/react', (req, res) => {
  if (!req.session || !req.session.userId)
    return res.status(401).json({ error: 'Нужна авторизация' });
  const reviewId = parseInt(req.params.id);
  const { type } = req.body; // 'like' | 'dislike'
  if (!['like','dislike'].includes(type)) return res.status(400).json({ error: 'Неверный тип' });
  if (!db.prepare('SELECT id FROM reviews WHERE id = ?').get(reviewId))
    return res.status(404).json({ error: 'Отзыв не найден' });

  const userId = req.session.userId;
  const existing = db.prepare('SELECT type FROM review_reactions WHERE user_id=? AND review_id=?').get(userId, reviewId);

  if (existing && existing.type === type) {
    // Remove reaction (toggle off)
    db.prepare('DELETE FROM review_reactions WHERE user_id=? AND review_id=?').run(userId, reviewId);
  } else {
    // Insert or replace
    db.prepare('INSERT OR REPLACE INTO review_reactions (user_id, review_id, type) VALUES (?,?,?)').run(userId, reviewId, type);
  }

  const likes    = db.prepare("SELECT COUNT(*) AS c FROM review_reactions WHERE review_id=? AND type='like'").get(reviewId).c;
  const dislikes = db.prepare("SELECT COUNT(*) AS c FROM review_reactions WHERE review_id=? AND type='dislike'").get(reviewId).c;
  const myNew    = db.prepare('SELECT type FROM review_reactions WHERE user_id=? AND review_id=?').get(userId, reviewId);
  res.json({ likes, dislikes, myReaction: myNew ? myNew.type : null });
});

// DELETE /api/admin/reviews/:id — admin only
app.delete('/api/admin/reviews/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  if (!db.prepare('SELECT id FROM reviews WHERE id=?').get(id))
    return res.status(404).json({ error: 'Отзыв не найден' });
  db.prepare('DELETE FROM review_reactions WHERE review_id=?').run(id);
  db.prepare('DELETE FROM reviews WHERE id=?').run(id);
  res.json({ ok: true });
});

// ══════════════════════════════════════════
//  HERO SETTINGS API
// ══════════════════════════════════════════

// GET /api/hero — public, returns hero images + quotes + per-slide CTA
app.get('/api/hero', (req, res) => {
  const row = db.prepare('SELECT * FROM hero_settings WHERE id = 1').get();
  if (!row) return res.json(null);
  const parseSafe = (v, def) => { try { return JSON.parse(v || 'null') || def; } catch { return def; } };
  res.json({
    images: [row.slide1_img, row.slide2_img, row.slide3_img, row.slide4_img],
    quotes: {
      RU: parseSafe(row.quotes_ru, ['','','','']),
      EN: parseSafe(row.quotes_en, ['','','','']),
      TJ: parseSafe(row.quotes_tj, ['','','',''])
    },
    cta_texts: parseSafe(row.cta_texts, ['','','','']),
    cta_urls:  parseSafe(row.cta_urls,  ['','','',''])
  });
});

// PUT /api/admin/hero — admin only, save hero settings
app.put('/api/admin/hero', requireAdmin, (req, res) => {
  const { images, quotes, cta_texts, cta_urls } = req.body;
  if (!images || !Array.isArray(images) || images.length !== 4)
    return res.status(400).json({ error: 'Нужно 4 изображения' });
  if (!quotes || !quotes.RU || !quotes.EN || !quotes.TJ)
    return res.status(400).json({ error: 'Нужны цитаты на трёх языках' });

  const qRU = Array.isArray(quotes.RU) ? quotes.RU : JSON.parse(quotes.RU);
  const qEN = Array.isArray(quotes.EN) ? quotes.EN : JSON.parse(quotes.EN);
  const qTJ = Array.isArray(quotes.TJ) ? quotes.TJ : JSON.parse(quotes.TJ);
  const ctaT = Array.isArray(cta_texts) ? cta_texts : ['','','',''];
  const ctaU = Array.isArray(cta_urls)  ? cta_urls  : ['','','',''];

  db.prepare(`
    INSERT INTO hero_settings (id, slide1_img, slide2_img, slide3_img, slide4_img, quotes_ru, quotes_en, quotes_tj, cta_texts, cta_urls)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      slide1_img = excluded.slide1_img,
      slide2_img = excluded.slide2_img,
      slide3_img = excluded.slide3_img,
      slide4_img = excluded.slide4_img,
      quotes_ru  = excluded.quotes_ru,
      quotes_en  = excluded.quotes_en,
      quotes_tj  = excluded.quotes_tj,
      cta_texts  = excluded.cta_texts,
      cta_urls   = excluded.cta_urls
  `).run(
    str(images[0]), str(images[1]), str(images[2]), str(images[3]),
    JSON.stringify(qRU), JSON.stringify(qEN), JSON.stringify(qTJ),
    JSON.stringify(ctaT), JSON.stringify(ctaU)
  );
  res.json({ ok: true });
});

// ══════════════════════════════════════════
//  FAVORITES API
// ══════════════════════════════════════════

// GET /api/favorites — returns product IDs favorited by the logged-in user
app.get('/api/favorites', (req, res) => {
  if (!req.session || !req.session.userId) return res.json({ ids: [] });
  const rows = db.prepare('SELECT product_id FROM favorites WHERE user_id = ?').all(req.session.userId);
  res.json({ ids: rows.map(r => r.product_id) });
});

// POST /api/favorites/:productId — toggle favorite, return new state + live count
app.post('/api/favorites/:productId', (req, res) => {
  if (!req.session || !req.session.userId)
    return res.status(401).json({ error: 'Войдите в аккаунт, чтобы добавить в избранное' });

  const userId    = req.session.userId;
  const productId = parseInt(req.params.productId);
  if (!db.prepare('SELECT id FROM products WHERE id = ?').get(productId))
    return res.status(404).json({ error: 'Товар не найден' });

  const exists = db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND product_id = ?').get(userId, productId);

  if (exists) {
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND product_id = ?').run(userId, productId);
    db.prepare('UPDATE products SET likes = MAX(0, likes - 1) WHERE id = ?').run(productId);
  } else {
    db.prepare('INSERT OR IGNORE INTO favorites (user_id, product_id) VALUES (?, ?)').run(userId, productId);
    db.prepare('UPDATE products SET likes = likes + 1 WHERE id = ?').run(productId);
  }

  const product = db.prepare('SELECT likes FROM products WHERE id = ?').get(productId);
  res.json({ liked: !exists, likes: product.likes });
});

// ══════════════════════════════════════════
//  CHAT API
// ══════════════════════════════════════════


// GET /api/site-settings — public read for hero CTA
app.get('/api/site-settings', (req, res) => {
  const rows = db.prepare("SELECT key, value FROM site_settings WHERE key IN ('hero_cta_text','hero_cta_url')").all();
  const obj = {};
  rows.forEach(r => { obj[r.key] = r.value; });
  res.json(obj);
});

// GET /api/admin/site-settings — get all settings
app.get('/api/admin/site-settings', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM site_settings').all();
  const obj = {};
  rows.forEach(r => { obj[r.key] = r.value; });
  res.json(obj);
});

// POST /api/admin/site-settings — save settings
app.post('/api/admin/site-settings', requireAdmin, (req, res) => {
  const upsert = db.prepare("INSERT INTO site_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const save = db.transaction(data => {
    for (const [k, v] of Object.entries(data)) upsert.run(k, String(v));
  });
  save(req.body);
  res.json({ ok: true });
});

// ══════════════════════════════════════════
//  WEB PUSH API
// ══════════════════════════════════════════

// GET /api/push/vapid-key — public key for client subscription
app.get('/api/push/vapid-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || '' });
});

// POST /api/push/subscribe — save push subscription
app.post('/api/push/subscribe', (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth)
    return res.status(400).json({ error: 'Invalid subscription' });
  const userId  = req.session?.userId || null;
  const isAdmin = req.session?.role === 'admin' ? 1 : 0;
  db.prepare(`INSERT INTO push_subscriptions (user_id,is_admin,endpoint,p256dh,auth)
    VALUES (?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, is_admin=excluded.is_admin`)
    .run(userId, isAdmin, endpoint, keys.p256dh, keys.auth);
  res.json({ ok: true });
});

// DELETE /api/push/unsubscribe — remove subscription
app.delete('/api/push/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(endpoint);
  res.json({ ok: true });
});

// GET /api/admin/bell — recent events for bell dropdown
app.get('/api/admin/bell', requireAdmin, (req, res) => {
  const limit = 20;
  const orders  = db.prepare(`SELECT id, order_number, name, status, created_at FROM orders ORDER BY created_at DESC LIMIT ?`).all(limit);
  const receipts = db.prepare(`SELECT pr.uploaded_at, o.order_number FROM payment_receipts pr JOIN orders o ON o.id=pr.order_id WHERE pr.status='pending' ORDER BY pr.uploaded_at DESC LIMIT ?`).all(10);
  const msgs = db.prepare(`SELECT om.created_at, o.order_number FROM order_messages om JOIN orders o ON o.id=om.order_id WHERE om.sender_type='user' AND om.is_read=0 ORDER BY om.created_at DESC LIMIT ?`).all(10);
  const unreadMsgs = db.prepare(`SELECT COUNT(*) as c FROM order_messages WHERE sender_type='user' AND is_read=0`).get().c;
  const pendingReceipts = db.prepare(`SELECT COUNT(*) as c FROM payment_receipts WHERE status='pending'`).get().c;
  const newOrders = db.prepare(`SELECT COUNT(*) as c FROM orders WHERE status='pending_payment' AND created_at > datetime('now','-24 hours')`).get().c;
  res.json({ orders, receipts, msgs, unreadMsgs, pendingReceipts, newOrders, total: unreadMsgs + pendingReceipts + newOrders });
});

// GET /api/user/unread-messages — unread admin messages for current user
app.get('/api/user/unread-messages', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Не авторизован' });
  const row = db.prepare(`SELECT COUNT(*) as c FROM order_messages om
    JOIN orders o ON o.id=om.order_id
    WHERE o.user_id=? AND om.sender_type='admin' AND om.is_read=0`)
    .get(req.session.userId);
  res.json({ count: row.c });
});

// ══════════════════════════════════════════
//  ORDER SYSTEM
// ══════════════════════════════════════════

// Receipts directory
const receiptsDir = path.join(ROOT, 'receipts');
if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir);
app.use('/receipts', express.static(receiptsDir));

// Multer for receipt uploads
const receiptUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, receiptsDir),
    filename:    (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `rcpt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Только изображения или PDF'));
  }
});

// Helper: generate sequential order number (1, 2, 3, ...)
function generateOrderNumber() {
  const row = db.prepare('SELECT MAX(CAST(order_number AS INTEGER)) as max_num FROM orders').get();
  const next = (row && row.max_num) ? row.max_num + 1 : 1;
  return String(next);
}

// Helper: Tajik time string
function tajikTimeStr() {
  return new Date().toLocaleString('ru-RU', {
    timeZone: 'Asia/Dushanbe',
    hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: '2-digit'
  });
}

// Helper: estimated delivery time (+60-90 min)
function estimatedDelivery() {
  const d = new Date(Date.now() + 75 * 60000); // +75 min
  return d.toLocaleTimeString('ru-RU', {
    timeZone: 'Asia/Dushanbe',
    hour: '2-digit', minute: '2-digit'
  });
}

// Allowed extras with server-side prices (never trust client)
const ALLOWED_EXTRAS = {
  'Открытка':            { price: 0,  img: 'images/otkritka.jpg' },
  'Шоколад Люкс':        { price: 10, img: 'images/saka.jpg'     },
  'Шоколад Бельгийский': { price: 11, img: 'images/saka2.jpg'    },
  'Шоколад Трюфель':     { price: 15, img: 'images/saka3.jpg'    },
};
const SERVER_DELIVERY_FEE = 10;

// POST /api/orders — create order (login required)
app.post('/api/orders', (req, res) => {
  if (!req.session || !req.session.userId)
    return res.status(401).json({ error: 'Войдите в аккаунт для оформления заказа' });

  const {
    recipient_type, name, phone, address, comment, card_text,
    schedule, schedule_time,
    items, extras
  } = req.body;

  if (!name || !phone || !address)
    return res.status(400).json({ error: 'Заполните все обязательные поля' });
  if (!items || !items.length)
    return res.status(400).json({ error: 'Корзина пуста' });

  // ── Server-side price calculation ──
  const verifiedItems = [];
  for (const item of items) {
    const product = db.prepare('SELECT id, name, price, discount FROM products WHERE id = ? AND status = 1').get(item.product_id);
    if (!product) return res.status(400).json({ error: `Товар #${item.product_id} не найден или недоступен` });
    const qty = Math.max(1, Math.min(99, Math.floor(Number(item.qty) || 1)));
    const finalPrice = product.discount > 0
      ? Math.round(product.price * (1 - product.discount / 100))
      : product.price;
    verifiedItems.push({ product, qty, finalPrice });
  }

  const verifiedExtras = [];
  if (extras && Array.isArray(extras)) {
    for (const e of extras) {
      if (!e.selected) continue;
      const allowed = ALLOWED_EXTRAS[e.name];
      if (!allowed) continue;
      const qty = Math.max(1, Math.min(10, Math.floor(Number(e.qty) || 1)));
      verifiedExtras.push({ name: e.name, price: allowed.price, qty, img: allowed.img });
    }
  }

  const serverSubtotal   = verifiedItems.reduce((s, i) => s + i.finalPrice * i.qty, 0);
  const serverExtrasTotal = verifiedExtras.reduce((s, e) => s + e.price * e.qty, 0);
  const serverDelivery   = verifiedItems.length > 0 ? SERVER_DELIVERY_FEE : 0;
  const serverTotal      = serverSubtotal + serverExtrasTotal + serverDelivery;
  if (serverTotal === 0 && verifiedItems.length > 0)
    return res.status(400).json({ error: 'Ошибка расчёта стоимости' });
  const points           = Math.floor(serverTotal / 10);

  const orderNumber = generateOrderNumber();

  const createOrder = db.transaction(() => {
    const r = db.prepare(`
      INSERT INTO orders
        (order_number, user_id, status, recipient_type, name, phone, address,
         comment, card_text, schedule, schedule_time, subtotal, extras_total,
         delivery_fee, total, points_earned)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      orderNumber,
      req.session.userId,
      'pending_payment',
      recipient_type || 'self',
      str(name), str(phone), str(address),
      str(comment), str(card_text),
      schedule || 'now', str(schedule_time),
      serverSubtotal, serverExtrasTotal, serverDelivery, serverTotal,
      points
    );
    const orderId = r.lastInsertRowid;

    const insItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, product_price, product_discount, quantity, extra_image)
      VALUES (?,?,?,?,?,?,?)
    `);
    for (const i of verifiedItems) {
      insItem.run(orderId, i.product.id, i.product.name, i.finalPrice, i.product.discount, i.qty, null);
    }
    for (const e of verifiedExtras) {
      insItem.run(orderId, null, e.name, e.price, 0, e.qty, e.img);
    }

    return { orderId, orderNumber };
  });

  try {
    const { orderId, orderNumber: oNum } = createOrder();
    // Push admin: new order
    sendPushToAdmins({ title: '🌸 Новый заказ', body: `#${oNum} — ${name}`, url: '/admin.html', tag: 'new-order' });
    // Fetch bank details
    const settings = db.prepare("SELECT key, value FROM site_settings WHERE key IN ('bank_card_number','bank_card_name','bank_card_bank')").all();
    const bank = {};
    settings.forEach(s => { bank[s.key] = s.value; });
    res.json({
      ok: true,
      order_number: oNum,
      order_id: orderId,
      estimated_delivery: estimatedDelivery(),
      bank: {
        card_number: bank.bank_card_number || '0000 0000 0000 0000',
        card_name:   bank.bank_card_name   || 'GULREZ',
        card_bank:   bank.bank_card_bank   || 'Eskhata Bank'
      }
    });
  } catch (e) {
    console.error('[Order create]', e);
    res.status(500).json({ error: 'Ошибка при создании заказа' });
  }
});

// POST /api/orders/:orderNum/receipt — upload payment receipt
app.post('/api/orders/:orderNum/receipt', receiptUpload.single('receipt'), (req, res) => {
  if (!req.session || !req.session.userId)
    return res.status(401).json({ error: 'Не авторизован' });
  if (!req.file)
    return res.status(400).json({ error: 'Файл не получен' });

  const order = db.prepare('SELECT * FROM orders WHERE order_number = ? AND user_id = ?')
    .get(req.params.orderNum, req.session.userId);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });

  const receiptPath = `receipts/${req.file.filename}`;
  db.prepare('INSERT INTO payment_receipts (order_id, receipt_path) VALUES (?,?)').run(order.id, receiptPath);
  db.prepare("UPDATE orders SET status='receipt_uploaded', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id);
  notifyOrderStatus(order.order_number, 'receipt_uploaded');
  sendPushToAdmins({ title: '💳 Чек загружен', body: `Заказ #${order.order_number}`, url: '/admin.html', tag: 'receipt-' + order.order_number });

  res.json({ ok: true, receipt: receiptPath });
});

// GET /api/user/orders — current user's orders
app.get('/api/user/orders', (req, res) => {
  if (!req.session || !req.session.userId)
    return res.status(401).json({ error: 'Не авторизован' });

  const orders = db.prepare(`
    SELECT o.*,
      (SELECT receipt_path FROM payment_receipts WHERE order_id = o.id ORDER BY id DESC LIMIT 1) AS receipt_path,
      (SELECT status FROM payment_receipts WHERE order_id = o.id ORDER BY id DESC LIMIT 1) AS receipt_status
    FROM orders o WHERE o.user_id = ? ORDER BY o.created_at DESC
  `).all(req.session.userId);

  const withItems = orders.map(o => ({
    ...o,
    items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id)
  }));

  res.json(withItems);
});

// GET /api/user/points — current user's loyalty points
app.get('/api/user/points', (req, res) => {
  if (!req.session || !req.session.userId)
    return res.status(401).json({ error: 'Не авторизован' });
  const lp = db.prepare('SELECT * FROM loyalty_points WHERE user_id = ?').get(req.session.userId);
  res.json({ points: lp ? lp.points : 0, lifetime: lp ? lp.lifetime_points : 0 });
});

// GET /api/user/points/history — points earned from orders
app.get('/api/user/points/history', (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json([]);
  const rows = db.prepare(`
    SELECT order_number, points_earned, created_at, total
    FROM orders
    WHERE user_id = ? AND status = 'confirmed' AND points_earned > 0
    ORDER BY created_at DESC LIMIT 50
  `).all(req.session.userId);
  res.json(rows);
});

// GET /api/loyalty/leaderboard — top 10 users by lifetime points
app.get('/api/loyalty/leaderboard', (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.login, u.avatar, lp.lifetime_points
    FROM loyalty_points lp
    JOIN users u ON u.id = lp.user_id
    WHERE lp.lifetime_points > 0
    ORDER BY lp.lifetime_points DESC LIMIT 10
  `).all();
  const totalRow = db.prepare(`SELECT COUNT(*) AS cnt FROM loyalty_points WHERE lifetime_points > 0`).get();
  const total = totalRow ? totalRow.cnt : 0;
  const myId = req.session && req.session.userId ? req.session.userId : null;
  let myRank = null, myEntry = null;
  if (myId) {
    const rankRow = db.prepare(`
      SELECT COUNT(*) + 1 AS rank FROM loyalty_points
      WHERE lifetime_points > (SELECT COALESCE(lifetime_points,0) FROM loyalty_points WHERE user_id = ?)
        AND lifetime_points > 0
    `).get(myId);
    myRank = rankRow ? rankRow.rank : null;
    myEntry = db.prepare(`
      SELECT u.id, u.login, u.avatar, lp.lifetime_points
      FROM loyalty_points lp JOIN users u ON u.id = lp.user_id WHERE lp.user_id = ?
    `).get(myId) || null;
  }
  res.json({ leaderboard: rows, myRank, myEntry, myId, total });
});

// ── Admin order endpoints ──

// GET /api/admin/orders — all orders
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const { status } = req.query;
  let query = `
    SELECT o.*,
      u.login as user_login,
      (SELECT receipt_path FROM payment_receipts WHERE order_id = o.id ORDER BY id DESC LIMIT 1) AS receipt_path,
      (SELECT status FROM payment_receipts WHERE order_id = o.id ORDER BY id DESC LIMIT 1) AS receipt_status,
      (SELECT admin_notes FROM payment_receipts WHERE order_id = o.id ORDER BY id DESC LIMIT 1) AS receipt_notes,
      (SELECT COUNT(*) FROM order_messages WHERE order_id = o.id AND sender_type='user' AND is_read=0) AS unread_msgs
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
  `;
  const params = [];
  if (status && status !== 'all') { query += ' WHERE o.status = ?'; params.push(status); }
  query += ' ORDER BY o.created_at DESC';

  const orders = db.prepare(query).all(...params);
  const withItems = orders.map(o => ({
    ...o,
    items: db.prepare(`
      SELECT oi.*, COALESCE(p.image1, oi.extra_image) AS product_image
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ?
    `).all(o.id)
  }));
  res.json(withItems);
});

// GET /api/admin/orders/stats — order statistics
app.get('/api/admin/orders/stats', requireAdmin, (req, res) => {
  const total   = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
  const pending = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE status IN ('pending_payment','receipt_uploaded')").get().c;
  const confirmed = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE status='confirmed'").get().c;
  const revenue = db.prepare("SELECT COALESCE(SUM(total),0) AS s FROM orders WHERE status IN ('confirmed','delivered')").get().s;
  res.json({ total, pending, confirmed, revenue });
});

// GET /api/admin/orders/notifications — count of orders needing review
app.get('/api/admin/orders/notifications', requireAdmin, (req, res) => {
  const count = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE status='receipt_uploaded'").get().c;
  res.json({ count });
});

// PUT /api/admin/orders/:id/status — approve or reject
app.put('/api/admin/orders/:id/status', requireAdmin, (req, res) => {
  const { status, notes } = req.body;
  const allowed = ['confirmed', 'rejected', 'in_progress', 'delivered', 'cancelled'];
  if (!allowed.includes(status))
    return res.status(400).json({ error: 'Недопустимый статус' });

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });

  const update = db.transaction(() => {
    db.prepare("UPDATE orders SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, order.id);

    // Update receipt review info
    const receipt = db.prepare('SELECT id FROM payment_receipts WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(order.id);
    if (receipt) {
      db.prepare(`UPDATE payment_receipts SET status=?, admin_notes=?, reviewed_at=CURRENT_TIMESTAMP, reviewed_by=? WHERE id=?`)
        .run(status === 'confirmed' ? 'approved' : 'rejected', notes || '', req.session.login || 'admin', receipt.id);
    }

    // Award loyalty points on confirmation
    if (status === 'confirmed' && order.user_id && order.points_earned > 0) {
      const existing = db.prepare('SELECT * FROM loyalty_points WHERE user_id = ?').get(order.user_id);
      if (existing) {
        db.prepare('UPDATE loyalty_points SET points=points+?, lifetime_points=lifetime_points+? WHERE user_id=?')
          .run(order.points_earned, order.points_earned, order.user_id);
      } else {
        db.prepare('INSERT INTO loyalty_points (user_id, points, lifetime_points) VALUES (?,?,?)')
          .run(order.user_id, order.points_earned, order.points_earned);
      }
    }
  });

  update();
  notifyOrderStatus(order.order_number, status);
  const STATUS_LABELS = { confirmed: 'Оплата подтверждена ✅', rejected: 'Оплата отклонена ❌', in_progress: 'Букет собирается 🌸', delivered: 'Заказ доставлен 🎉', cancelled: 'Заказ отменён' };
  if (order.user_id && STATUS_LABELS[status]) {
    sendPushToUser(order.user_id, { title: 'Заказ #' + order.order_number, body: STATUS_LABELS[status], url: '/user.html', tag: 'status-' + order.order_number });
  }
  res.json({ ok: true });
});

// GET /api/orders/:orderNum/track — SSE live tracking (login required)
app.get('/api/orders/:orderNum/track', (req, res) => {
  if (!req.session || !req.session.userId)
    return res.status(401).end();

  const order = db.prepare('SELECT * FROM orders WHERE order_number = ? AND user_id = ?')
    .get(req.params.orderNum, req.session.userId);
  if (!order) return res.status(404).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send current status immediately
  res.write(`data: ${JSON.stringify({ status: order.status, ts: Date.now() })}\n\n`);

  // Register this client
  const key = String(req.params.orderNum);
  if (!orderSseClients.has(key)) orderSseClients.set(key, new Set());
  orderSseClients.get(key).add(res);

  // Keep-alive ping every 20s (prevents proxy timeout)
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 20000);

  req.on('close', () => {
    clearInterval(ping);
    const set = orderSseClients.get(key);
    if (set) {
      set.delete(res);
      if (set.size === 0) orderSseClients.delete(key);
    }
  });
});

// GET /api/admin/orders/:id — single order detail
app.get('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const order = db.prepare(`
    SELECT o.*, u.login as user_login, u.phone as user_phone
    FROM orders o LEFT JOIN users u ON u.id = o.user_id
    WHERE o.id = ?
  `).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Не найден' });
  // Include product image thumbnails for rich admin view
  const items = db.prepare(`
    SELECT oi.*, COALESCE(p.image1, oi.extra_image) AS product_image
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ?
  `).all(order.id);
  const receipts = db.prepare('SELECT * FROM payment_receipts WHERE order_id = ? ORDER BY id DESC').all(order.id);
  res.json({ ...order, items, receipts });
});

// GET /api/admin/bank — get bank requisites
app.get('/api/admin/bank', requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT key, value FROM site_settings WHERE key IN ('bank_card_number','bank_card_name','bank_card_bank')").all();
  const b = {};
  rows.forEach(r => { b[r.key] = r.value; });
  res.json(b);
});

// POST /api/admin/bank — update bank requisites
app.post('/api/admin/bank', requireAdmin, (req, res) => {
  const upsert = db.prepare("INSERT INTO site_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const { bank_card_number, bank_card_name, bank_card_bank } = req.body;
  if (bank_card_number !== undefined) upsert.run('bank_card_number', bank_card_number);
  if (bank_card_name   !== undefined) upsert.run('bank_card_name',   bank_card_name);
  if (bank_card_bank   !== undefined) upsert.run('bank_card_bank',   bank_card_bank);
  res.json({ ok: true });
});

// ══════════════════════════════════════════
//  ORDER CHAT  (user ↔ admin)
// ══════════════════════════════════════════

// Helper: push payload to all SSE clients of an order
function notifyOrderClients(orderNumber, payload) {
  const clients = orderSseClients.get(String(orderNumber));
  if (!clients || clients.size === 0) return;
  const data = JSON.stringify(payload);
  clients.forEach(c => { try { c.write(`data: ${data}\n\n`); } catch (_) {} });
}

// GET /api/orders/:orderNum/messages — customer reads chat
app.get('/api/orders/:orderNum/messages', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Не авторизован' });
  const order = db.prepare('SELECT id FROM orders WHERE order_number=? AND user_id=?')
    .get(req.params.orderNum, req.session.userId);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  const msgs = db.prepare('SELECT * FROM order_messages WHERE order_id=? ORDER BY created_at ASC').all(order.id);
  // Mark admin messages as read
  db.prepare("UPDATE order_messages SET is_read=1 WHERE order_id=? AND sender_type='admin'").run(order.id);
  res.json(msgs);
});

// POST /api/orders/:orderNum/messages — customer sends message
app.post('/api/orders/:orderNum/messages', chatImageUpload.single('image'), (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Не авторизован' });
  const order = db.prepare('SELECT * FROM orders WHERE order_number=? AND user_id=?')
    .get(req.params.orderNum, req.session.userId);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  const message   = (req.body.message || '').trim().slice(0, 1000);
  const imagePath = req.file ? `chat-images/${req.file.filename}` : null;
  if (!message && !imagePath) return res.status(400).json({ error: 'Пустое сообщение' });
  const r = db.prepare('INSERT INTO order_messages (order_id,sender_type,message,image_path) VALUES (?,?,?,?)')
    .run(order.id, 'user', message || null, imagePath);
  const msg = db.prepare('SELECT * FROM order_messages WHERE id=?').get(r.lastInsertRowid);
  sendPushToAdmins({ title: '💬 Сообщение от клиента', body: `Заказ #${order.order_number}: ${(message||'📷 Фото').slice(0,80)}`, url: '/admin.html', tag: 'user-msg-' + order.order_number });
  res.json({ ok: true, message: msg });
});

// GET /api/admin/orders/:id/messages — admin reads chat
app.get('/api/admin/orders/:id/messages', requireAdmin, (req, res) => {
  const msgs = db.prepare('SELECT * FROM order_messages WHERE order_id=? ORDER BY created_at ASC').all(req.params.id);
  // Mark user messages as read by admin
  db.prepare("UPDATE order_messages SET is_read=1 WHERE order_id=? AND sender_type='user'").run(req.params.id);
  // Count unread from user
  const unread = db.prepare("SELECT COUNT(*) as c FROM order_messages WHERE order_id=? AND sender_type='user' AND is_read=0").get(req.params.id);
  res.json({ messages: msgs, unread: unread.c });
});

// POST /api/admin/orders/:id/messages — admin sends message
app.post('/api/admin/orders/:id/messages', requireAdmin, chatImageUpload.single('image'), (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  const message   = (req.body.message || '').trim().slice(0, 1000);
  const imagePath = req.file ? `chat-images/${req.file.filename}` : null;
  if (!message && !imagePath) return res.status(400).json({ error: 'Пустое сообщение' });
  const r = db.prepare('INSERT INTO order_messages (order_id,sender_type,message,image_path) VALUES (?,?,?,?)')
    .run(order.id, 'admin', message || null, imagePath);
  const msg = db.prepare('SELECT * FROM order_messages WHERE id=?').get(r.lastInsertRowid);
  notifyOrderClients(order.order_number, { type: 'message', message: msg });
  if (order.user_id) sendPushToUser(order.user_id, { title: '💬 Ответ от магазина', body: (message||'📷 Фото').slice(0,80), url: '/user.html', tag: 'admin-msg-' + order.order_number });
  res.json({ ok: true, message: msg });
});

// GET /api/admin/orders/:id/messages/unread — unread count for badge
app.get('/api/admin/orders/:id/messages/unread', requireAdmin, (req, res) => {
  const row = db.prepare("SELECT COUNT(*) as c FROM order_messages WHERE order_id=? AND sender_type='user' AND is_read=0").get(req.params.id);
  res.json({ count: row.c });
});

// ══════════════════════════════════════════
//  ORDER PHOTOS  (admin uploads → customer sees)
// ══════════════════════════════════════════

// POST /api/admin/orders/:id/photos — admin uploads progress photo
app.post('/api/admin/orders/:id/photos', requireAdmin, orderPhotoUpload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  const caption = (req.body.caption || '').trim().slice(0, 200);
  const photoPath = `order-photos/${req.file.filename}`;
  const r = db.prepare('INSERT INTO order_photos (order_id,photo_path,caption) VALUES (?,?,?)').run(order.id, photoPath, caption);
  const photo = db.prepare('SELECT * FROM order_photos WHERE id=?').get(r.lastInsertRowid);
  // Push to customer SSE
  notifyOrderClients(order.order_number, { type: 'photo', photo });
  if (order.user_id) sendPushToUser(order.user_id, { title: '📸 Фото вашего букета', body: `Заказ #${order.order_number} — магазин загрузил фото`, url: '/user.html', tag: 'photo-' + order.order_number });
  res.json({ ok: true, photo });
});

// DELETE /api/admin/orders/:id/photos/:photoId — admin deletes photo
app.delete('/api/admin/orders/:id/photos/:photoId', requireAdmin, (req, res) => {
  const photo = db.prepare('SELECT * FROM order_photos WHERE id=? AND order_id=?').get(req.params.photoId, req.params.id);
  if (!photo) return res.status(404).json({ error: 'Фото не найдено' });
  try { fs.unlinkSync(path.join(ROOT, photo.photo_path)); } catch (_) {}
  db.prepare('DELETE FROM order_photos WHERE id=?').run(photo.id);
  res.json({ ok: true });
});

// GET /api/orders/:orderNum/photos — customer gets admin photos
app.get('/api/orders/:orderNum/photos', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Не авторизован' });
  const order = db.prepare('SELECT id FROM orders WHERE order_number=? AND user_id=?')
    .get(req.params.orderNum, req.session.userId);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  const photos = db.prepare('SELECT * FROM order_photos WHERE order_id=? ORDER BY created_at ASC').all(order.id);
  res.json(photos);
});

// GET /api/admin/orders/:id/photos — admin gets photos list
app.get('/api/admin/orders/:id/photos', requireAdmin, (req, res) => {
  const photos = db.prepare('SELECT * FROM order_photos WHERE order_id=? ORDER BY created_at ASC').all(req.params.id);
  res.json(photos);
});

// GET /api/admin/reports/daily — orders grouped by day (Tajikistan time UTC+5)
app.get('/api/admin/reports/daily', requireAdmin, (req, res) => {
  const { from, to } = req.query;
  let where = [];
  let params = [];
  if (from) { where.push("date(created_at, '+5 hours') >= ?"); params.push(from); }
  if (to)   { where.push("date(created_at, '+5 hours') <= ?"); params.push(to);   }
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const days = db.prepare(`
    SELECT
      date(created_at, '+5 hours') AS day,
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status IN ('confirmed','in_progress','delivered') THEN total ELSE 0 END), 0) AS revenue,
      SUM(CASE WHEN status='pending_payment'  THEN 1 ELSE 0 END) AS cnt_pending,
      SUM(CASE WHEN status='receipt_uploaded' THEN 1 ELSE 0 END) AS cnt_receipt,
      SUM(CASE WHEN status='confirmed'        THEN 1 ELSE 0 END) AS cnt_confirmed,
      SUM(CASE WHEN status='in_progress'      THEN 1 ELSE 0 END) AS cnt_progress,
      SUM(CASE WHEN status='delivered'        THEN 1 ELSE 0 END) AS cnt_delivered,
      SUM(CASE WHEN status='rejected'         THEN 1 ELSE 0 END) AS cnt_rejected,
      SUM(CASE WHEN status='cancelled'        THEN 1 ELSE 0 END) AS cnt_cancelled
    FROM orders ${whereClause}
    GROUP BY day ORDER BY day DESC
  `).all(...params);

  // Attach compact order list per day for the detail view
  const result = days.map(d => ({
    ...d,
    orders: db.prepare(`
      SELECT o.id, o.order_number, o.status, o.total, o.name, o.phone,
             o.created_at, u.login as user_login
      FROM orders o LEFT JOIN users u ON u.id = o.user_id
      WHERE date(o.created_at, '+5 hours') = ?
      ORDER BY o.created_at DESC
    `).all(d.day)
  }));

  res.json(result);
});

// ─── JSON ERROR HANDLER ───
// Must be defined after all routes. Converts multer/upload errors and
// unhandled route errors into consistent JSON (never HTML).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ error: 'Файл слишком большой' });
  if (err.message && err.message.includes('Только изображения'))
    return res.status(400).json({ error: 'Только изображения разрешены' });
  if (err.message && (err.message.includes('PDF') || err.message.includes('Только')))
    return res.status(400).json({ error: err.message });
  console.error('[Error handler]', err);
  res.status(err.status || 500).json({ error: err.message || 'Внутренняя ошибка сервера' });
});

// ─── START ───
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🌸 GULREZ server: http://localhost:${PORT}`);
  });
}

module.exports = app;
