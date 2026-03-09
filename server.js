require('dotenv').config();
const express = require('express');
const { processMessage, buildSearchIndex } = require('./agent');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Build Supabase cache on startup
(async () => {
  await buildSearchIndex();
})();

app.get('/', (req, res) => {
  res.send('🔥 Ignis Clean Cooking Bot is running!');
});

// Twilio WhatsApp Webhook
app.post('/webhook', async (req, res) => {
  const incomingMessage = req.body.Body;
  const senderNumber = req.body.From;

  console.log(`📩 ${senderNumber}: ${incomingMessage}`);

  if (!incomingMessage) {
    return res.type('text/xml').send(twimlMsg("Send me a message and I'll help! 😊"));
  }

  try {
    const reply = await processMessage(incomingMessage, senderNumber);
    console.log(`📤 Reply (${reply.length} chars)`);

    // WhatsApp 1600 char limit
    const truncated = reply.length > 1500
      ? reply.substring(0, 1480) + '\n\n_(message trimmed — say "show more")_'
      : reply;

    res.type('text/xml').send(twimlMsg(truncated));
  } catch (err) {
    console.error('Webhook error:', err);
    res.type('text/xml').send(twimlMsg('Something hiccupped 😅 Try again!'));
  }
});

// Local test endpoint
app.post('/test', async (req, res) => {
  const { message, userId } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    const reply = await processMessage(message, userId || 'test-user');
    res.json({ reply, length: reply.length });
  } catch (err) {
    console.error('Test error:', err);
    res.status(500).json({ error: err.message });
  }
});

function twimlMsg(text) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(text)}</Message></Response>`;
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🔥 Ignis Bot running on http://localhost:${PORT}`);
});
