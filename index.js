const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
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

const UPDATE_COOLDOWN = 8 * 60 * 1000;
const MEMBER_UPDATE_INTERVAL = 10 * 60 * 1000;
const WEBHOOK_SPAM_THRESHOLD = 10;
const WEBHOOK_SPAM_TIMEFRAME = 8000;
const SPAM_COOLDOWN_DURATION = 30000;
const TIMEOUT_DURATION = 10 * 60 * 1000;
const REQUIRED_WEBHOOK_NAME = 'Zenk';

const BLACKLIST_WEBHOOK = [
  'fuck', 'shit', 'bitch', 'ass', 'asshole', 'bastard', 'damn', 'cunt', 'dick', 'cock', 'pussy', 'whore', 'slut', 'fag', 'faggot', 'nigger', 'nigga', 'retard', 'retarded', 'rape', 'nazi', 'hitler', 'kys', 'kill yourself', 'motherfucker', 'bullshit', 'piss', 'prick', 'twat', 'wanker', 'bollocks', 'arse', 'tosser', 'bellend',
  'scheiße', 'scheisse', 'scheiß', 'scheiss', 'ficken', 'fick', 'arsch', 'arschloch', 'fotze', 'hure', 'nutte', 'wichser', 'hurensohn', 'bastard', 'schwuchtel', 'schwul', 'dumm', 'idiot', 'trottel', 'vollidiot', 'drecksau', 'sau', 'schwein', 'drecksschwein', 'miststück', 'pisser', 'kacke', 'scheisskerl', 'wixer', 'spast', 'mongo', 'behinderter', 'opfer', 'penner', 'dreckskerl', 'arschlecker', 'pissnelke', 'fotznbrädl', 'möse', 'pimmel', 'schwanz', 'leck mich', 'verpiss dich', 'halt die fresse', 'fresse', 'halt maul', 'maul'
];

const BLACKLIST_USERS = [
  'fuck', 'bitch', 'asshole', 'bastard', 'damn', 'cunt', 'dick', 'cock', 'pussy', 'whore', 'slut', 'fag', 'faggot', 'nigger', 'nigga', 'retard', 'retarded', 'rape', 'nazi', 'hitler', 'kys', 'kill yourself', 'motherfucker', 'bullshit', 'piss', 'prick', 'twat', 'wanker', 'bollocks', 'arse', 'tosser', 'bellend',
  'scheiße', 'scheisse', 'scheiß', 'scheiss', 'ficken', 'fick', 'arsch', 'arschloch', 'fotze', 'hure', 'nutte', 'wichser', 'hurensohn', 'bastard', 'schwuchtel', 'schwul', 'dumm', 'idiot', 'trottel', 'vollidiot', 'drecksau', 'sau', 'schwein', 'drecksschwein', 'miststück', 'pisser', 'kacke', 'scheisskerl', 'wixer', 'spast', 'mongo', 'behinderter', 'opfer', 'penner', 'dreckskerl', 'arschlecker', 'pissnelke', 'fotznbrädl', 'möse', 'pimmel', 'schwanz', 'leck mich', 'verpiss dich', 'halt die fresse', 'fresse', 'halt maul', 'maul'
];

let executionCount = 0;
let lastUpdate = 0;
const executionsFile = path.join(__dirname, 'Executions.txt');
const webhookMessageTracker = new Map();
const webhookSpamCooldown = new Map();

function parseExecutionsFromChannelName(name) {
  const m = String(name || '').match(/Executions:\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

function readExecutionsFile() {
  try {
    if (!fs.existsSync(executionsFile)) return null;
    const raw = fs.readFileSync(executionsFile, 'utf8').trim();
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  } catch {}
  return null;
}

function writeExecutionsFile(n) {
  try {
    fs.writeFileSync(executionsFile, String(n));
    return true;
  } catch {
    return false;
  }
}

async function fetchChannel(channelId) {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isVoiceBased()) return null;
  return channel;
}

async function renameChannelSafe(channel, newName) {
  const perms = channel.permissionsFor(client.user);
  if (!perms || !perms.has(PermissionFlagsBits.ManageChannels)) return false;
  await channel.setName(newName);
  return true;
}

async function updateMemberCount() {
  try {
    const memberChannel = await fetchChannel(config.memberChannelId);
    if (!memberChannel) return;
    const guild = memberChannel.guild;
    await guild.members.fetch();
    const nonBotMembers = guild.members.cache.filter(m => !m.user.bot).size;
    await renameChannelSafe(memberChannel, `Member: ${nonBotMembers}`);
    console.log(`Updated member count: ${nonBotMembers}`);
  } catch (e) {
    console.log(`Member count update failed: ${e.message}`);
  }
}

async function restoreWebhookName(webhookId, channelId) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return;
    const webhooks = await channel.fetchWebhooks();
    const webhook = webhooks.get(webhookId);
    if (webhook && webhook.name !== REQUIRED_WEBHOOK_NAME) {
      await webhook.edit({ name: REQUIRED_WEBHOOK_NAME });
      console.log(`Restored webhook name to: ${REQUIRED_WEBHOOK_NAME}`);
    }
  } catch (e) {
    console.log(`Failed to restore webhook: ${e.message}`);
  }
}

function containsBlacklistedWord(text, blacklist) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  return blacklist.some(word => lowerText.includes(word));
}

function checkMessageForBlacklist(message, blacklist) {
  if (containsBlacklistedWord(message.content, blacklist)) return true;
  
  if (message.embeds && message.embeds.length > 0) {
    for (const embed of message.embeds) {
      if (containsBlacklistedWord(embed.title, blacklist)) return true;
      if (containsBlacklistedWord(embed.description, blacklist)) return true;
      if (containsBlacklistedWord(embed.footer?.text, blacklist)) return true;
      if (containsBlacklistedWord(embed.author?.name, blacklist)) return true;
      
      if (embed.fields && embed.fields.length > 0) {
        for (const field of embed.fields) {
          if (containsBlacklistedWord(field.name, blacklist)) return true;
          if (containsBlacklistedWord(field.value, blacklist)) return true;
        }
      }
    }
  }
  
  return false;
}

async function bulkDeleteWebhookMessages(channel, messageIds) {
  try {
    const validIds = messageIds.filter(id => id);
    if (validIds.length === 0) return;
    
    if (validIds.length === 1) {
      const msg = await channel.messages.fetch(validIds[0]).catch(() => null);
      if (msg) await msg.delete();
    } else {
      await channel.bulkDelete(validIds, true);
    }
    console.log(`Bulk deleted ${validIds.length} webhook messages`);
  } catch (e) {
    console.log(`Bulk delete failed: ${e.message}`);
  }
}

client.once('ready', async () => {
  console.log(`Bot online as ${client.user.tag}`);
  try {
    const channel = await fetchChannel(config.channelId);
    if (!channel) return;

    const fromFile = readExecutionsFile();
    if (fromFile !== null) {
      executionCount = fromFile;
      console.log(`Loaded from Executions.txt: ${executionCount}`);
      await renameChannelSafe(channel, `Executions: ${executionCount}`);
      lastUpdate = Date.now();
    } else {
      const fromChannel = parseExecutionsFromChannelName(channel.name);
      executionCount = fromChannel !== null ? fromChannel : 0;
      writeExecutionsFile(executionCount);
      console.log(`Set executions to: ${executionCount}`);
    }

    await updateMemberCount();
    setInterval(updateMemberCount, MEMBER_UPDATE_INTERVAL);
  } catch (e) {
    console.log(`Ready error: ${e.message}`);
  }
});

client.on('guildMemberAdd', updateMemberCount);
client.on('guildMemberRemove', updateMemberCount);

client.on('messageCreate', async (message) => {
  if (message.author.bot && !message.webhookId) return;

  try {
    if (message.webhookId) {
      const webhookId = message.webhookId;
      const now = Date.now();

      if (webhookSpamCooldown.has(webhookId)) {
        const cooldownEnd = webhookSpamCooldown.get(webhookId);
        if (now < cooldownEnd) {
          await message.delete();
          console.log(`Deleted: Webhook in spam cooldown`);
          return;
        } else {
          webhookSpamCooldown.delete(webhookId);
          webhookMessageTracker.delete(webhookId);
        }
      }
      
      if (message.author.username !== REQUIRED_WEBHOOK_NAME) {
        await message.delete();
        console.log(`Deleted: Webhook name mismatch (${message.author.username})`);
        await restoreWebhookName(webhookId, message.channelId);
        return;
      }

      if (checkMessageForBlacklist(message, BLACKLIST_WEBHOOK)) {
        await message.delete();
        console.log(`Deleted: Webhook blacklisted word detected`);
        return;
      }

      if (!webhookMessageTracker.has(webhookId)) webhookMessageTracker.set(webhookId, []);
      const messages = webhookMessageTracker.get(webhookId);
      messages.push({ timestamp: now, messageId: message.id });

      const recentMessages = messages.filter(msg => now - msg.timestamp < WEBHOOK_SPAM_TIMEFRAME);
      webhookMessageTracker.set(webhookId, recentMessages);

      if (recentMessages.length >= WEBHOOK_SPAM_THRESHOLD) {
        console.log(`Spam detected: ${recentMessages.length} msgs in 8s - activating spam protection`);
        
        const messageIdsToDelete = recentMessages.map(m => m.messageId);
        await bulkDeleteWebhookMessages(message.channel, messageIdsToDelete);
        
        webhookSpamCooldown.set(webhookId, now + SPAM_COOLDOWN_DURATION);
        webhookMessageTracker.set(webhookId, []);
        
        console.log(`Webhook spam cooldown activated for 30s`);
      }
    } else {
      if (checkMessageForBlacklist(message, BLACKLIST_USERS)) {
        await message.delete();
        
        const member = message.member;
        if (member && member.moderatable) {
          try {
            await member.timeout(TIMEOUT_DURATION, 'Used blacklisted word');
            console.log(`Timed out user ${message.author.tag} for 10 minutes`);
          } catch (e) {
            console.log(`Failed to timeout ${message.author.tag}: ${e.message}`);
          }
        }
        
        console.log(`Deleted: User blacklisted word detected from ${message.author.tag}`);
      }
    }
  } catch (e) {
    console.log(`Message check failed: ${e.message}`);
  }
});

client.on('webhookUpdate', async (channel) => {
  try {
    const webhooks = await channel.fetchWebhooks();
    webhooks.forEach(async (webhook) => {
      if (webhook.name !== REQUIRED_WEBHOOK_NAME) {
        await webhook.edit({ name: REQUIRED_WEBHOOK_NAME });
        console.log(`Auto-restored webhook name in #${channel.name}`);
      }
    });
  } catch (e) {
    console.log(`Webhook update check failed: ${e.message}`);
  }
});

app.post('/execution', async (req, res) => {
  try {
    executionCount++;
    writeExecutionsFile(executionCount);
    const now = Date.now();
    if (now - lastUpdate >= UPDATE_COOLDOWN) {
      const channel = await fetchChannel(config.channelId);
      if (channel) {
        await renameChannelSafe(channel, `Executions: ${executionCount}`);
        lastUpdate = Date.now();
      }
    }
    res.json({ success: true, count: executionCount, lastUpdate: lastUpdate > 0 ? new Date(lastUpdate).toISOString() : 'never' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/export', async (req, res) => {
  try {
    const channel = await fetchChannel(config.channelId);
    if (!channel) return res.status(404).type('text/plain').send('0');
    const n = parseExecutionsFromChannelName(channel.name);
    if (n === null) return res.type('text/plain').send('0');
    writeExecutionsFile(n);
    res.type('text/plain').send(String(n));
  } catch {
    res.status(500).type('text/plain').send(String(executionCount));
  }
});

app.post('/import', async (req, res) => {
  const n = Number(req.body && req.body.count);
  if (!Number.isFinite(n) || n < 0) return res.status(400).json({ success: false });
  executionCount = Math.floor(n);
  writeExecutionsFile(executionCount);
  try {
    const channel = await fetchChannel(config.channelId);
    if (channel) {
      await renameChannelSafe(channel, `Executions: ${executionCount}`);
      lastUpdate = Date.now();
    }
  } catch {}
  res.json({ success: true, count: executionCount });
});

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    executions: executionCount,
    lastUpdate: lastUpdate > 0 ? new Date(lastUpdate).toISOString() : 'never',
    botReady: client.isReady()
  });
});

app.listen(config.port, () => console.log(`Server running on port ${config.port}`));
client.login(config.token);
