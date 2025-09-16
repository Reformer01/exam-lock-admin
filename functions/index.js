const functions = require("firebase-functions");
const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

// Initialize Firebase Admin
initializeApp();
const db = getFirestore();

// API Key validation: supports runtime config (Spark) or env var (Blaze/CI)
const VALID_API_KEYS = (() => {
  if (process.env.VALID_API_KEYS) {
    return process.env.VALID_API_KEYS.split(',');
  }
  const cfg = functions.config();
  if (cfg.exam && cfg.exam.valid_api_keys) {
    return cfg.exam.valid_api_keys.split(',');
  }
  return [];
})();

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Main event handler function
exports.events = onRequest({
  region: 'europe-west1',
  cors: true
}, async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.set(corsHeaders);
    res.status(204).send('');
    return;
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    res.set(corsHeaders);
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // Validate API key
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.set(corsHeaders);
      res.status(401).json({ error: 'Missing or invalid authorization header' });
      return;
    }

    const apiKey = authHeader.substring(7); // Remove 'Bearer ' prefix
    if (VALID_API_KEYS.length > 0 && !VALID_API_KEYS.includes(apiKey)) {
      res.set(corsHeaders);
      res.status(403).json({ error: 'Invalid API key' });
      return;
    }

    // Parse and validate request body
    const eventData = req.body;
    if (!eventData.type || !eventData.payload) {
      res.set(corsHeaders);
      res.status(400).json({ error: 'Missing required fields: type and payload' });
      return;
    }

    // Validate event type
    const validTypes = ['connectivity', 'violation'];
    if (!validTypes.includes(eventData.type)) {
      res.set(corsHeaders);
      res.status(400).json({ error: `Invalid event type. Must be one of: ${validTypes.join(', ')}` });
      return;
    }

    // Prepare event document
    const eventDoc = {
      type: eventData.type,
      payload: eventData.payload,
      timestamp: new Date(),
      receivedAt: new Date(),
      userAgent: req.headers['user-agent'] || '',
      ip: req.ip || req.connection.remoteAddress || '',
    };

    // Store in Firestore
    // Use date-based collection partitioning for better performance
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const eventsRef = db.collection('events').doc(today).collection('items');
    
    const docRef = await eventsRef.add(eventDoc);

    logger.info(`Event stored: ${eventData.type}`, { eventId: docRef.id });

    res.set(corsHeaders);
    res.status(200).json({ 
      success: true, 
      eventId: docRef.id,
      message: 'Event stored successfully' 
    });

  } catch (error) {
    logger.error('Error processing event:', error);
    res.set(corsHeaders);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Health check endpoint
exports.health = onRequest({
  region: 'europe-west1',
  cors: true
}, async (req, res) => {
  res.set(corsHeaders);
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});
