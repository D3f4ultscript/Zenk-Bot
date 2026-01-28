const { Client, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder, REST, Routes, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config');
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

const IDS = {
  staff: '1454608694850486313',
  log: '1456977089864400970',
  tradeExcluded: '1455105607332925553',
  bypass: '1453892506801541201',
  antiBypass: '1454089114348425348',
  linkAllowed2: '1454774839519875123',
  linkAllowedImages: '1463598683554840617'
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

const setupFile = path.join(__dirname, 'Setup.json');

const webhookTracker = new Map();
const webhookCooldown = new Map();
const activeTickets = new Map();
const messageHistory = new Map();
const userSpamTracker = new Map();
const autoClearChannels = new Map();
let setupConfig = {};
let memberCount = 0;
let lastUpdate = 0;
let updateScheduled = false;

const scheduleMemberCountUpdate = () => {
  try {
    if (updateScheduled) return;
    updateScheduled = true;
    const since = Date.now() - (lastUpdate || 0);
    const wait = Math.max(0, 600000 - since);
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

const checkBypass = (m) => {
  if (m.webhookId) return false;
  if (!m.member?.roles?.cache) return false;
  const hasBypassRole = m.member.roles.cache.has(IDS.bypass);
  const hasExemptRole = m.member.roles.cache.has(IDS.antiBypass);
  return hasBypassRole || hasExemptRole;
};

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

const restoreWebhook = async (wId, cId) => {
  try {
    const c = await client.channels.fetch(cId);
    if (!c) return;
    const whs = await c.fetchWebhooks();
    const wh = whs.get(wId);
    if (wh && wh.name !== 'Zenk') await wh.edit({ name: 'Zenk' });
  } catch {}
};

const updateCountsChannels = async () => {
  try {
    try {
      const mc = await client.channels.fetch(config.memberChannelId).catch(e => {
        console.error(`Could not fetch member channel ${config.memberChannelId}:`, e.message);
        return null;
      });
      if (mc) {
        const guild = mc.guild;
        let nonBotCount = null;
        try {
          await guild.members.fetch({ force: true });
          nonBotCount = guild.members.cache.filter(m => !m.user.bot).size;
        } catch (e) {
          console.error('Members fetch failed (falling back):', e.message);
          const cachedBots = guild.members.cache.filter(m => m.user.bot).size;
          nonBotCount = Math.max(0, (guild.memberCount || 0) - cachedBots);
        }
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

const lastBoosterListMessage = new Map();

client.once('ready', async () => {
  console.log('Bot ready');
  setupConfig = readSetup();
  await updateCountsChannels();
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
      .setName('boosterlist')
      .setDescription('Booster Listenverwaltung')
      .addSubcommand(sc =>
        sc.setName('create')
          .setDescription('Erstellt eine neue Boosterliste'))
      .addSubcommand(sc =>
        sc.setName('update')
          .setDescription('Aktualisiert eine bestehende Boosterliste')
          .addStringOption(o =>
            o.setName('message')
              .setDescription('Link oder ID der bestehenden Boosterliste')
              .setRequired(false)))
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  } catch {}
});

client.on('guildMemberAdd', async (m) => {
  scheduleMemberCountUpdate();
  if (setupConfig.welcome) {
    try {
      const c = await client.channels.fetch(setupConfig.welcome);
      if (c) await c.send(`Welcome to **Zenk Studios**, ${m}`);
    } catch {}
  }
});

client.on('guildMemberRemove', async () => {
  scheduleMemberCountUpdate();
});

client.on('messageCreate', async (m) => {
  const bypass = checkBypass(m);
  const now = Date.now();
  const content = m.content || '';
  if (!bypass && !m.webhookId) {
    const userKey = `${m.channel.id}::${m.author.id}`;
    if (!messageHistory.has(userKey)) messageHistory.set(userKey, []);
    const history = messageHistory.get(userKey).filter(h => now - h.timestamp < 120000);
    const recentDuplicate = history.some(h => h.content === content && now - h.timestamp < 20000);
    if (recentDuplicate) {
      await m.delete().catch(() => {});
      return;
    }
    history.push({ content, timestamp: now, messageId: m.id });
    messageHistory.set(userKey, history);
  }
  if (autoClearChannels.has(m.channelId) && !bypass) {
    await m.delete().catch(() => {});
    return;
  }
  try {
    const contentLower = content.toLowerCase();
    if (m.author.bot && !m.webhookId) return;
    try {
      if (contentLower.includes('key')) {
        await m.author.send(
          'Hi! Tutorials are here: https://discord.com/channels/1453870596738908305/1463414744353476741\n' +
          'To continue to the key system, go here: https://discord.com/channels/1453870596738908305/1454185266255233074'
        ).catch(() => {});
      }
    } catch {}
    if (!m.webhookId) {
      if (!bypass) {
        if (content.match(/^#{1,6}\s/)) {
          await m.delete().catch(() => {});
          return;
        }
        if (!userSpamTracker.has(m.author.id)) userSpamTracker.set(m.author.id, []);
        const spamHistory = userSpamTracker.get(m.author.id).filter(t => now - t < 3000);
        spamHistory.push(now);
        userSpamTracker.set(m.author.id, spamHistory);
        if (spamHistory.length >= 5) {
          const userKey = `${m.channel.id}::${m.author.id}`;
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
      }
      return;
    }
  } catch {}
});

client.on('webhookUpdate', async (c) => {
  try {
    const whs = await c.fetchWebhooks();
    whs.forEach(async (wh) => {
      if (wh.name !== 'Zenk') await wh.edit({ name: 'Zenk' });
    });
  } catch {}
});

const parseMessageLinkOrId = async (guild, currentChannel, input) => {
  if (!input) return null;
  const idMatch = input.match(/\d{17,20}$/);
  if (!idMatch) return null;
  const messageId = idMatch[0];
  try {
    const msg = await currentChannel.messages.fetch(messageId).catch(() => null);
    if (msg) return msg;
  } catch {}
  try {
    const channels = guild.channels.cache.filter(c => c.isTextBased());
    for (const [, ch] of channels) {
      try {
        const m = await ch.messages.fetch(messageId).catch(() => null);
        if (m) return m;
      } catch {}
    }
  } catch {}
  return null;
};

client.on('interactionCreate', async (i) => {
  try {
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
      i.guild.channels.cache.forEach(async (channel) => {
        if (channel.isTextBased() && channel.permissionsFor(i.guild.members.me).has(PermissionFlagsBits.ManageMessages)) {
          try {
            const fetchedMessages = await channel.messages.fetch({ limit: 100 });
            const userMessages = fetchedMessages.filter(msg => msg.author.id === user.id);
            if (userMessages.size > 0) {
              await channel.bulkDelete(userMessages, true).catch(() => {});
            }
          } catch {}
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
    } else if (i.isChatInputCommand() && i.commandName === 'unmute') {
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
    } else if (i.isChatInputCommand() && i.commandName === 'setup') {
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
    } else if (i.isChatInputCommand() && i.commandName === 'resetup') {
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
    } else if (i.isChatInputCommand() && i.commandName === 'clear') {
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
    } else if (i.isChatInputCommand() && i.commandName === 'autoclear') {
      if (!i.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return i.reply({ content: 'No permissions', ephemeral: true });
      }
      await i.reply({ 
        content: startAutoClear(i.channelId) ? 
          'AutoClear activated! Use `/autoclearoff` to stop.' : 
          'AutoClear is already active', 
        ephemeral: true 
      });
    } else if (i.isChatInputCommand() && i.commandName === 'autoclearoff') {
      if (!i.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return i.reply({ content: 'No permissions', ephemeral: true });
      }
      await i.reply({ 
        content: stopAutoClear(i.channelId) ? 
          'AutoClear deactivated' : 
          'AutoClear is not active', 
        ephemeral: true 
      });
    } else if (i.isChatInputCommand() && i.commandName === 'lock') {
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
      } catch {
        await i.reply({ content: 'Failed to lock channel', ephemeral: true });
      }
    } else if (i.isChatInputCommand() && i.commandName === 'unlock') {
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
      } catch {
        await i.reply({ content: 'Failed to unlock channel', ephemeral: true });
      }
    } else if (i.isChatInputCommand() && i.commandName === 'boosterlist') {
      const requiredRole = IDS.bypass;
      const targetRoleId = '1464781880288350310';
      if (!i.member.roles.cache.has(requiredRole)) {
        return i.reply({ content: 'Keine Berechtigung.', ephemeral: true });
      }
      const sub = i.options.getSubcommand();
      const roleToPing = i.guild.roles.cache.get(targetRoleId);
      if (!roleToPing) {
        return i.reply({ content: 'Booster Rolle nicht gefunden.', ephemeral: true });
      }
      if (sub === 'create') {
        if (roleToPing.members.size === 0) {
          return i.reply({ content: 'Keine User mit dieser Rolle gefunden.', ephemeral: true });
        }
        const content = roleToPing.members.map(m => `<@${m.id}>`).join('\n');
        if (!content.length) {
          return i.reply({ content: 'Keine User mit dieser Rolle gefunden.', ephemeral: true });
        }
        if (content.length > 2000) {
          const chunks = content.match(/[\s\S]{1,2000}/g) || [];
          const first = await i.reply({ content: chunks[0], fetchReply: true });
          lastBoosterListMessage.set(i.guildId, first.id);
          for (let j = 1; j < chunks.length; j++) {
            await i.channel.send({ content: chunks[j] });
          }
        } else {
          const msg = await i.reply({ content, fetchReply: true });
          lastBoosterListMessage.set(i.guildId, msg.id);
        }
      } else if (sub === 'update') {
        const input = i.options.getString('message');
        if (!input) {
          return i.reply({
            content: 'Bitte zuerst die letzte Boosterliste, die ich erstellt habe, in den Chat senden (kopieren/bearbeiten) und dann **/boosterlist update message:<Nachrichtenlink oder ID>** benutzen.',
            ephemeral: true
          });
        }
        await i.deferReply({ ephemeral: true });
        const msg = await parseMessageLinkOrId(i.guild, i.channel, input);
        if (!msg) {
          return i.editReply({ content: 'Nachricht nicht gefunden. Bitte Link oder ID prüfen.' });
        }
        const original = msg.content || '';
        if (!original.trim().length) {
          return i.editReply({ content: 'Die angegebene Nachricht hat keinen Inhalt.' });
        }
        const lines = original.split('\n');
        const currentMemberIds = new Set(roleToPing.members.map(m => m.id));
        const keptLines = [];
        const mentionedIdsInLines = new Set();
        for (const line of lines) {
          const match = line.match(/<@!?(\d+)>/);
          if (!match) {
            keptLines.push(line);
            continue;
          }
          const userId = match[1];
          if (currentMemberIds.has(userId)) {
            keptLines.push(line);
            mentionedIdsInLines.add(userId);
          }
        }
        const missingIds = [...currentMemberIds].filter(id => !mentionedIdsInLines.has(id));
        const newLines = keptLines.slice();
        for (const id of missingIds) {
          newLines.push(`<@${id}>`);
        }
        const newContent = newLines.join('\n');
        if (newContent.length > 2000) {
          return i.editReply({ content: 'Aktualisierte Liste ist länger als 2000 Zeichen. Bitte Liste manuell kürzen.' });
        }
        await msg.edit({ content: newContent }).catch(() => {});
        lastBoosterListMessage.set(i.guildId, msg.id);
        await i.editReply({ content: 'Boosterliste aktualisiert.' });
      }
    } else if (i.isStringSelectMenu() && i.customId === 'ticket-select') {
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
    } else if (i.isButton() && i.customId === 'close-ticket') {
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
    } else if (i.isModalSubmit() && i.customId === 'ticket-create-modal') {
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
    } else if (i.isModalSubmit() && i.customId === 'close-ticket-modal') {
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

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    members: memberCount,
    ready: client.isReady()
  });
});

app.listen(config.port || 3000, () => console.log('Server running'));
client.login(config.token);
