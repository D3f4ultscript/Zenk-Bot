// ==========================================
// DEPENDENCIES & CLIENT SETUP
// ==========================================
const { Client, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder, REST, Routes, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const http = require('http');
const config = require('./config');
require('dotenv').config();

// Create a simple HTTP server to satisfy Render's port check
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running!');
}).listen(process.env.PORT || 3000);

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
  linkAllowedImages: '1463598683554840617',
  memberChannel: '1454427807701663774',
  boosterRole: '1464781880288350310'
};

const TIMEOUTS = { 
  spam: 300000, 
  linkBlock: 300000, 
  blacklist: 300000 
};

const BLACKLIST = [];

const PHISHING_DOMAINS = [
  'discord-nitro', 'steamcommunity-trade', 'free-nitro', 'steamcommunitty', 
  'discordapp-gift', 'discordgift', 'grabify.link', 'iplogger.org', 
  'blasze.tk', 'freegiftcodes'
];

// ==========================================
// GLOBAL STATE & TRACKERS
// ==========================================
const webhookTracker = new Map();
const webhookCooldown = new Map();
const messageHistory = new Map();
const userSpamTracker = new Map();
const autoClearChannels = new Map();
let memberCount = 0;
let lastUpdate = 0;
let updateScheduled = false;

const scheduleMemberCountUpdate = () => {
  try {
    if (updateScheduled) return;
    updateScheduled = true;
    const since = Date.now() - (lastUpdate || 0);
    const wait = Math.max(0, 600000 - since); // 10 minutes minus time since last update
    setTimeout(async () => {
      try {
        await updateCountsChannels();
      } catch (e) {
        console.error('Scheduled member count update failed:', e?.message || e);
      } finally {
        updateScheduled = false;
      }
    }, wait);
  } catch (e) {
    updateScheduled = false;
  }
};

// ==========================================
// DISCORD HELPERS
// ==========================================
const renameChannel = async (c, n) => {
  try {
    if (!c) {
      console.error('Channel is null or undefined');
      return;
    }
    
    const hasPermission = c.permissionsFor(client.user)?.has(PermissionFlagsBits.ManageChannels);
    if (!hasPermission) {
      console.error(`No permission to rename channel ${c.id}`);
      return;
    }
    
    await c.setName(n);
  } catch (error) {
    console.error(`Error renaming channel ${c?.id || 'unknown'}:`, error.message);
  }
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
  const hasBypassRole = m.member.roles.cache.has(IDS.bypass);
  const hasExemptRole = m.member.roles.cache.has(IDS.antiBypass); // this role should be exempt from anti-spam
  // Exempt if user has either the bypass role or the exempt role
  return hasBypassRole || hasExemptRole;
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
    // Update Member Channel: try full fetch, on timeout use fallback
    try {
      const mc = await client.channels.fetch(IDS.memberChannel).catch(e => {
        console.error(`Could not fetch member channel ${IDS.memberChannel}:`, e.message);
        return null;
      });
      if (mc) {
        const guild = mc.guild;
        let nonBotCount = null;
        try {
          // Try to fetch all members (may time out for very large guilds)
          await guild.members.fetch({ force: true });
          nonBotCount = guild.members.cache.filter(m => !m.user.bot).size;
        } catch (e) {
          // Fetch failed or timed out: fallback to using guild.memberCount minus known cached bots
          console.error('Members fetch failed (falling back):', e.message);
          const cachedBots = guild.members.cache.filter(m => m.user.bot).size;
          nonBotCount = Math.max(0, (guild.memberCount || 0) - cachedBots);
        }

        // Update channel name only if we have a numeric result
        if (Number.isFinite(nonBotCount)) {
          memberCount = nonBotCount;
          await renameChannel(mc, `Member: ${memberCount}`);
          lastUpdate = Date.now();
        } else {
          console.error('Could not determine member count for channel', mc.id);
        }
      }
    } catch (error) {
      console.error('Error updating member channel:', error.message);
    }
  } catch (error) {
    console.error('Error in updateCountsChannels:', error.message);
  }
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
  await updateCountsChannels();
  // Aktualisiere Counts alle 10 Minuten (Discord Rate Limit safe)
  setInterval(updateCountsChannels, 600000);

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
      .setName('boosterlist')
      .setDescription('Manage the booster reward list')
      .addSubcommand(sub => sub.setName('create').setDescription('Create a new list of all boosters'))
      .addSubcommand(sub => sub.setName('update').setDescription('Update the booster list from a previous message')),
    
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
  scheduleMemberCountUpdate();
});

client.on('guildMemberRemove', async (m) => {
  scheduleMemberCountUpdate();
});

// ==========================================
// MESSAGE MODERATION SYSTEM
// ==========================================
client.on('messageCreate', async (m) => {
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

    // If message contains the substring 'key' (case-insensitive), DM the user
    try {
      if (contentLower.includes('key')) {
        await m.author.send(
          'Hi! Tutorials are here: https://discord.com/channels/1453870596738908305/1463414744353476741\n' +
          'To continue to the key system, go here: https://discord.com/channels/1453870596738908305/1454185266255233074'
        ).catch(() => {});
      }
    } catch {}

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

        // DISCORD INVITE LINK PROTECTION - DISABLED
        /*
        const hasLinkRole = m.member?.roles.cache.has(IDS.bypass) || 
               m.member?.roles.cache.has(IDS.linkAllowed2) ||
               m.member?.roles.cache.has(IDS.linkAllowedImages);
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
        */

        // PHISHING LINK DETECTION - DISABLED
        /*
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
        */

// BLACKLIST WORD FILTER - DISABLED
        /*
        if (checkMsg(m)) {
          await m.delete().catch(() => {});
          if (m.member?.moderatable) {
            try {
              await m.member.timeout(TIMEOUTS.blacklist, 'Blacklisted word');
            } catch {}
          }
          return;
        }
        */
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
      await i.reply({ content: `Timed out ${user.tag} for ${duration} and deleting messages...`, ephemeral: true });

      // Search and delete messages in all channels
      i.guild.channels.cache.forEach(async (channel) => {
        if (channel.isTextBased() && channel.permissionsFor(i.guild.members.me).has(PermissionFlagsBits.ManageMessages)) {
          try {
            const fetchedMessages = await channel.messages.fetch({ limit: 100 });
            const userMessages = fetchedMessages.filter(msg => msg.author.id === user.id);
            if (userMessages.size > 0) {
              await channel.bulkDelete(userMessages, true).catch(() => {});
            }
          } catch (err) {}
        }
      });

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

    // SLASH COMMAND: BOOSTERLIST
    else if (i.isChatInputCommand() && i.commandName === 'boosterlist') {
      const requiredRole = IDS.bypass; // Using bypass role as staff/required permission since user mentioned it before
      if (!i.member.roles.cache.has(requiredRole) && !i.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return i.reply({ content: 'Keine Berechtigung.', ephemeral: true });
      }

      const subcommand = i.options.getSubcommand();
      const roleToPing = i.guild.roles.cache.get(IDS.boosterRole);
      
      if (!roleToPing) {
        return i.reply({ content: 'Booster Rolle nicht gefunden.', ephemeral: true });
      }

      if (subcommand === 'create') {
        const membersToPing = "## **Booster List**\n" + roleToPing.members.map(m => `- <@${m.id}>`).join('\n');
        
        if (roleToPing.members.size === 0) {
          return i.reply({ content: 'Keine User mit dieser Rolle gefunden.', ephemeral: true });
        }

        if (membersToPing.length > 2000) {
          const chunks = membersToPing.match(/[\s\S]{1,2000}/g) || [];
          await i.reply({ content: chunks[0] });
          for (let j = 1; j < chunks.length; j++) {
            await i.channel.send({ content: chunks[j] });
          }
        } else {
          await i.reply({ content: membersToPing });
        }
      } 
      else if (subcommand === 'update') {
        await i.showModal(new ModalBuilder()
          .setCustomId('booster-update-modal')
          .setTitle('Update Booster List')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('old-list-input')
                .setLabel('Paste previous list')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Copy and paste the entire previous list here...')
                .setRequired(true)
            )
          ));
      }
    }

    // BOOSTER UPDATE MODAL SUBMIT
    else if (i.isModalSubmit() && i.customId === 'booster-update-modal') {
      const oldList = i.fields.getTextInputValue('old-list-input');
      const lines = oldList.split('\n');
      const roleToPing = i.guild.roles.cache.get(IDS.boosterRole);
      
      const currentBoosterIds = new Set(roleToPing.members.map(m => m.id));
      const processedIds = new Set();
      let newList = [];

      // Process existing lines
      for (let line of lines) {
        if (line.trim() === '' || line.startsWith('##')) {
          if (line.includes('Booster List')) newList.push("## **Booster List**");
          else newList.push(line);
          continue;
        }

        const match = line.match(/<@!?(\d+)>/);
        if (match) {
          const userId = match[1];
          if (currentBoosterIds.has(userId)) {
            newList.push(line); // Keep user and their added info
            processedIds.add(userId);
          }
          // If not in currentBoosterIds, the line is skipped (removed)
        } else {
          // If no user mention found but line isn't empty/header, keep it? 
          // Actually user said remove the whole line if role is gone. 
          // If there's no mention, it's not a booster line we can track accurately by ID.
          newList.push(line);
        }
      }

      // Add new boosters
      for (const [memberId, member] of roleToPing.members) {
        if (!processedIds.has(memberId)) {
          newList.push(`- <@${memberId}>`);
        }
      }

      const finalContent = newList.join('\n');
      if (finalContent.length > 2000) {
        const chunks = finalContent.match(/[\s\S]{1,2000}/g) || [];
        await i.reply({ content: chunks[0], ephemeral: true });
        for (let j = 1; j < chunks.length; j++) {
          await i.followUp({ content: chunks[j], ephemeral: true });
        }
      } else {
        await i.reply({ content: finalContent, ephemeral: true });
      }
    }
  } catch (error) {
    console.error('Interaction error:', error);
  }
});

// ==========================================
// CLIENT STARTUP
// ==========================================
client.login(config.token);
