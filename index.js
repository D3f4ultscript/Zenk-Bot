// ==========================================
// DEPENDENCIES & CLIENT SETUP
// ==========================================
const { Client, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder, REST, Routes, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { MongoClient } = require('mongodb');
require('dotenv').config();

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

// ==========================================
// MONGODB CONNECTION
// ==========================================
const mongoUri = process.env.MONGODB_URI;
let mongoClient = null;
let db = null;

const connectMongoDB = async () => {
  try {
    if (mongoClient) return; // Already connected
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    db = mongoClient.db('zenk_bot');
    console.log('✅ MongoDB connected');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
  }
};

const saveUserData = async (userId, guildId, xp, level) => {
  if (!db) return;
  try {
    const collection = db.collection('users');
    await collection.updateOne(
      { userId, guildId },
      { $set: { xp, level, lastUpdated: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error('Error saving user data:', error.message);
  }
};

const getUserData = async (userId, guildId) => {
  if (!db) return { xp: 0, level: 1 };
  try {
    const collection = db.collection('users');
    const user = await collection.findOne({ userId, guildId });
    return user || { xp: 0, level: 1 };
  } catch (error) {
    console.error('Error getting user data:', error.message);
    return { xp: 0, level: 1 };
  }
};

// ==========================================
// CONFIGURATION & IDS
// ==========================================
const IDS = {
  staff: '1454608694850486313',
  log: '1456977089864400970',
  tradeExcluded: '1455105607332925553',
  bypass: '1453892506801541201',
  antiBypass: '1454089114348425348',
  linkAllowed2: '1454774839519875123',
  levelUpChannel: '1462009992285786253'
};

const LEVEL_ROLES = {
  5: '1462009324963500084',
  10: '1462009409889632326',
  15: '1462009434791350417',
  20: '1462009456899526716',
  25: '1462009479854952620',
  30: '1462009514675929293'
};

const TIMEOUTS = { 
  spam: 300000, 
  linkBlock: 300000, 
  blacklist: 300000 
};

const BLACKLIST = [
  'bitch', 'asshole', 'bastard', 'cunt', 'cock', 'pussy', 'whore', 'slut', 
  'fag', 'faggot', 'nigger', 'nigga', 'retard', 'retarded', 'rape', 'nazi', 
  'hitler', 'kill yourself', 'motherfucker', 'bullshit', 'prick', 'twat', 
  'wanker', 'bollocks', 'scheiße', 'scheisse', 'scheiß', 'scheiss', 'ficken', 
  'fick', 'arschloch', 'fotze', 'hure', 'nutte', 'wichser', 'hurensohn', 
  'schwuchtel', 'schwul', 'drecksau', 'sau', 'schwein', 'drecksschwein', 
  'miststück', 'kacke', 'möse', 'pimmel', 'schwanz', 'leck mich', 'verpiss dich'
];

const PHISHING_DOMAINS = [
  'discord-nitro', 'steamcommunity-trade', 'free-nitro', 'steamcommunitty', 
  'discordapp-gift', 'discordgift', 'grabify.link', 'iplogger.org', 
  'blasze.tk', 'freegiftcodes'
];

// ==========================================
// FILE PATHS
// ==========================================
const executionsFile = path.join(__dirname, 'Executions.txt');
const setupFile = path.join(__dirname, 'Setup.json');
const levelsFile = path.join(__dirname, 'Levels.json');

// ==========================================
// GLOBAL STATE & TRACKERS
// ==========================================
const webhookTracker = new Map();
const webhookCooldown = new Map();
const activeTickets = new Map();
const messageHistory = new Map();
const userSpamTracker = new Map();
const autoClearChannels = new Map();
let setupConfig = {};
let executionCount = 0;
let memberCount = 0;
let lastUpdate = 0;

// ==========================================
// FILE SYSTEM HELPERS
// ==========================================
const readExecutions = () => {
  try {
    if (!fs.existsSync(executionsFile)) return 0;
    const n = Number(fs.readFileSync(executionsFile, 'utf8').trim());
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
};

const writeExecutions = (n) => {
  try {
    fs.writeFileSync(executionsFile, String(n));
  } catch {}
};

const readSetup = () => {
  try {
    if (!fs.existsSync(setupFile)) return {};
    return JSON.parse(fs.readFileSync(setupFile, 'utf8'));
  } catch {
    return {};
  }
};

const writeSetup = (d) => {
  try {
    fs.writeFileSync(setupFile, JSON.stringify(d, null, 2));
  } catch {}
};

// ==========================================
// LEVEL SYSTEM HELPERS
// ==========================================
const readLevels = async () => {
  // Try MongoDB first
  if (db) {
    try {
      const collection = db.collection('userLevels');
      const docs = await collection.find({}).toArray();
      const result = {};
      for (const doc of docs) {
        result[doc.key] = { exp: doc.exp, lastMessage: doc.lastMessage, lastReaction: doc.lastReaction };
      }
      return result;
    } catch (error) {
      console.error('Error reading levels from MongoDB:', error.message);
    }
  }
  
  // Fallback to file
  try {
    if (!fs.existsSync(levelsFile)) return {};
    return JSON.parse(fs.readFileSync(levelsFile, 'utf8'));
  } catch {
    return {};
  }
};

const writeLevels = async (d) => {
  // Save to MongoDB if available
  if (db) {
    try {
      const collection = db.collection('userLevels');
      for (const [key, data] of Object.entries(d)) {
        await collection.updateOne(
          { key },
          { $set: { exp: data.exp, lastMessage: data.lastMessage, lastReaction: data.lastReaction } },
          { upsert: true }
        );
      }
    } catch (error) {
      console.error('Error writing levels to MongoDB:', error.message);
    }
  }
  
  // Also save to file for backup
  try {
    fs.writeFileSync(levelsFile, JSON.stringify(d, null, 2));
  } catch {}
};

// Level calculation: EXP needed for level = 100 * level^1.5
const getExpForLevel = (level) => {
  return Math.floor(100 * Math.pow(level, 1.5));
};

const getLevel = (exp) => {
  let level = 1;
  let totalExp = 0;
  while (totalExp + getExpForLevel(level) <= exp) {
    totalExp += getExpForLevel(level);
    level++;
  }
  return level;
};

const getTotalExpForLevel = (level) => {
  let total = 0;
  for (let i = 1; i < level; i++) {
    total += getExpForLevel(i);
  }
  return total;
};

const getExpInCurrentLevel = (exp, level) => {
  const totalExpForCurrentLevel = getTotalExpForLevel(level);
  return exp - totalExpForCurrentLevel;
};

const getExpNeededForNextLevel = (level) => {
  return getExpForLevel(level);
};

const addExp = async (userId, guildId, amount, reason = 'message') => {
  const levels = await readLevels();
  const key = `${guildId}_${userId}`;
  
  if (!levels[key]) {
    levels[key] = { exp: 0, lastMessage: 0, lastReaction: 0 };
  }
  
  // Cooldown: 5 seconds for messages, 30 seconds for reactions
  const now = Date.now();
  if (reason === 'message') {
    if (now - levels[key].lastMessage < 5000) return { skipped: true }; // 5s cooldown
    levels[key].lastMessage = now;
  } else if (reason === 'reaction') {
    if (now - levels[key].lastReaction < 30000) return { skipped: true }; // 30s cooldown
    levels[key].lastReaction = now;
  }
  
  const oldExp = levels[key].exp;
  const oldLevel = getLevel(oldExp);
  
  levels[key].exp += amount;
  const newExp = levels[key].exp;
  const newLevel = getLevel(newExp);
  
  await writeLevels(levels);
  await saveUserData(userId, guildId, newExp, newLevel);
  
  // Check for level up
  if (newLevel > oldLevel) {
    console.log(`${userId} leveled up: ${oldLevel} -> ${newLevel}`);
    await handleLevelUp(userId, guildId, newLevel, oldLevel);
  }
  
  return { exp: newExp, level: newLevel, leveledUp: newLevel > oldLevel };
};

const handleLevelUp = async (userId, guildId, newLevel, oldLevel) => {
  try {
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      console.log(`Could not fetch member ${userId} in guild ${guildId}`);
      return;
    }
    
    // Remove old level roles first
    for (const [level, roleId] of Object.entries(LEVEL_ROLES)) {
      if (parseInt(level) < newLevel && member.roles.cache.has(roleId)) {
        const oldRole = await guild.roles.fetch(roleId).catch(() => null);
        if (oldRole) {
          await member.roles.remove(oldRole, `Level up - removed old level role`).catch((e) => {
            console.log(`Could not remove old role ${roleId}:`, e.message);
          });
        }
      }
    }
    
    // Give new level role if exists
    if (LEVEL_ROLES[newLevel]) {
      const role = await guild.roles.fetch(LEVEL_ROLES[newLevel]).catch(() => null);
      if (role) {
        await member.roles.add(role, `Level ${newLevel} reward`).catch((e) => {
          console.log(`Could not add role ${LEVEL_ROLES[newLevel]}:`, e.message);
        });
      } else {
        console.log(`Role ${LEVEL_ROLES[newLevel]} not found for level ${newLevel}`);
      }
    }
    
    // Send level up message
    const levelUpChannel = await client.channels.fetch(IDS.levelUpChannel).catch(() => null);
    if (levelUpChannel) {
      await levelUpChannel.send(`${member} **leveled up to level ${newLevel}**! 🎉`).catch((e) => {
        console.log(`Could not send levelup message:`, e.message);
      });
    } else {
      console.log(`Level up channel ${IDS.levelUpChannel} not found`);
    }
  } catch (error) {
    console.error('Error handling level up:', error);
  }
};

const setUserExp = async (userId, guildId, exp, reason = 'Manual adjustment') => {
  const levels = await readLevels();
  const key = `${guildId}_${userId}`;
  
  if (!levels[key]) {
    levels[key] = { exp: 0, lastMessage: 0, lastReaction: 0 };
  }
  
  const oldExp = levels[key].exp;
  const oldLevel = getLevel(oldExp);
  
  levels[key].exp = Math.max(0, exp); // Ensure EXP doesn't go below 0
  const newExp = levels[key].exp;
  const newLevel = getLevel(newExp);
  
  await writeLevels(levels);
  await saveUserData(userId, guildId, newExp, newLevel);
  
  // Check for level up/down and update roles
  if (newLevel !== oldLevel) {
    try {
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member) {
        // Remove old level roles
        for (const [level, roleId] of Object.entries(LEVEL_ROLES)) {
          if (member.roles.cache.has(roleId)) {
            const role = await guild.roles.fetch(roleId).catch(() => null);
            if (role) await member.roles.remove(role, reason).catch(() => {});
          }
        }
        
        // Add new level role if exists
        if (LEVEL_ROLES[newLevel]) {
          const role = await guild.roles.fetch(LEVEL_ROLES[newLevel]).catch(() => null);
          if (role) await member.roles.add(role, reason).catch(() => {});
        }
      }
    } catch (error) {
      console.error('Error updating roles:', error);
    }
  }
  
  return { exp: newExp, level: newLevel, oldLevel, leveledUp: newLevel > oldLevel };
};

const addUserExp = async (userId, guildId, amount) => {
  const levels = await readLevels();
  const key = `${guildId}_${userId}`;
  
  if (!levels[key]) {
    levels[key] = { exp: 0, lastMessage: 0, lastReaction: 0 };
  }
  
  const oldExp = levels[key].exp;
  const newExp = oldExp + amount;
  
  return await setUserExp(userId, guildId, newExp, 'Admin added EXP');
};

const removeUserExp = async (userId, guildId, amount) => {
  const levels = await readLevels();
  const key = `${guildId}_${userId}`;
  
  if (!levels[key]) {
    levels[key] = { exp: 0, lastMessage: 0, lastReaction: 0 };
  }
  
  const oldExp = levels[key].exp;
  const newExp = Math.max(0, oldExp - amount);
  
  return await setUserExp(userId, guildId, newExp, 'Admin removed EXP');
};

const setUserLevel = async (userId, guildId, targetLevel) => {
  const totalExp = getTotalExpForLevel(targetLevel);
  return await setUserExp(userId, guildId, totalExp, `Admin set level to ${targetLevel}`);
};

// ==========================================
// DISCORD HELPERS
// ==========================================
const renameChannel = async (c, n) => {
  try {
    if (c.permissionsFor(client.user)?.has(PermissionFlagsBits.ManageChannels)) {
      await c.setName(n);
    }
  } catch {}
};

const sendLog = async (e) => {
  try {
    const c = await client.channels.fetch(IDS.log);
    if (c) await c.send({ embeds: [e] });
  } catch {}
};

const bulkDelete = async (c, ids) => {
  try {
    const v = ids.filter(Boolean);
    if (!v.length) return;
    if (v.length === 1) {
      const m = await c.messages.fetch(v[0]).catch(() => null);
      if (m) await m.delete();
    } else {
      await c.bulkDelete(v, true);
    }
  } catch {}
};

// ==========================================
// PERMISSION & BYPASS SYSTEM
// ==========================================
const checkBypass = (m) => {
  if (m.webhookId) return false;
  if (!m.member?.roles?.cache) return false;
  const hasB = m.member.roles.cache.has(IDS.bypass);
  const hasAB = m.member.roles.cache.has(IDS.antiBypass);
  return hasB && !hasAB;
};

// ==========================================
// MODERATION HELPERS
// ==========================================
const hasBlacklist = (t, bl) => {
  if (!t) return false;
  const l = t.toLowerCase();
  return bl.some(w => l.includes(w));
};

const checkMsg = (m) => {
  if (hasBlacklist(m.content, BLACKLIST)) return true;
  if (m.embeds?.length) {
    for (const e of m.embeds) {
      if (hasBlacklist(e.title, BLACKLIST) || 
          hasBlacklist(e.description, BLACKLIST) || 
          hasBlacklist(e.footer?.text, BLACKLIST) || 
          hasBlacklist(e.author?.name, BLACKLIST)) return true;
      if (e.fields?.length) {
        for (const f of e.fields) {
          if (hasBlacklist(f.name, BLACKLIST) || hasBlacklist(f.value, BLACKLIST)) return true;
        }
      }
    }
  }
  return false;
};

const parseDuration = (s) => {
  const m = s.match(/^(\d+)([smhd])$/);
  if (!m) return null;
  const v = parseInt(m[1]), u = m[2];
  return v * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[u];
};

// ==========================================
// WEBHOOK PROTECTION SYSTEM
// ==========================================
const restoreWebhook = async (wId, cId) => {
  try {
    const c = await client.channels.fetch(cId);
    if (!c) return;
    const whs = await c.fetchWebhooks();
    const wh = whs.get(wId);
    if (wh && wh.name !== 'Zenk') await wh.edit({ name: 'Zenk' });
  } catch {}
};

// ==========================================
// CHANNEL STATS UPDATER
// ==========================================
const updateCountsChannels = async () => {
  try {
    const ec = await client.channels.fetch(config.channelId);
    if (ec) await renameChannel(ec, `Executions: ${executionCount}`);
    
    const mc = await client.channels.fetch(config.memberChannelId);
    if (mc) {
      try {
        await mc.guild.members.fetch({ limit: null });
      } catch (e) {
        console.error('Error fetching members:', e.message);
      }
      // Zähle nur echte Member (OHNE Bots)
      memberCount = mc.guild.members.cache.filter(m => !m.user.bot).size;
      await renameChannel(mc, `Member: ${memberCount}`);
    }
  } catch (error) {
    console.error('Error updating counts:', error.message);
  }
};

// ==========================================
// TICKET SYSTEM - INFRASTRUCTURE
// ==========================================
const ensureTicketInfra = async (guild, hintChannel) => {
  if (setupConfig.ticketCategory) {
    const cat = await guild.channels.fetch(setupConfig.ticketCategory).catch(() => null);
    if (cat && cat.type === ChannelType.GuildCategory) return cat;
  }
  
  let cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === '</> Tickets </>');
  if (!cat) {
    cat = await guild.channels.create({
      name: '</> Tickets </>',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: IDS.staff, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels] }
      ]
    }).catch(() => null);
  }
  if (!cat) return null;

  if (!setupConfig.ticketLogs) {
    let logs = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === 'ticket-logs');
    if (!logs) {
      logs = await guild.channels.create({
        name: 'ticket-logs',
        type: ChannelType.GuildText,
        parent: hintChannel?.parentId ?? null,
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: IDS.staff, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
        ]
      }).catch(() => null);
    }
    if (logs) setupConfig.ticketLogs = logs.id;
  }

  setupConfig.ticketCategory = cat.id;
  writeSetup(setupConfig);
  return cat;
};

// ==========================================
// AUTOCLEAR SYSTEM
// ==========================================
const autoClearLoop = async (cId) => {
  try {
    const c = await client.channels.fetch(cId).catch(() => null);
    if (!c?.isTextBased()) return;
    
    const msgs = await c.messages.fetch({ limit: 100 }).catch(() => null);
    if (!msgs?.size) return;

    const guild = c.guild;
    const needFetch = new Set();
    for (const m of msgs.values()) {
      if (!m.author.bot && !m.webhookId && !m.member) needFetch.add(m.author.id);
    }
    if (needFetch.size) await guild.members.fetch({ user: [...needFetch] }).catch(() => {});

    const del = [];
    for (const m of msgs.values()) {
      if (m.author.bot || m.webhookId) {
        del.push(m.id);
        continue;
      }
      if (!checkBypass(m)) del.push(m.id);
    }
    if (del.length) await bulkDelete(c, del);
  } catch {}
};

const startAutoClear = (cId) => {
  if (autoClearChannels.has(cId)) return false;
  autoClearChannels.set(cId, setInterval(() => autoClearLoop(cId), 5000));
  return true;
};

const stopAutoClear = (cId) => {
  if (!autoClearChannels.has(cId)) return false;
  clearInterval(autoClearChannels.get(cId));
  autoClearChannels.delete(cId);
  return true;
};

// ==========================================
// BOT READY EVENT
// ==========================================
client.once('ready', async () => {
  console.log('Bot ready');
  await connectMongoDB(); // Connect to MongoDB
  setupConfig = readSetup();
  executionCount = readExecutions();
  await updateCountsChannels();
  // Aktualisiere Counts alle 60 Sekunden (Discord Rate Limit ist kein Problem)
  setInterval(updateCountsChannels, 60000);

  const commands = [
    new SlashCommandBuilder()
      .setName('mute')
      .setDescription('Timeout a user')
      .addUserOption(o => o.setName('user').setDescription('User to timeout').setRequired(true))
      .addStringOption(o => o.setName('duration').setDescription('Duration (e.g., 10s, 5m, 1h, 2d)').setRequired(true)),
    
    new SlashCommandBuilder()
      .setName('unmute')
      .setDescription('Remove timeout from a user')
      .addUserOption(o => o.setName('user').setDescription('User to unmute').setRequired(true)),
    
    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Setup bot features')
      .addStringOption(o => o.setName('feature').setDescription('Feature to setup').setRequired(true)
        .addChoices({ name: 'Tickets', value: 'tickets' }, { name: 'Welcome', value: 'welcome' }))
      .addChannelOption(o => o.setName('channel').setDescription('Channel for the feature').setRequired(true)
        .addChannelTypes(ChannelType.GuildText)),
    
    new SlashCommandBuilder()
      .setName('resetup')
      .setDescription('Remove bot setup')
      .addStringOption(o => o.setName('feature').setDescription('Feature to remove').setRequired(true)
        .addChoices({ name: 'Tickets', value: 'tickets' }, { name: 'Welcome', value: 'welcome' })),
    
    new SlashCommandBuilder()
      .setName('clear')
      .setDescription('Clear messages in this channel')
      .addIntegerOption(o => o.setName('amount').setDescription('Number of messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
      .addUserOption(o => o.setName('user').setDescription('Only delete messages from this user').setRequired(false)),
    
    new SlashCommandBuilder()
      .setName('autoclear')
      .setDescription('Start auto-clearing messages in this channel'),
    
    new SlashCommandBuilder()
      .setName('autoclearoff')
      .setDescription('Stop auto-clearing messages in this channel'),
    
    new SlashCommandBuilder()
      .setName('lock')
      .setDescription('Lock the channel so only staff can write'),
    
    new SlashCommandBuilder()
      .setName('unlock')
      .setDescription('Unlock the channel'),
    
    new SlashCommandBuilder()
      .setName('level')
      .setDescription('Check your level and experience')
      .addUserOption(o => o.setName('user').setDescription('Check another user\'s level').setRequired(false))
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  } catch {}
});

// ==========================================
// MEMBER JOIN/LEAVE EVENTS
// ==========================================
client.on('guildMemberAdd', async (m) => {
  await updateCountsChannels();
  if (setupConfig.welcome) {
    try {
      const c = await client.channels.fetch(setupConfig.welcome);
      if (c) await c.send(`Welcome to **Zenk Studios**, ${m}`);
    } catch {}
  }
});

client.on('guildMemberRemove', async (m) => {
  await updateCountsChannels();
});

// ==========================================
// MESSAGE MODERATION SYSTEM
// ==========================================
client.on('messageCreate', async (m) => {
  // LEVEL SYSTEM: Add EXP for messages FIRST - before any other processing (skip bots, webhooks, DMs)
  if (m.guild && !m.author.bot && !m.webhookId) {
    try {
      const expAmount = Math.floor(Math.random() * 15) + 15; // 15-30 EXP per message
      const result = await addExp(m.author.id, m.guild.id, expAmount, 'message').catch(e => {
        console.error(`Error adding EXP to ${m.author.id}:`, e);
        return null;
      });
      if (result && !result.skipped) {
        console.log(`✓ ${m.author.tag} gained ${expAmount} EXP (Total: ${result.exp}, Level: ${result.level})`);
      }
    } catch (e) {
      console.error('Error in EXP system:', e);
    }
  }

  const bypass = checkBypass(m);
  const now = Date.now();
  const content = m.content || '';
  
  // DUPLICATE MESSAGE DETECTION - aber nicht für Webhooks (Commands)
  if (!bypass && !m.webhookId) {
    const userKey = `${m.channel.id}::${m.author.id}`;
    
    if (!messageHistory.has(userKey)) messageHistory.set(userKey, []);
    // Cleanup: keep last 2 minutes
    const history = messageHistory.get(userKey).filter(h => now - h.timestamp < 120000);
    
    // Check if exact same message was sent in last 20 seconds (stricter for regular messages)
    const recentDuplicate = history.some(h => h.content === content && now - h.timestamp < 20000);
    
    if (recentDuplicate) {
      await m.delete().catch(() => {});
      return;
    }
    
    // Add to history only if not duplicate and not bypass
    history.push({ content, timestamp: now, messageId: m.id });
    messageHistory.set(userKey, history);
  }

  // AUTOCLEAR SYSTEM
  if (autoClearChannels.has(m.channelId) && !bypass) {
    await m.delete().catch(() => {});
    return;
  }

  try {
    const contentLower = content.toLowerCase();

    // IGNORE NON-WEBHOOK BOTS
    if (m.author.bot && !m.webhookId) return;

    // USER MESSAGE MODERATION
    if (!m.webhookId) {
      if (!bypass) {
        // MARKDOWN HEADER PROTECTION
        if (content.match(/^#{1,6}\s/)) {
          await m.delete().catch(() => {});
          return;
        }

        // SPAM DETECTION
        if (!userSpamTracker.has(m.author.id)) userSpamTracker.set(m.author.id, []);
        const spamHistory = userSpamTracker.get(m.author.id).filter(t => now - t < 3000);
        spamHistory.push(now);
        userSpamTracker.set(m.author.id, spamHistory);
        
        if (spamHistory.length >= 5) {
          const h = messageHistory.get(userKey) || [];
          await bulkDelete(m.channel, h.slice(-5).map(x => x.messageId));
          if (m.member?.moderatable) {
            try {
              await m.member.timeout(TIMEOUTS.spam, 'Message spam');
            } catch {}
          }
          userSpamTracker.delete(m.author.id);
          return;
        }

        // MENTION SPAM PROTECTION
        const mentionCount = (content.match(/<@!?\d+>/g) || []).length + 
                            (content.match(/<@&\d+>/g) || []).length;
        if (mentionCount > 5) {
          await m.delete().catch(() => {});
          if (m.member?.moderatable) {
            try {
              await m.member.timeout(TIMEOUTS.spam, 'Mention spam');
            } catch {}
          }
          return;
        }

        // DISCORD INVITE LINK PROTECTION
        const hasLinkRole = m.member?.roles.cache.has(IDS.bypass) || 
                           m.member?.roles.cache.has(IDS.linkAllowed2);
        const hasAnti = m.member?.roles.cache.has(IDS.antiBypass);
        const discordInviteRegex = /(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/[a-zA-Z0-9]+/gi;
        
        if (!(hasLinkRole && !hasAnti) && discordInviteRegex.test(content)) {
          await m.delete().catch(() => {});
          if (m.member?.moderatable) {
            try {
              await m.member.timeout(TIMEOUTS.linkBlock, 'Discord invite link');
              await m.author.send({
                embeds: [new EmbedBuilder()
                  .setTitle('⛔ You have been timed out')
                  .setDescription('You have been timed out for **5 minutes** because you sent a Discord invite link.')
                  .addFields({ name: 'Your message', value: `\`\`\`${content.substring(0, 1000)}\`\`\`` })
                  .setColor('#ff0000')
                  .setTimestamp()]
              }).catch(() => {});
            } catch {}
          }
          return;
        }

        // PHISHING LINK DETECTION
        const urls = content.match(/https?:\/\/[^\s]+/gi) || [];
        for (const url of urls) {
          if (PHISHING_DOMAINS.some(d => url.toLowerCase().includes(d))) {
            await m.delete().catch(() => {});
            if (m.member?.moderatable) {
              try {
                await m.member.timeout(TIMEOUTS.linkBlock, 'Phishing link detected');
              } catch {}
            }
            await sendLog(new EmbedBuilder()
              .setTitle('🚨 Phishing Link Detected')
              .addFields(
                { name: 'User', value: `${m.author.tag} (${m.author.id})`, inline: true },
                { name: 'Channel', value: `${m.channel}`, inline: true },
                { name: 'URL', value: url.substring(0, 1024) }
              )
              .setColor('#ff0000')
              .setTimestamp());
            return;
          }
        }

// BLACKLIST WORD FILTER
        if (checkMsg(m)) {
          await m.delete().catch(() => {});
          if (m.member?.moderatable) {
            try {
              await m.member.timeout(TIMEOUTS.blacklist, 'Blacklisted word');
            } catch {}
          }
          return;
        }
      }
      return;
    }

    // Webhooks sind erlaubt - keine Filterung
  } catch {}
});

// ==========================================
// WEBHOOK UPDATE EVENT
// ==========================================
client.on('webhookUpdate', async (c) => {
  try {
    const whs = await c.fetchWebhooks();
    whs.forEach(async (wh) => {
      if (wh.name !== 'Zenk') await wh.edit({ name: 'Zenk' });
    });
  } catch {}
});

// ==========================================
// MESSAGE REACTION EVENTS - LEVEL SYSTEM
// ==========================================
client.on('messageReactionAdd', async (reaction, user) => {
  try {
    // Skip bots and reactions on bot messages in non-guild channels
    if (user.bot || !reaction.message.guild) return;
    
    // Get the full message and member
    const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
    const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return;
    
    // Don't give EXP for reacting to own messages
    if (message.author.id === user.id) return;
    
    // Don't give EXP if message author is a bot
    if (message.author.bot) return;
    
    // Add EXP for reaction (cooldown handled in addExp)
    const expAmount = Math.floor(Math.random() * 10) + 10; // 10-20 EXP per reaction
    await addExp(user.id, reaction.message.guild.id, expAmount, 'reaction').catch(() => {});
  } catch {}
});

// ==========================================
// SLASH COMMANDS & INTERACTIONS
// ==========================================
client.on('interactionCreate', async (i) => {
  try {
    // SLASH COMMAND: MUTE
    if (i.isChatInputCommand() && i.commandName === 'mute') {
      if (!i.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        return i.reply({ content: 'No permissions', ephemeral: true });
      }
      const user = i.options.getUser('user');
      const duration = i.options.getString('duration');
      const ms = parseDuration(duration);
      
      if (!ms || ms > 2419200000) {
        return i.reply({ content: 'Invalid duration (max 28d)', ephemeral: true });
      }
      
      const member = await i.guild.members.fetch(user.id);
      if (!member.moderatable) {
        return i.reply({ content: 'Cannot timeout this user', ephemeral: true });
      }
      
      await member.timeout(ms, `Timed out by ${i.user.tag}`);
      await i.reply({ content: `Timed out ${user.tag} for ${duration}`, ephemeral: true });
      await sendLog(new EmbedBuilder()
        .setTitle('⏱️ User Timed Out')
        .addFields(
          { name: 'User', value: `${user.tag}`, inline: true },
          { name: 'Duration', value: duration, inline: true },
          { name: 'Mod', value: i.user.tag }
        )
        .setColor('#ffa500')
        .setTimestamp());
    }

    // SLASH COMMAND: UNMUTE
    else if (i.isChatInputCommand() && i.commandName === 'unmute') {
      if (!i.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        return i.reply({ content: 'No permissions', ephemeral: true });
      }
      const user = i.options.getUser('user');
      const member = await i.guild.members.fetch(user.id);
      
      if (!member.moderatable) {
        return i.reply({ content: 'Cannot unmute this user', ephemeral: true });
      }
      
      await member.timeout(null, `Unmuted by ${i.user.tag}`);
      await i.reply({ content: `Unmuted ${user.tag}`, ephemeral: true });
      await sendLog(new EmbedBuilder()
        .setTitle('✅ Timeout Removed')
        .addFields(
          { name: 'User', value: user.tag, inline: true },
          { name: 'Mod', value: i.user.tag, inline: true }
        )
        .setColor('#00ff00')
        .setTimestamp());
    }

    // SLASH COMMAND: SETUP
    else if (i.isChatInputCommand() && i.commandName === 'setup') {
      if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return i.reply({ content: 'No permissions', ephemeral: true });
      }
      
      await i.deferReply({ ephemeral: true });
      
      const feature = i.options.getString('feature');
      const channel = i.options.getChannel('channel');
      
      if (feature === 'tickets') {
        const cat = await ensureTicketInfra(i.guild, channel);
        if (cat) {
          await channel.send({
            embeds: [new EmbedBuilder()
              .setTitle('🎫 Ticket System')
              .setDescription('Select a category to open a support ticket.')
              .setColor('#5865F2')
              .setTimestamp()],
            components: [new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('ticket-select')
                .setPlaceholder('Select ticket type')
                .addOptions(
                  new StringSelectMenuOptionBuilder()
                    .setLabel('None')
                    .setValue('none')
                    .setDescription('Deselect'),
                  new StringSelectMenuOptionBuilder()
                    .setLabel('Support')
                    .setValue('support')
                    .setDescription('Bug reports or questions')
                )
            )]
          });
        }
      }
      
      setupConfig[feature] = channel.id;
      writeSetup(setupConfig);
      await i.editReply({ content: `Setup complete: ${feature} → ${channel}` });
    }

    // SLASH COMMAND: RESETUP
    else if (i.isChatInputCommand() && i.commandName === 'resetup') {
      if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return i.reply({ content: 'No permissions', ephemeral: true });
      }
      
      const feature = i.options.getString('feature');
      
      if (setupConfig[feature]) {
        if (feature === 'tickets') {
          if (setupConfig.ticketCategory) {
            const cat = await i.guild.channels.fetch(setupConfig.ticketCategory).catch(() => null);
            if (cat) {
              for (const [, ch] of i.guild.channels.cache.filter(c => c.parentId === cat.id)) {
                await ch.delete().catch(() => {});
              }
              await cat.delete().catch(() => {});
            }
          }
          if (setupConfig.ticketLogs) {
            const logs = await i.guild.channels.fetch(setupConfig.ticketLogs).catch(() => null);
            if (logs) await logs.delete().catch(() => {});
          }
          activeTickets.clear();
          delete setupConfig.ticketCategory;
          delete setupConfig.ticketLogs;
        }
        delete setupConfig[feature];
        writeSetup(setupConfig);
        await i.reply({ content: `Removed setup: ${feature}`, ephemeral: true });
      } else {
        await i.reply({ content: `No setup found: ${feature}`, ephemeral: true });
      }
    }

    // SLASH COMMAND: CLEAR
    else if (i.isChatInputCommand() && i.commandName === 'clear') {
      if (!i.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return i.reply({ content: 'No permissions', ephemeral: true });
      }
      
      const amount = i.options.getInteger('amount');
      const targetUser = i.options.getUser('user');
      const fetched = await i.channel.messages.fetch({ limit: amount });
      let toDelete = fetched;
      
      if (targetUser) {
        const arr = fetched.filter(m => m.author.id === targetUser.id).first(amount);
        if (arr) toDelete = fetched.filter(m => arr.map(a => a.id).includes(m.id));
      }
      
      if (!toDelete?.size) {
        return i.reply({ content: 'No messages found', ephemeral: true });
      }
      
      const deleted = await i.channel.bulkDelete(toDelete, true);
      await i.reply({ 
        content: `Deleted ${deleted.size} message(s)${targetUser ? ` from ${targetUser.tag}` : ''}.`, 
        ephemeral: true 
      });
    }

    // SLASH COMMAND: AUTOCLEAR
    else if (i.isChatInputCommand() && i.commandName === 'autoclear') {
      if (!i.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return i.reply({ content: 'No permissions', ephemeral: true });
      }
      await i.reply({ 
        content: startAutoClear(i.channelId) ? 
          'AutoClear activated! Use `/autoclearoff` to stop.' : 
          'AutoClear is already active', 
        ephemeral: true 
      });
    }

    // SLASH COMMAND: AUTOCLEAROFF
    else if (i.isChatInputCommand() && i.commandName === 'autoclearoff') {
      if (!i.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return i.reply({ content: 'No permissions', ephemeral: true });
      }
      await i.reply({ 
        content: stopAutoClear(i.channelId) ? 
          'AutoClear deactivated' : 
          'AutoClear is not active', 
        ephemeral: true 
      });
    }

    // SLASH COMMAND: LOCK
    else if (i.isChatInputCommand() && i.commandName === 'lock') {
      if (!i.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return i.reply({ content: 'No permissions', ephemeral: true });
      }
      
      try {
        const channel = i.channel;
        await channel.permissionOverwrites.edit(i.guild.id, {
          SendMessages: false
        });
        
        await channel.permissionOverwrites.edit(IDS.staff, {
          SendMessages: true
        });
        
        await i.reply({ content: '🔒 Channel locked! Only staff can write.', ephemeral: true });
        await sendLog(new EmbedBuilder()
          .setTitle('🔒 Channel Locked')
          .addFields(
            { name: 'Channel', value: `${channel}`, inline: true },
            { name: 'Locked By', value: i.user.tag, inline: true }
          )
          .setColor('#ffa500')
          .setTimestamp());
      } catch (error) {
        await i.reply({ content: 'Failed to lock channel', ephemeral: true });
      }
    }

    // SLASH COMMAND: UNLOCK
    else if (i.isChatInputCommand() && i.commandName === 'unlock') {
      if (!i.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return i.reply({ content: 'No permissions', ephemeral: true });
      }
      
      try {
        const channel = i.channel;
        await channel.permissionOverwrites.edit(i.guild.id, {
          SendMessages: null
        });
        
        await i.reply({ content: '🔓 Channel unlocked! Everyone can write again.', ephemeral: true });
        await sendLog(new EmbedBuilder()
          .setTitle('🔓 Channel Unlocked')
          .addFields(
            { name: 'Channel', value: `${channel}`, inline: true },
            { name: 'Unlocked By', value: i.user.tag, inline: true }
          )
          .setColor('#00ff00')
          .setTimestamp());
      } catch (error) {
        await i.reply({ content: 'Failed to unlock channel', ephemeral: true });
      }
    }

    // SLASH COMMAND: LEVEL
    else if (i.isChatInputCommand() && i.commandName === 'level') {
      try {
        await i.deferReply();
        
        const targetUser = i.options.getUser('user') || i.user;
        const levels = await readLevels();
        const key = `${i.guild.id}_${targetUser.id}`;
        
        if (!levels[key] || !levels[key].exp) {
          const exp = 0;
          const level = 1;
          const expInLevel = 0;
          const expNeeded = getExpNeededForNextLevel(level);
          
          await i.editReply({
            embeds: [new EmbedBuilder()
              .setTitle(`${targetUser.tag}'s Level`)
              .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
              .addFields(
                { name: 'Level', value: `${level}`, inline: true },
                { name: 'Experience', value: `${exp}`, inline: true },
                { name: 'EXP to Next Level', value: `${expNeeded}`, inline: true }
              )
              .setColor('#5865F2')
              .setTimestamp()]
          });
          return;
        }
        
        const exp = levels[key].exp;
        const level = getLevel(exp);
        const expInLevel = getExpInCurrentLevel(exp, level);
        const expNeeded = getExpNeededForNextLevel(level);
        const progressBarLength = 20;
        const progress = Math.floor((expInLevel / expNeeded) * progressBarLength);
        const progressBar = '█'.repeat(progress) + '░'.repeat(progressBarLength - progress);
        
        await i.editReply({
          embeds: [new EmbedBuilder()
            .setTitle(`${targetUser.tag}'s Level`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .addFields(
              { name: 'Level', value: `${level}`, inline: true },
              { name: 'Total Experience', value: `${exp.toLocaleString()}`, inline: true },
              { name: 'EXP Progress', value: `${expInLevel}/${expNeeded}`, inline: true },
              { name: 'Progress Bar', value: `${progressBar} ${Math.floor((expInLevel / expNeeded) * 100)}%`, inline: false }
            )
            .setColor('#5865F2')
            .setTimestamp()]
        });
      } catch (error) {
        console.error('Error in /level command:', error);
        await i.editReply({ content: 'Failed to get level information' }).catch(() => {});
      }
    }







    // TICKET SELECT MENU
    else if (i.isStringSelectMenu() && i.customId === 'ticket-select') {
      if (i.values[0] === 'none') {
        return i.reply({ content: 'Selection cleared.', ephemeral: true });
      }
      if (activeTickets.has(i.user.id)) {
        return i.reply({ 
          content: `You already have a ticket: <#${activeTickets.get(i.user.id)}>`, 
          ephemeral: true 
        });
      }
      await i.showModal(new ModalBuilder()
        .setCustomId('ticket-create-modal')
        .setTitle('Create Support Ticket')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('executor-input')
              .setLabel('Executor')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Bunni, Delta...')
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('problem-input')
              .setLabel('What is your problem?')
              .setStyle(TextInputStyle.Paragraph)
              .setPlaceholder('Describe your issue...')
              .setRequired(true)
          )
        ));
    }

    // TICKET CLOSE BUTTON
    else if (i.isButton() && i.customId === 'close-ticket') {
      await i.showModal(new ModalBuilder()
        .setCustomId('close-ticket-modal')
        .setTitle('Close Ticket')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('close-reason')
              .setLabel('Reason for closing')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
          )
        ));
    }

    // TICKET CREATE MODAL
    else if (i.isModalSubmit() && i.customId === 'ticket-create-modal') {
      const executor = i.fields.getTextInputValue('executor-input');
      const problem = i.fields.getTextInputValue('problem-input');
      await i.deferReply({ ephemeral: true });

      const cat = await ensureTicketInfra(i.guild, i.channel);
      if (!cat) {
        return i.editReply({ content: '❌ Ticket category could not be created.' });
      }

      const ticketChannel = await i.guild.channels.create({
        name: `support-${i.user.username.replace(/[^a-zA-Z0-9]/g, '')}`,
        type: ChannelType.GuildText,
        parent: cat.id,
        permissionOverwrites: [
          { id: i.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: IDS.staff, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
        ]
      });

      activeTickets.set(i.user.id, ticketChannel.id);

      const msg = await ticketChannel.send({
        content: `${i.user}`,
        embeds: [new EmbedBuilder()
          .setTitle('🎫 Support Ticket')
          .addFields(
            { name: 'User', value: `${i.user}`, inline: true },
            { name: 'Executor:', value: executor, inline: true },
            { name: 'Problem:', value: problem }
          )
          .setColor('#5865F2')
          .setTimestamp()],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('close-ticket')
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger)
        )]
      });

      await msg.pin().catch(() => {});
      await i.editReply({ content: `✅ Ticket created: ${ticketChannel}` });
      await sendLog(new EmbedBuilder()
        .setTitle('🎫 Ticket Created')
        .addFields(
          { name: 'User', value: i.user.tag },
          { name: 'Channel', value: ticketChannel.name },
          { name: 'Executor', value: executor }
        )
        .setColor('#5865F2')
        .setTimestamp());
    }

    // TICKET CLOSE MODAL
    else if (i.isModalSubmit() && i.customId === 'close-ticket-modal') {
      const reason = i.fields.getTextInputValue('close-reason');
      const channel = i.channel;
      const ticketUser = Array.from(activeTickets.entries()).find(([, channelId]) => channelId === channel.id);
      
      if (!ticketUser) {
        return i.reply({ content: 'Ticket user not found', ephemeral: true });
      }
      
      const [userId] = ticketUser;
      activeTickets.delete(userId);

      await i.reply({ content: '✅ Closing ticket...', ephemeral: true });

      const user = await client.users.fetch(userId).catch(() => null);
      if (user) {
        user.send({
          embeds: [new EmbedBuilder()
            .setTitle('🎫 Ticket Closed')
            .setDescription(`Your ticket **${channel.name}** has been closed.`)
            .addFields({ name: 'Reason', value: reason })
            .setColor('#ff0000')
            .setTimestamp()]
        }).catch(() => {});
      }

      if (setupConfig.ticketLogs) {
        const logs = await client.channels.fetch(setupConfig.ticketLogs).catch(() => null);
        if (logs) {
          await logs.send({
            embeds: [new EmbedBuilder()
              .setTitle(`📋 Ticket: ${channel.name}`)
              .addFields(
                { name: 'User', value: `<@${userId}>`, inline: true },
                { name: 'Closed By', value: `<@${i.user.id}>`, inline: true },
                { name: 'Reason', value: reason }
              )
              .setColor('#ff0000')
              .setTimestamp()]
          }).catch(() => {});
        }
      }

      await sendLog(new EmbedBuilder()
        .setTitle('🎫 Ticket Closed')
        .addFields(
          { name: 'Channel', value: channel.name },
          { name: 'User', value: user ? user.tag : userId },
          { name: 'Closed By', value: i.user.tag },
          { name: 'Reason', value: reason }
        )
        .setColor('#ff0000')
        .setTimestamp());
      
      setTimeout(async () => {
        try {
          await channel.delete();
        } catch {}
      }, 5000);
    }
  } catch {}
});

// ==========================================
// EXPRESS API - EXECUTION TRACKER
// ==========================================
app.post('/execution', async (req, res) => {
  try {
    executionCount++;
    writeExecutions(executionCount);
    const now = Date.now();
    
    if (now - lastUpdate >= 480000) {
      const c = await client.channels.fetch(config.channelId).catch(() => null);
      if (c) {
        await renameChannel(c, `Executions: ${executionCount}`);
        lastUpdate = now;
      }
    }
    
    res.json({ success: true, count: executionCount });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==========================================
// EXPRESS API - DATA EXPORT/IMPORT
// ==========================================
app.get('/export', (req, res) => {
  res.type('text/plain').send(String(executionCount));
});

app.post('/import', (req, res) => {
  const n = Number(req.body?.count);
  if (!Number.isFinite(n) || n < 0) {
    return res.status(400).json({ success: false });
  }
  executionCount = Math.floor(n);
  writeExecutions(executionCount);
  res.json({ success: true, count: executionCount });
});

// ==========================================
// EXPRESS API - STATUS ENDPOINT
// ==========================================
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    executions: executionCount,
    members: memberCount,
    ready: client.isReady()
  });
});

// ==========================================
// SERVER & CLIENT STARTUP
// ==========================================
app.listen(config.port || 3000, () => console.log('Server running'));
client.login(config.token);
