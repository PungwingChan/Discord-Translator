const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');

const app = express();

// Auto-fetch public IP
async function getPublicIP() {
  try {
    const response = await axios.get('https://api.ip.sb/ip', { timeout: 3000 });
    return response.data.trim();
  } catch (error) {
    try {
      const response = await axios.get('https://api.ipify.org', { timeout: 3000 });
      return response.data.trim();
    } catch (err) {
      return null;
    }
  }
}

// Environment variable configuration - get port by priority
const PORT = process.env.SERVER_PORT || process.env.PORT || process.env.APP_PORT || parseInt(process.env.ALLOCATED_PORT) || 443;
let HOST = null; // Auto-fetch public IP on startup

// Indicate port source
if (process.env.SERVER_PORT) {
  console.log(`📍 Using SERVER_PORT: ${PORT}`);
} else if (process.env.PORT) {
  console.log(`📍 Using PORT: ${PORT}`);
} else if (process.env.APP_PORT) {
  console.log(`📍 Using APP_PORT: ${PORT}`);
} else if (process.env.ALLOCATED_PORT) {
  console.log(`📍 Using ALLOCATED_PORT: ${PORT}`);
} else {
  console.log(`📍 Using default port: ${PORT}`);
  console.log(`💡 Tip: Set the environment variable PORT=your_port in the "Startup Parameters" of the EkNodes panel`);
}

// Config file path
const CONFIG_FILE = './.npm/sub.txt';

// Generate random password
function generateRandomPassword(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// Generate example Discord Token format
function generateExampleToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const part1 = Buffer.from(Math.random().toString()).toString('base64').substring(0, 24);
  const part2 = Array.from({length: 6}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const part3 = Array.from({length: 27}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${part1}.${part2}.${part3}`;
}

// Default configuration
let config = {
  adminPassword: generateRandomPassword(16),
  discordToken: generateExampleToken(),
  translateApiUrl: 'https://libretranslate.com',
  translateApiKey: '',
  botStatus: 'offline',
  commandPrefix: '!',
  supportedLanguages: ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru']
};

// Load config file
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      const lines = data.split('\n');
      lines.forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').trim();
          if (key === 'supportedLanguages') {
            config[key] = value.split(',').map(lang => lang.trim());
          } else {
            config[key] = value;
          }
        }
      });
      console.log('✅ Configuration file loaded successfully');
    } else {
      console.log('📝 First startup, generating new config file');
      console.log('🔑 Generated admin password:', config.adminPassword);
      console.log('🎫 Generated sample Token:', config.discordToken);
      saveConfig();
    }
  } catch (error) {
    console.error('❌ Failed to read config file:', error.message);
  }
}

// Save config file
function saveConfig() {
  try {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const configText = [
      `adminPassword=${config.adminPassword}`,
      `discordToken=${config.discordToken}`,
      `translateApiUrl=${config.translateApiUrl}`,
      `translateApiKey=${config.translateApiKey}`,
      `botStatus=${config.botStatus}`,
      `commandPrefix=${config.commandPrefix}`,
      `supportedLanguages=${config.supportedLanguages.join(',')}`
    ].join('\n');
    
    fs.writeFileSync(CONFIG_FILE, configText, 'utf8');
    console.log('💾 Configuration saved');
  } catch (error) {
    console.error('❌ Failed to save config file:', error.message);
  }
}

// Load configuration
loadConfig();

// Express middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'discord-bot-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 } // 1 hour
}));

// Static file service
app.use(express.static(__dirname));

// Discord client
let client = null;

// Translation function
async function translate(text, targetLang = 'zh', sourceLang = 'auto') {
  try {
    const url = `${config.translateApiUrl}/translate`;
    const headers = { 'Content-Type': 'application/json' };
    
    if (config.translateApiKey) {
      headers['Authorization'] = `Bearer ${config.translateApiKey}`;
    }
    
    const response = await axios.post(url, {
      q: text,
      source: sourceLang,
      target: targetLang,
      format: 'text'
    }, { headers });
    
    return response.data.translatedText;
  } catch (error) {
    console.error('Translation error:', error.message);
    return null;
  }
}

// Detect language
async function detectLanguage(text) {
  try {
    const url = `${config.translateApiUrl}/detect`;
    const response = await axios.post(url, { q: text });
    return response.data[0].language;
  } catch (error) {
    console.error('Language detection error:', error.message);
    return 'en';
  }
}

// Start Discord bot
function startBot() {
  if (!config.discordToken) {
    console.log('⚠️  Discord Token not configured');
    return false;
  }

  try {
    client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    client.once('ready', () => {
      console.log(`✅ Bot is online: ${client.user.tag}`);
      config.botStatus = 'online';
      saveConfig();
    });

    client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      const content = message.content.trim();
      const prefix = config.commandPrefix;

      if (content.startsWith(`${prefix}translate `) || content.startsWith(`${prefix}tr `)) {
        const args = content.slice(content.startsWith(`${prefix}translate `) ? prefix.length + 10 : prefix.length + 3).trim().split(' ');
        
        if (args.length < 2) {
          return message.reply(`❌ Usage: \`${prefix}translate <target_language> <text>\``);
        }

        const targetLang = args[0].toLowerCase();
        const textToTranslate = args.slice(1).join(' ');

        message.channel.sendTyping();

        const translatedText = await translate(textToTranslate, targetLang);

        if (translatedText) {
          const detectedLang = await detectLanguage(textToTranslate);
          message.reply({
            embeds: [{
              color: 0x5865F2,
              title: '🌍 Translation Result',
              fields: [
                { name: `Original (${detectedLang})`, value: textToTranslate, inline: false },
                { name: `Translated (${targetLang})`, value: translatedText, inline: false }
              ],
              footer: { text: 'Translation Bot' },
              timestamp: new Date()
            }]
          });
        } else {
          message.reply('❌ Translation failed, please try again later.');
        }
      }

      if (content === `${prefix}help`) {
        message.reply({
          embeds: [{
            color: 0x5865F2,
            title: '🤖 Translation Bot Usage Guide',
            fields: [
              { name: '📌 Basic Command', value: `\`${prefix}translate <language> <text>\` or \`${prefix}tr <language> <text>\``, inline: false },
              { name: '🌐 Supported Languages', value: config.supportedLanguages.join(', '), inline: false },
              { name: '💡 Example', value: `\`${prefix}tr zh Hello world\``, inline: false }
            ]
          }]
        });
      }
    });

    client.login(config.discordToken);
    return true;
  } catch (error) {
    console.error('❌ Bot failed to start:', error.message);
    config.botStatus = 'error';
    return false;
  }
}

// Stop bot
function stopBot() {
  if (client) {
    client.destroy();
    client = null;
    config.botStatus = 'offline';
    saveConfig();
    console.log('🛑 Bot stopped');
  }
}

// Web Routes

// Main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'panel.html'));
});

// API: Check login status
app.get('/api/auth/check', (req, res) => {
  res.json({ isAdmin: req.session.isAdmin || false });
});

// API: Login
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (password === config.adminPassword) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// API: Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// API: Change password
app.post('/api/auth/change-password', (req, res) => {
  if (!req.session.isAdmin) {
    return res.status(403).json({ success: false });
  }
  
  const { newPassword } = req.body;
  if (newPassword && newPassword.length >= 6) {
    config.adminPassword = newPassword;
    saveConfig();
    req.session.destroy();
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// API: Get configuration
app.get('/api/config', (req, res) => {
  res.json(config);
});

// API: Save configuration
app.post('/api/config', (req, res) => {
  if (!req.session.isAdmin) {
    return res.status(403).json({ success: false });
  }
  
  const { discordToken, translateApiUrl, translateApiKey, commandPrefix, supportedLanguages } = req.body;
  
  config.discordToken = discordToken || '';
  config.translateApiUrl = translateApiUrl || 'https://libretranslate.com';
  config.translateApiKey = translateApiKey || '';
  config.commandPrefix = commandPrefix || '!';
  config.supportedLanguages = supportedLanguages.split(',').map(lang => lang.trim());
  
  saveConfig();
  res.json({ success: true });
});

// API: Start bot
app.post('/api/bot/start', (req, res) => {
  if (!req.session.isAdmin) {
    return res.status(403).json({ success: false });
  }
  
  if (startBot()) {
    res.json({ success: true });
  } else {
    res.json({ success: false, message: 'Please configure the Discord Token first' });
  }
});

// API: Stop bot
app.post('/api/bot/stop', (req, res) => {
  if (!req.session.isAdmin) {
    return res.status(403).json({ success: false });
  }
  
  stopBot();
  res.json({ success: true });
});

// Start web server
app.listen(PORT, '0.0.0.0', async () => {
  console.log('🔍 Fetching public IP address...');
  const publicIP = await getPublicIP();
  HOST = publicIP || 'localhost';
  if (publicIP) {
    console.log(`✅ Public IP detected: ${publicIP}`);
  } else {
    console.log('⚠️  Unable to retrieve public IP, using localhost');
  }
  
  console.log('');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║        🤖 Discord Translation Bot Panel Started        ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔐 Login Credentials (keep them safe)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   Admin password: ${config.adminPassword}`);
  console.log(`   Sample Token: ${config.discordToken.substring(0, 30)}...`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💡 Tips:');
  console.log('   1. Use the admin password above for your first login');
  console.log('   2. After logging in, enter your real Discord Bot Token in the panel');
  console.log('   3. It is recommended to change the admin password in "Security Settings"');
  console.log('   4. Configuration is saved in the .npm/sub.txt file');
  console.log('');
  
  // If a real Token is configured (not example format), auto-start the bot
  if (config.discordToken && config.discordToken.length > 50 && !config.discordToken.includes('example') && config.botStatus === 'online') {
    console.log('🚀 Token detected, starting bot...');
    startBot();
  }
});
