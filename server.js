const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin
// You'll need to download a service account key from Firebase Console
let serviceAccount;
try {
  serviceAccount = require('./service-account-key.json');
} catch (error) {
  console.warn('Service account key not found. Using environment variables.');
  serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  };
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// API Key validation
const VALID_API_KEYS = process.env.API_KEYS 
  ? process.env.API_KEYS.split(',')
  : ['exam-lock-2025-secure-key-38G8Jc59pc']; // Default fallback

// Middleware to validate API key
const validateApiKey = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const apiKey = authHeader.substring(7);
  if (!VALID_API_KEYS.includes(apiKey)) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  next();
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Events endpoint
app.post('/events', validateApiKey, async (req, res) => {
  try {
    const { type, payload } = req.body;

    // Validate required fields
    if (!type || !payload) {
      return res.status(400).json({ 
        error: 'Missing required fields: type and payload' 
      });
    }

    // Validate event type
    const validTypes = ['connectivity', 'violation'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ 
        error: `Invalid event type. Must be one of: ${validTypes.join(', ')}` 
      });
    }

    // Prepare event document
    const eventDoc = {
      type,
      payload,
      timestamp: new Date(),
      receivedAt: new Date(),
      userAgent: req.headers['user-agent'] || '',
      ip: req.ip || req.connection.remoteAddress || '',
    };

    // Store in Firestore - partition by date
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const eventsRef = db.collection('events').doc(today).collection('items');
    
    const docRef = await eventsRef.add(eventDoc);

    console.log(`Event stored: ${type}`, { eventId: docRef.id });

    res.status(200).json({ 
      success: true, 
      eventId: docRef.id,
      message: 'Event stored successfully' 
    });

  } catch (error) {
    console.error('Error processing event:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Events endpoint: http://localhost:${PORT}/events`);
});

module.exports = app;
