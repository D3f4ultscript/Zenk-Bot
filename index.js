const { Client, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder, REST, Routes, ChannelType } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildWebhooks
  ]
});

const app = express();
app.use(express.json());

// ----------------- CONFIG / STATE -----------------
const BLACKLIST_WEBHOOK = ['fuck', 'shit', 'bitch', 'ass', 'asshole', 'bastard', 'damn', 'cunt', 'dick', 'cock', 'pussy', 'whore', 'slut', 'fag', 'faggot', 'nigger', 'nigga', 'retard', 'retarded', 'rape', 'nazi', 'hitler', 'kys', 'kill yourself', 'motherfucker', 'bullshit', 'piss', 'prick', 'twat', 'wanker', 'bollocks', 'arse', 'tosser', 'bellend', 'scheiße', 'scheisse', 'scheiß', 'scheiss', 'ficken', 'fick', 'arsch', 'arschloch', 'fotze', 'hure', 'nutte', 'wichser', 'hurensohn', 'schwuchtel', 'schwul', 'dumm', 'idiot', 'trottel', 'vollidiot', 'drecksau', 'sau', 'schwein', 'drecksschwein', 'miststück', 'pisser', 'kacke', 'scheisskerl', 'wixer', 'spast', 'mongo', 'behinderter', 'opfer', 'penner', 'dreckskerl', 'arschlecker', 'pissnelke', 'fotznbrädl', 'möse', 'pimmel', 'schwanz', 'leck mich', 'verpiss dich', 'halt die fresse', 'fresse', 'halt maul', 'maul'];
const BLACKLIST_USERS = BLACKLIST_WEBHOOK.filter(w => w !== 'shit' && w !== 'ass');

const DOWNLOAD_CHANNEL_ID = '1455226125700694027';
const DOWNLOAD_UPDATE_COOLDOWN = 8 * 60 * 1000; // 8 Minuten

let executionCount = 0;
let downloadCount = 0;
let lastUpdate = 0;
let lastDownloadUpdate = 0;

const executionsFile = path.join(__dirname, 'Executions.txt');
const setupFile = path.join(__dirname, 'Setup.json');

const webhookTracker = new Map();
const webhookCooldown = new Map();
let setupConfig = {};

// ----------------- HELPERS -----------------
const parseExecutions = (name) => {
  const m = String(name || '').match(/Executions:\s*(\d+)/i);
  return m ? Number(m[1]) : null;
};

const readExecutionsFile = () => {
  try {
    if (!fs.existsSync(executionsFile)) return null;
    const n = Number(fs.readFileSync(executionsFile, 'utf8').trim());
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  } catch {
    return null;
  }
};

const writeExecutionsFile = (n) => {
  try {
    fs.writeFileSync(executionsFile, String(n));
    return true;
  } catch {
    return false;
  }
};

const readSetup = () => {
  try {
    if (!fs.existsSync(setupFile)) return {};
    return JSON.parse(fs.readFileSync(setupFile, 'utf8'));
  } catch {
    return {};
  }
};

const writeSetup = (data) => {
  try {
    fs.writeFileSync(setupFile, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
};

const fetchVC = async (id) => {
  const c = await client.channels.fetch(id);
  return c?.isVoiceBased() ? c : null;
};

const renameChannel = async (c, n) => {
  const p = c.permissionsFor(client.user);
  if (!p?.has(PermissionFlagsBits.ManageChannels)) return false;
  await c.setName(n);
  return true;
};

const hasBlacklist = (t, bl) => {
  if (!t) return false;
  const l = t.toLowerCase();
  return bl.some(w => l.includes(w));
};

const checkMsg = (m, bl) => {
  if (hasBlacklist(m.content, bl)) return true;
  if (m.embeds?.length) {
    for (const e of m.embeds) {
      if (hasBlacklist(e.title, bl) || hasBlacklist(e.description, bl) || hasBlacklist(e.footer?.text, bl) || hasBlacklist(e.author?.name, bl)) return true;
      if (e.fields?.length) {
        for (const f of e.fields) {
          if (hasBlacklist(f.name, bl) || hasBlacklist(f.value, bl)) return true;
        }
      }
    }
  }
  return false;
};

const parseDuration = (s) => {
  const m = s.match(/^(\d+)([smhd])$/);
  if (!m) return null;
  const v = parseInt(m[1]);
  const u = m[2];
  const t = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return v * t[u];
};

const updateMembers = async () => {
  try {
    const c = await fetchVC(config.memberChannelId);
    if (!c) return;
    await c.guild.members.fetch();
    const count = c.guild.members.cache.filter(m => !m.user.bot).size;
    await renameChannel(c, `Member: ${count}`);
    console.log(`[Members] Updated member count to ${count}`);
  } catch (e) {
    console.log(`Member update failed: ${e.message}`);
  }
};

const restoreWebhook = async (wId, cId) => {
  try {
    const c = await client.channels.fetch(cId);
    if (!c) return;
    const whs = await c.fetchWebhooks();
    const wh = whs.get(wId);
    if (wh && wh.name !== 'Zenk') {
      await wh.edit({ name: 'Zenk' });
      console.log(`[Webhook] Restored webhook name to Zenk in #${c.name}`);
    }
  } catch (e) {
    console.log(`Restore webhook failed: ${e.message}`);
  }
};

const bulkDelete = async (c, ids) => {
  try {
    const v = ids.filter(id => id);
    if (!v.length) return;
    if (v.length === 1) {
      const m = await c.messages.fetch(v[0]).catch(() => null);
      if (m) await m.delete();
    } else {
      await c.bulkDelete(v, true);
    }
    console.log(`[Spam] Bulk deleted ${v.length} webhook messages in #${c.name}`);
  } catch (e) {
    console.log(`Bulk delete failed: ${e.message}`);
  }
};

// ----------------- READY -----------------
client.once('ready', async () => {
  console.log(`Bot online as ${client.user.tag}`);
  setupConfig = readSetup();
  
  try {
    const c = await fetchVC(config.channelId);
    if (!c) {
      console.log('[Executions] Voice channel not found or not voice-based');
    } else {
      const fromFile = readExecutionsFile();
      if (fromFile !== null) {
        executionCount = fromFile;
        await renameChannel(c, `Executions: ${executionCount}`);
        lastUpdate = Date.now();
        console.log(`[Executions] Loaded from file: ${executionCount}`);
      } else {
        const fromChannel = parseExecutions(c.name);
        executionCount = fromChannel ?? 0;
        writeExecutionsFile(executionCount);
        console.log(`[Executions] Initialized from channel or zero: ${executionCount}`);
      }
    }

    await updateMembers();
    setInterval(updateMembers, 600000);
  } catch (e) {
    console.log(`Ready error: ${e.message}`);
  }

  // Slash Commands bleiben wie zuvor (mute, unmute, setup, resetup) – ausgelassen um nicht nochmal alles zu duplizieren
  // Falls du willst, kann der Teil auch wieder vollständig eingesetzt werden.
});

// ----------------- MEMBER WELCOME -----------------
client.on('guildMemberAdd', async (member) => {
  await updateMembers();
  
  if (setupConfig.welcome) {
    try {
      const channel = await client.channels.fetch(setupConfig.welcome);
      if (channel) {
        console.log(`[Welcome] Sending welcome message for ${member.user.tag} in #${channel.name}`);
        await channel.send(`Welcome to **Zenk Studios**, ${member}`);
      }
    } catch (e) {
      console.log(`Welcome message failed: ${e.message}`);
    }
  }
});

client.on('guildMemberRemove', updateMembers);

// ----------------- MESSAGE / FILTER / SPAM -----------------
client.on('messageCreate', async (m) => {
  if (m.author.bot && !m.webhookId) return;
  try {
    if (m.webhookId) {
      const wId = m.webhookId;
      const now = Date.now();
      if (webhookCooldown.has(wId)) {
        if (now < webhookCooldown.get(wId)) {
          console.log(`[Spam] Deleted message during webhook cooldown in #${m.channel.name}`);
          await m.delete();
          return;
        } else {
          webhookCooldown.delete(wId);
          webhookTracker.delete(wId);
        }
      }
      if (m.author.username !== 'Zenk') {
        console.log(`[Webhook] Name mismatch (${m.author.username}) in #${m.channel.name} – deleting`);
        await m.delete();
        await restoreWebhook(wId, m.channelId);
        return;
      }
      if (checkMsg(m, BLACKLIST_WEBHOOK)) {
        console.log(`[Filter] Deleted webhook message with blacklisted word in #${m.channel.name}`);
        await m.delete();
        return;
      }
      if (!webhookTracker.has(wId)) webhookTracker.set(wId, []);
      const msgs = webhookTracker.get(wId);
      msgs.push({ timestamp: now, messageId: m.id });

      const recent = msgs.filter(msg => now - msg.timestamp < 8000);
      webhookTracker.set(wId, recent);

      if (recent.length >= 10) {
        console.log(`[Spam] Detected spam from webhook (${recent.length} msgs in 8s) in #${m.channel.name}`);
        await bulkDelete(m.channel, recent.map(msg => msg.messageId));
        webhookCooldown.set(wId, now + 30000);
        webhookTracker.set(wId, []);
        console.log('[Spam] Applied 30s cooldown for this webhook');
      }
    } else {
      if (checkMsg(m, BLACKLIST_USERS)) {
        console.log(`[Filter] Deleted user message with blacklisted word from ${m.author.tag} in #${m.channel.name}`);
        await m.delete();
        if (m.member?.moderatable) {
          try {
            await m.member.timeout(600000, 'Blacklisted word');
            console.log(`[Timeout] Timed out ${m.author.tag} for 10 minutes`);
          } catch (e) {
            console.log(`Timeout failed for ${m.author.tag}: ${e.message}`);
          }
        }
      }
    }
  } catch (e) {
    console.log(`Message check failed: ${e.message}`);
  }
});

// ----------------- DOWNLOAD TRACKER MIT COOLDOWN & LOGS -----------------
app.post('/track', async (req, res) => {
  downloadCount++;
  console.log(`[Downloads] /track called – new downloadCount = ${downloadCount}`);
  
  try {
    const now = Date.now();
    if (now - lastDownloadUpdate >= DOWNLOAD_UPDATE_COOLDOWN) {
      const channel = await client.channels.fetch(DOWNLOAD_CHANNEL_ID);
      if (!channel) {
        console.log('[Downloads] Download channel not found');
      } else {
        await channel.setName(`Downloads: ${downloadCount}`);
        lastDownloadUpdate = now;
        console.log(`[Downloads] Channel renamed to "Downloads: ${downloadCount}"`);
      }
    } else {
      const waitMs = DOWNLOAD_UPDATE_COOLDOWN - (now - lastDownloadUpdate);
      console.log(`[Downloads] Skipping rename (cooldown). Next rename in ${Math.round(waitMs / 1000)}s`);
    }
    res.sendStatus(200);
  } catch (error) {
    console.log(`[Downloads] Error while updating channel: ${error.message}`);
    res.sendStatus(500);
  }
});

// ----------------- EXECUTION API -----------------
app.post('/execution', async (req, res) => {
  try {
    executionCount++;
    writeExecutionsFile(executionCount);
    const now = Date.now();
    if (now - lastUpdate >= 8 * 60 * 1000) {
      const c = await fetchVC(config.channelId);
      if (c) {
        await renameChannel(c, `Executions: ${executionCount}`);
        lastUpdate = now;
        console.log(`[Executions] Channel renamed to Executions: ${executionCount}`);
      }
    } else {
      console.log('[Executions] Skipping rename due to cooldown');
    }
    res.json({
      success: true,
      count: executionCount,
      lastUpdate: lastUpdate > 0 ? new Date(lastUpdate).toISOString() : 'never'
    });
  } catch (e) {
    console.log(`Execution endpoint error: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ----------------- BASIC HEALTH CHECK -----------------
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    executions: executionCount,
    downloads: downloadCount,
    lastUpdate: lastUpdate > 0 ? new Date(lastUpdate).toISOString() : 'never',
    botReady: client.isReady()
  });
});

// ----------------- START -----------------
app.listen(config.port, () => console.log(`HTTP server running on port ${config.port}`));
client.login(config.token);
