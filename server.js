require('dotenv').config();
const express = require('express');
const connectDB = require('./db');
const { processMessage, buildSearchIndex } = require('./agent');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Connect to MongoDB + build search index
(async () => {
  await connectDB();
  await buildSearchIndex();
})();

app.get('/', (req, res) => {
  res.send('Ignis Clean Cooking Pipeline Agent is running 🔥');
});

// Twilio WhatsApp Webhook
app.post('/webhook', async (req, res) => {
  const incomingMessage = req.body.Body;
  const senderNumber = req.body.From;

  console.log(`📩 ${senderNumber}: ${incomingMessage}`);

  if (!incomingMessage) {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Send me a message and I'll help you out! 😊</Message></Response>`;
    res.type('text/xml').send(twiml);
    return;
  }

  try {
    const reply = await processMessage(incomingMessage, senderNumber);
    console.log(`📤 Reply (${reply.length} chars)`);

    // WhatsApp 1600 char limit — split if needed
    const truncated = reply.length > 1500
      ? reply.substring(0, 1480) + '\n\n_(message trimmed)_'
      : reply;

    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(truncated)}</Message></Response>`;
    res.type('text/xml').send(twiml);
  } catch (error) {
    console.error('Webhook error:', error);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Something hiccupped 😅 Try again!</Message></Response>`;
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
    console.error('Test error:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🔥 Ignis Bot running on http://localhost:${PORT}`);
});
