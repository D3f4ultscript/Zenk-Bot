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
const REQUIRED_WEBHOOK_NAME = 'Zenk';

let executionCount = 0;
let lastUpdate = 0;
const executionsFile = path.join(__dirname, 'Executions.txt');
const webhookMessageTracker = new Map();

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
  if (!message.webhookId) return;

  try {
    const webhookId = message.webhookId;
    const now = Date.now();
    
    if (message.author.username !== REQUIRED_WEBHOOK_NAME) {
      await message.delete();
      console.log(`Deleted: Webhook name mismatch (${message.author.username})`);
      await restoreWebhookName(webhookId, message.channelId);
      return;
    }

    if (!webhookMessageTracker.has(webhookId)) webhookMessageTracker.set(webhookId, []);
    const messages = webhookMessageTracker.get(webhookId);
    messages.push({ timestamp: now, messageId: message.id });

    const recentMessages = messages.filter(msg => now - msg.timestamp < WEBHOOK_SPAM_TIMEFRAME);
    webhookMessageTracker.set(webhookId, recentMessages);

    if (recentMessages.length >= WEBHOOK_SPAM_THRESHOLD) {
      await message.delete();
      console.log(`Deleted: Webhook spam (${recentMessages.length} msgs in 8s)`);
      webhookMessageTracker.set(webhookId, []);
    }
  } catch (e) {
    console.log(`Webhook check failed: ${e.message}`);
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
