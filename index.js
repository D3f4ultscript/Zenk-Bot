const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

const app = express();
app.use(express.json());

const UPDATE_COOLDOWN = 2 * 60 * 1000;
const MEMBER_UPDATE_INTERVAL = 10 * 60 * 1000;

let executionCount = 0;
let lastUpdate = 0;

const executionsFile = path.join(__dirname, 'Executions.txt');

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
  if (!channel) return null;
  if (!channel.isVoiceBased()) return null;
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
    if (!memberChannel) {
      console.log('Member channel not found');
      return;
    }

    const guild = memberChannel.guild;
    await guild.members.fetch();
    
    const nonBotMembers = guild.members.cache.filter(member => !member.user.bot).size;
    
    await renameChannelSafe(memberChannel, `Member: ${nonBotMembers}`);
    console.log(`Updated member count: ${nonBotMembers}`);
  } catch (e) {
    console.log(`Member count update failed: ${e.message}`);
  }
}

client.once('ready', async () => {
  console.log(`Bot online as ${client.user.tag}`);
  
  try {
    const channel = await fetchChannel(config.channelId);
    if (!channel) {
      console.log('Channel not found / not voice');
      return;
    }

    const fromFile = readExecutionsFile();
    if (fromFile !== null) {
      executionCount = fromFile;
      console.log(`Loaded from Executions.txt: ${executionCount}`);
      try {
        await renameChannelSafe(channel, `Executions: ${executionCount}`);
        lastUpdate = Date.now();
      } catch (e) {
        console.log(`Rename on ready failed: ${e.message}`);
      }
      
      await updateMemberCount();
      setInterval(updateMemberCount, MEMBER_UPDATE_INTERVAL);
      return;
    }

    const fromChannel = parseExecutionsFromChannelName(channel.name);
    if (fromChannel !== null) {
      executionCount = fromChannel;
      writeExecutionsFile(executionCount);
      console.log(`Saved from channel name into Executions.txt: ${executionCount}`);
    } else {
      executionCount = 0;
      writeExecutionsFile(executionCount);
      console.log('No number in channel name, set to 0');
    }

    await updateMemberCount();
    setInterval(updateMemberCount, MEMBER_UPDATE_INTERVAL);
  } catch (e) {
    console.log(`Ready error: ${e.message}`);
  }
});

client.on('guildMemberAdd', async () => {
  await updateMemberCount();
});

client.on('guildMemberRemove', async () => {
  await updateMemberCount();
});

app.post('/execution', async (req, res) => {
  try {
    executionCount++;
    writeExecutionsFile(executionCount);

    const now = Date.now();
    if (now - lastUpdate >= UPDATE_COOLDOWN) {
      try {
        const channel = await fetchChannel(config.channelId);
        if (channel) {
          await renameChannelSafe(channel, `Executions: ${executionCount}`);
          lastUpdate = Date.now();
        }
      } catch (e) {
        console.log(`Rename failed: ${e.message}`);
      }
    }

    res.json({
      success: true,
      count: executionCount,
      lastUpdate: lastUpdate > 0 ? new Date(lastUpdate).toISOString() : 'never'
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/export', async (req, res) => {
  try {
    const channel = await fetchChannel(config.channelId);
    if (!channel) {
      res.status(404).type('text/plain').send('0');
      return;
    }

    const n = parseExecutionsFromChannelName(channel.name);
    if (n === null) {
      res.type('text/plain').send('0');
      return;
    }

    writeExecutionsFile(n);
    res.type('text/plain').send(String(n));
  } catch {
    res.status(500).type('text/plain').send(String(executionCount));
  }
});

app.post('/import', async (req, res) => {
  const n = Number(req.body && req.body.count);
  if (!Number.isFinite(n) || n < 0) {
    res.status(400).json({ success: false });
    return;
  }

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

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});

client.login(config.token);
