require('dotenv').config();
const express = require('express');
const connectDB = require('./db');
const { processMessage } = require('./agent');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Connect to MongoDB
connectDB();

// Health check
app.get('/', (req, res) => {
  res.send('Ignis Clean Cooking Pipeline Agent is running');
});

// Twilio WhatsApp Webhook
app.post('/webhook', async (req, res) => {
  const incomingMessage = req.body.Body;
  const senderNumber = req.body.From;

  console.log(`Message from ${senderNumber}: ${incomingMessage}`);

  if (!incomingMessage) {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Please send a text message.</Message></Response>`;
    res.type('text/xml').send(twiml);
    return;
  }

  try {
    // Pass sender number as userId for session management
    const reply = await processMessage(incomingMessage, senderNumber);
    console.log(`Reply: ${reply}`);

    // WhatsApp has a 1600 character limit per message
    const truncatedReply = reply.length > 1500
      ? reply.substring(0, 1500) + '\n\n...(message truncated)'
      : reply;

    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(truncatedReply)}</Message></Response>`;
    res.type('text/xml').send(twiml);
  } catch (error) {
    console.error('Webhook error:', error);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Sorry, something went wrong. Please try again.</Message></Response>`;
    res.type('text/xml').send(twiml);
  }
});

// Local test endpoint
app.post('/test', async (req, res) => {
  const { message, userId } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  try {
    const reply = await processMessage(message, userId || 'test-user');
    res.json({ reply });
  } catch (error) {
    console.error('Test endpoint error:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Webhook: http://localhost:${PORT}/webhook`);
  console.log(`Test:    http://localhost:${PORT}/test`);
  console.log('');
  console.log('Next steps:');
  console.log('1. Run: npx ngrok http 3000');
  console.log('2. Copy the https URL');
  console.log('3. Go to Twilio Console > Messaging > WhatsApp Sandbox');
  console.log('4. Paste: https://YOUR-NGROK-URL/webhook');
  console.log('5. Message the Twilio number from WhatsApp!');
});
