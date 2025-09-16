const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Firebase Admin initialization
let serviceAccount;
try {
  serviceAccount = require('./service-account-key.json');
} catch (err) {
  serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  };
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.projectId}-default-rtdb.firebaseio.com`
});

const db = admin.firestore();

const VALID_API_KEYS = (process.env.API_KEYS || 'exam-lock-2025-secure-key-38G8Jc59pc').split(',');

const validateApiKey = (req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Bearer token' });
  }
  const token = header.substring(7);
  if (!VALID_API_KEYS.includes(token)) {
    return res.status(403).json({ error: 'Invalid API key' });
  }
  next();
};

app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

app.post('/events', validateApiKey, async (req, res) => {
  try {
    const { type, payload } = req.body;
    if (!type || !payload) return res.status(400).json({ error: 'type and payload required' });
    const validTypes = ['connectivity', 'violation'];
    if (!validTypes.includes(type)) return res.status(400).json({ error: `type must be ${validTypes.join(',')}` });

    const event = { type, payload, createdAt: admin.firestore.FieldValue.serverTimestamp() };
    const today = new Date().toISOString().slice(0, 10);
    const ref = await db.collection('events').doc(today).collection('items').add(event);
    res.json({ ok: true, id: ref.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
});

app.use('*', (_, res) => res.status(404).json({ error: 'not found' }));

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
