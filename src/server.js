import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import admin from 'firebase-admin';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const IDENTITY_FILE = path.join(DATA_DIR, 'identity-map.json');
const RESTRICTION_FILE = path.join(DATA_DIR, 'restriction-map.json');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || '';
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || '';
const FIREBASE_PRIVATE_KEY = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

const app = express();
const PORT = process.env.PORT || 3000;

const corsOptions = {
  origin: ['https://yeouidogold.com', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: false
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// 임시 메모리 저장소
const identityMap = new Map();     // key: memberHash
const restrictionMap = new Map();  // key: memberHash 또는 uid:{memberUid}

let firestore = null;
let identityCollection = null;
let restrictionCollection = null;

function initFirestore() {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    console.log('Firestore disabled: missing Firebase env vars');
    return;
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY
      })
    });
  }

  firestore = admin.firestore();
  identityCollection = firestore.collection('identity_map');
  restrictionCollection = firestore.collection('restriction_map');
  console.log('Firestore enabled');
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function loadMapFromFile(filePath, targetMap) {
  try {
    await ensureDataDir();
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    targetMap.clear();
    Object.entries(parsed).forEach(([key, value]) => {
      targetMap.set(key, value);
    });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`loadMapFromFile error (${filePath}):`, error);
    }
  }
}

async function saveMapToFile(filePath, sourceMap) {
  try {
    await ensureDataDir();
    const plainObject = Object.fromEntries(sourceMap);
    await fs.writeFile(filePath, JSON.stringify(plainObject, null, 2), 'utf8');
  } catch (error) {
    console.error(`saveMapToFile error (${filePath}):`, error);
  }
}

async function loadMapFromFirestore(collectionRef, targetMap) {
  if (!collectionRef) return;

  try {
    const snapshot = await collectionRef.get();
    if (!snapshot.empty) {
      targetMap.clear();
      snapshot.forEach(doc => {
        targetMap.set(doc.id, doc.data());
      });
    }
  } catch (error) {
    console.error('loadMapFromFirestore error:', error);
  }
}

async function saveRecordToFirestore(collectionRef, key, value) {
  if (!collectionRef || !key) return;

  try {
    await collectionRef.doc(key).set(value);
  } catch (error) {
    console.error(`saveRecordToFirestore error (${key}):`, error);
  }
}

async function bootstrapData() {
  initFirestore();

  await loadMapFromFile(IDENTITY_FILE, identityMap);
  await loadMapFromFile(RESTRICTION_FILE, restrictionMap);

  if (firestore) {
    await loadMapFromFirestore(identityCollection, identityMap);
    await loadMapFromFirestore(restrictionCollection, restrictionMap);
  }
}

function now() {
  return Date.now();
}

function makeUidKey(memberUid) {
  return `uid:${memberUid}`;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/', (req, res) => {
  res.redirect('/admin');
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.post('/api/test', (req, res) => {
  res.json({
    ok: true,
    message: 'POST works',
    body: req.body
  });
});

/**
 * 1) 로그인 회원 식별값 수집
 */
app.post('/api/imweb/collect-identity', async (req, res) => {
  try {
    const { memberHash, memberUid } = req.body || {};

    if (!memberHash) {
      return res.status(400).json({
        ok: false,
        message: 'memberHash required'
      });
    }

    const prev = identityMap.get(memberHash);

    const savedIdentity = {
      memberHash,
      memberUid: memberUid || prev?.memberUid || '',
      firstSeenAt: prev?.firstSeenAt || now(),
      lastSeenAt: now()
    };

    identityMap.set(memberHash, savedIdentity);

    await saveMapToFile(IDENTITY_FILE, identityMap);
    await saveRecordToFirestore(identityCollection, memberHash, savedIdentity);

    return res.json({
      ok: true,
      saved: identityMap.get(memberHash)
    });
  } catch (error) {
    console.error('collect-identity error:', error);
    return res.status(500).json({
      ok: false,
      message: 'server error'
    });
  }
});

/**
 * 2) 관리자용 제한 등록
 */
app.post('/api/imweb/set-restriction', async (req, res) => {
  try {
    const {
      adminSecret,
      memberHash,
      memberUid,
      reason,
      blockPurchase,
      blockPickup,
      warningOnly,
      isActive,
      releaseReason,
      adminMemo
    } = req.body || {};

    if (adminSecret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({
        ok: false,
        message: 'forbidden'
      });
    }

    if (!memberHash && !memberUid) {
      return res.status(400).json({
        ok: false,
        message: 'memberHash or memberUid required'
      });
    }

    const nowTs = now();
    const hashKey = memberHash || '';
    const uidKey = memberUid ? makeUidKey(memberUid) : '';

    const existingByHash = hashKey && restrictionMap.has(hashKey)
      ? restrictionMap.get(hashKey)
      : null;
    const existingByUid = uidKey && restrictionMap.has(uidKey)
      ? restrictionMap.get(uidKey)
      : null;
    const existing = existingByHash || existingByUid;

    const isWarningOnly = !!warningOnly;

    const record = {
      memberHash: memberHash || existing?.memberHash || '',
      memberUid: memberUid || existing?.memberUid || '',
      reason: reason || existing?.reason || '',
      releaseReason: releaseReason || '',
      adminMemo: adminMemo || existing?.adminMemo || '',
      warningOnly: isWarningOnly,
      blockPurchase: isWarningOnly ? false : !!blockPurchase,
      blockPickup: isWarningOnly ? false : !!blockPickup,
      isActive: isActive !== false,
      createdAt: existing?.createdAt || nowTs,
      updatedAt: nowTs,
      releasedAt: isActive === false ? nowTs : null,
      lastAction: isActive === false ? 'released' : 'restricted'
    };

    if (memberHash) {
      restrictionMap.set(memberHash, record);
      await saveRecordToFirestore(restrictionCollection, memberHash, record);
    }

    if (memberUid) {
      const uidRecord = {
        ...record,
        memberUid
      };
      const uidDocKey = makeUidKey(memberUid);
      restrictionMap.set(uidDocKey, uidRecord);
      await saveRecordToFirestore(restrictionCollection, uidDocKey, uidRecord);
    }

    await saveMapToFile(RESTRICTION_FILE, restrictionMap);

    return res.json({
      ok: true,
      memberHash: record.memberHash,
      memberUid: record.memberUid,
      reason: record.reason,
      releaseReason: record.releaseReason,
      adminMemo: record.adminMemo,
      blockPurchase: record.blockPurchase,
      blockPickup: record.blockPickup,
      isActive: record.isActive,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      releasedAt: record.releasedAt,
      lastAction: record.lastAction
    });
  } catch (error) {
    console.error('set-restriction error:', error);
    return res.status(500).json({
      ok: false,
      message: 'server error'
    });
  }
});

/**
 * 3) 프론트에서 제한 여부 조회
 */
app.post('/api/imweb/check-restriction', (req, res) => {
  try {
    const { memberHash, memberUid } = req.body || {};

    let found = null;

    if (memberHash && restrictionMap.has(memberHash)) {
      found = restrictionMap.get(memberHash);
    }

    if (!found && memberUid && restrictionMap.has(makeUidKey(memberUid))) {
      found = restrictionMap.get(makeUidKey(memberUid));
    }

    if (!found || found.isActive === false) {
      return res.json({
        blocked: false,
        warningOnly: false,
        blockPurchase: false,
        blockPickup: false,
        reason: ''
      });
    }

    const isWarningOnly = !!found.warningOnly;

    return res.json({
      blocked: isWarningOnly ? false : !!(found.blockPurchase || found.blockPickup),
      warningOnly: isWarningOnly,
      blockPurchase: isWarningOnly ? false : !!found.blockPurchase,
      blockPickup: isWarningOnly ? false : !!found.blockPickup,
      reason: found.reason || ''
    });
  } catch (error) {
    console.error('check-restriction error:', error);
    return res.status(500).json({
      blocked: false,
      blockPurchase: false,
      blockPickup: false,
      reason: ''
    });
  }
});

app.post('/api/imweb/admin/list', (req, res) => {
  try {
    const { adminSecret } = req.body || {};

    if (adminSecret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ ok: false, message: 'forbidden' });
    }

    return res.json({
      ok: true,
      identities: Object.values(Object.fromEntries(identityMap)),
      restrictions: Object.values(Object.fromEntries(restrictionMap))
    });
  } catch (error) {
    console.error('admin/list error:', error);
    return res.status(500).json({ ok: false, message: 'server error' });
  }
});

app.post('/api/imweb/admin/search', (req, res) => {
  try {
    const { adminSecret, keyword } = req.body || {};

    if (adminSecret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ ok: false, message: 'forbidden' });
    }

    const q = String(keyword || '').trim().toLowerCase();

    const identities = Object.values(Object.fromEntries(identityMap)).filter(item => {
      return (
        (item.memberHash || '').toLowerCase().includes(q) ||
        (item.memberUid || '').toLowerCase().includes(q)
      );
    });

    const restrictions = Object.values(Object.fromEntries(restrictionMap)).filter(item => {
      return (
        (item.memberHash || '').toLowerCase().includes(q) ||
        (item.memberUid || '').toLowerCase().includes(q) ||
        (item.reason || '').toLowerCase().includes(q)
      );
    });

    return res.json({
      ok: true,
      identities,
      restrictions
    });
  } catch (error) {
    console.error('admin/search error:', error);
    return res.status(500).json({ ok: false, message: 'server error' });
  }
});

/**
 * 디버그용: 현재 메모리 상태 확인
 */
app.get('/api/imweb/debug/state', (req, res) => {
  res.json({
    ok: true,
    identityMap: Object.fromEntries(identityMap),
    restrictionMap: Object.fromEntries(restrictionMap)
  });
});

bootstrapData()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('bootstrapData error:', error);
    process.exit(1);
  });