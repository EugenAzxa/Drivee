module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var event = req.body.event || 'unknown';
  var meta = req.body.meta || '';

  // Save to Supabase
  var supabaseUrl = process.env.SUPABASE_URL || 'https://ofnsssyiiejohcnbejxq.supabase.co';
  var supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

  if (supabaseKey) {
    try {
      await fetch(supabaseUrl + '/rest/v1/analytics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': 'Bearer ' + supabaseKey
        },
        body: JSON.stringify({ event: event, meta: meta })
      });
    } catch (e) {}
  }

  // Send to Telegram
  var botToken = process.env.TELEGRAM_BOT_TOKEN;
  var chatId = process.env.TELEGRAM_CHAT_ID;

  if (botToken && chatId) {
    var icons = {
      'app_open': '🟢',
      'tab_click': '📱',
      'scan_ticket': '📸',
      'scan_success': '✅',
      'reminder_added': '🔔',
      'profile_saved': '👤',
      'report_created': '📍',
      'magic_link_sent': '✉️',
      'gps_started': '📡',
      'share_ticket': '📤',
      'dispute_generated': '⚖️'
    };
    var icon = icons[event] || '📊';
    var text = icon + ' ' + event.replace(/_/g, ' ');
    if (meta) text += '\n' + meta;
    text += '\n🕐 ' + new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' });

    try {
      await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
      });
    } catch (e) {}
  }

  res.status(200).json({ ok: true });
};
