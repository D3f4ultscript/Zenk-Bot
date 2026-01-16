const { Client, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder, REST, Routes, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildWebhooks] });

const app = express();
app.use(express.json());

const BLACKLIST = ['bitch', 'asshole', 'bastard', 'cunt', 'cock', 'pussy', 'whore', 'slut', 'fag', 'faggot', 'nigger', 'nigga', 'retard', 'retarded', 'rape', 'nazi', 'hitler', 'kill yourself', 'motherfucker', 'bullshit', 'prick', 'twat', 'wanker', 'bollocks', 'scheiße', 'scheisse', 'scheiß', 'scheiss', 'ficken', 'fick', 'arschloch', 'fotze', 'hure', 'nutte', 'wichser', 'hurensohn', 'schwuchtel', 'schwul', 'drecksau', 'sau', 'schwein', 'drecksschwein', 'miststück', 'kacke', 'möse', 'pimmel', 'schwanz', 'leck mich', 'verpiss dich'];
const PHISHING_DOMAINS = ['discord-nitro', 'steamcommunity-trade', 'free-nitro', 'steamcommunitty', 'discordapp-gift', 'discordgift', 'grabify.link', 'iplogger.org', 'blasze.tk', 'freegiftcodes'];

const executionsFile = path.join(__dirname, 'Executions.txt');
const setupFile = path.join(__dirname, 'Setup.json');

const webhookTracker = new Map();
const webhookCooldown = new Map();
const activeTickets = new Map();
const messageHistory = new Map();
const userSpamTracker = new Map();
const autoClearChannels = new Map();

let setupConfig = {}, executionCount = 0, memberCount = 0, downloadCount = 0, lastUpdate = 0;

const IDS = {
  staff: '1454608694850486313',
  log: '1456977089864400970',
  rating: '1454624341248708649',
  tradeExcluded: '1455105607332925553',
  bypass: '1453892506801541201',
  antiBypass: '1454089114348425348',
  linkAllowed2: '1454774839519875123',
  download: '1455226125700694027'
};

const TIMEOUTS = { spam: 300000, linkBlock: 300000, blacklist: 300000 };

const readExecutions = () => { try { if (!fs.existsSync(executionsFile)) return 0; const n = Number(fs.readFileSync(executionsFile, 'utf8').trim()); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; } catch { return 0; } };
const writeExecutions = (n) => { try { fs.writeFileSync(executionsFile, String(n)); } catch {} };
const readSetup = () => { try { if (!fs.existsSync(setupFile)) return {}; return JSON.parse(fs.readFileSync(setupFile, 'utf8')); } catch { return {}; } };
const writeSetup = (d) => { try { fs.writeFileSync(setupFile, JSON.stringify(d, null, 2)); } catch {} };
const hasBlacklist = (t, bl) => { if (!t) return false; const l = t.toLowerCase(); return bl.some(w => l.includes(w)); };
const checkMsg = (m) => { if (hasBlacklist(m.content, BLACKLIST)) return true; if (m.embeds?.length) for (const e of m.embeds) { if (hasBlacklist(e.title, BLACKLIST) || hasBlacklist(e.description, BLACKLIST) || hasBlacklist(e.footer?.text, BLACKLIST) || hasBlacklist(e.author?.name, BLACKLIST)) return true; if (e.fields?.length) for (const f of e.fields) if (hasBlacklist(f.name, BLACKLIST) || hasBlacklist(f.value, BLACKLIST)) return true; } return false; };
const parseDuration = (s) => { const m = s.match(/^(\d+)([smhd])$/); if (!m) return null; const v = parseInt(m[1]), u = m[2]; return v * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[u]; };
const renameChannel = async (c, n) => { try { if (c.permissionsFor(client.user)?.has(PermissionFlagsBits.ManageChannels)) await c.setName(n); } catch {} };
const sendLog = async (e) => { try { const c = await client.channels.fetch(IDS.log); if (c) await c.send({ embeds: [e] }); } catch {} };
const restoreWebhook = async (wId, cId) => { try { const c = await client.channels.fetch(cId); if (!c) return; const whs = await c.fetchWebhooks(); const wh = whs.get(wId); if (wh && wh.name !== 'Zenk') await wh.edit({ name: 'Zenk' }); } catch {} };
const bulkDelete = async (c, ids) => { try { const v = ids.filter(Boolean); if (!v.length) return; if (v.length === 1) { const m = await c.messages.fetch(v[0]).catch(() => null); if (m) await m.delete(); } else await c.bulkDelete(v, true); } catch {} };

const checkBypass = (m) => {
  if (m.webhookId) return false;
  if (!m.member?.roles?.cache) return false;
  const hasB = m.member.roles.cache.has(IDS.bypass);
  const hasAB = m.member.roles.cache.has(IDS.antiBypass);
  return hasB && !hasAB;
};

const updateCountsChannels = async () => {
  try {
    const ec = await client.channels.fetch(config.channelId);
    if (ec) await renameChannel(ec, `Executions: ${executionCount}`);
    const mc = await client.channels.fetch(config.memberChannelId);
    if (mc) { await mc.guild.members.fetch(); memberCount = mc.guild.members.cache.filter(m => !m.user.bot).size; await renameChannel(mc, `Member: ${memberCount}`); }
  } catch {}
};

const ensureTicketInfra = async (guild, hintChannel) => {
  if (setupConfig.ticketCategory) {
    const cat = await guild.channels.fetch(setupConfig.ticketCategory).catch(() => null);
    if (cat && cat.type === ChannelType.GuildCategory) return cat;
  }
  let cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === '</> Tickets </>');
  if (!cat) cat = await guild.channels.create({ name: '</> Tickets </>', type: ChannelType.GuildCategory, permissionOverwrites: [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: IDS.staff, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels] }] }).catch(() => null);
  if (!cat) return null;

  if (!setupConfig.ticketLogs) {
    let logs = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === 'ticket-logs');
    if (!logs) logs = await guild.channels.create({ name: 'ticket-logs', type: ChannelType.GuildText, parent: hintChannel?.parentId ?? null, permissionOverwrites: [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: IDS.staff, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] }).catch(() => null);
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
    for (const m of msgs.values()) if (!m.author.bot && !m.webhookId && !m.member) needFetch.add(m.author.id);
    if (needFetch.size) await guild.members.fetch({ user: [...needFetch] }).catch(() => {});

    const del = [];
    for (const m of msgs.values()) {
      if (m.author.bot || m.webhookId) { del.push(m.id); continue; }
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

client.once('ready', async () => {
  console.log('Bot ready');
  setupConfig = readSetup();
  executionCount = readExecutions();
  await updateCountsChannels();
  setInterval(updateCountsChannels, 600000);

  const commands = [
    new SlashCommandBuilder().setName('mute').setDescription('Timeout a user').addUserOption(o => o.setName('user').setDescription('User to timeout').setRequired(true)).addStringOption(o => o.setName('duration').setDescription('Duration (e.g., 10s, 5m, 1h, 2d)').setRequired(true)),
    new SlashCommandBuilder().setName('unmute').setDescription('Remove timeout from a user').addUserOption(o => o.setName('user').setDescription('User to unmute').setRequired(true)),
    new SlashCommandBuilder().setName('setup').setDescription('Setup bot features').addStringOption(o => o.setName('feature').setDescription('Feature to setup').setRequired(true).addChoices({ name: 'Tickets', value: 'tickets' }, { name: 'Welcome', value: 'welcome' })).addChannelOption(o => o.setName('channel').setDescription('Channel for the feature').setRequired(true).addChannelTypes(ChannelType.GuildText)),
    new SlashCommandBuilder().setName('resetup').setDescription('Remove bot setup').addStringOption(o => o.setName('feature').setDescription('Feature to remove').setRequired(true).addChoices({ name: 'Tickets', value: 'tickets' }, { name: 'Welcome', value: 'welcome' })),
    new SlashCommandBuilder().setName('clear').setDescription('Clear messages in this channel').addIntegerOption(o => o.setName('amount').setDescription('Number of messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)).addUserOption(o => o.setName('user').setDescription('Only delete messages from this user').setRequired(false)),
    new SlashCommandBuilder().setName('autoclear').setDescription('Start auto-clearing messages in this channel'),
    new SlashCommandBuilder().setName('autoclearoff').setDescription('Stop auto-clearing messages in this channel')
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(config.token);
  try { await rest.put(Routes.applicationCommands(client.user.id), { body: commands }); } catch {}
});

client.on('guildMemberAdd', async (m) => {
  await updateCountsChannels();
  if (setupConfig.welcome) {
    try {
      const c = await client.channels.fetch(setupConfig.welcome);
      if (c) await c.send(`Welcome to **Zenk Studios**, ${m}`);
    } catch {}
  }
});

client.on('guildMemberRemove', updateCountsChannels);

client.on('messageCreate', async (m) => {
  const bypass = checkBypass(m);

  if (autoClearChannels.has(m.channelId) && !bypass) {
    await m.delete().catch(() => {});
    return;
  }

  try {
    const now = Date.now();
    const content = m.content || '';
    const contentLower = content.toLowerCase();

    const senderId = m.webhookId || m.author.id;
    const userKey = `${m.channel.id}::${senderId}`;
    
    if (!messageHistory.has(userKey)) messageHistory.set(userKey, []);
    const history = messageHistory.get(userKey).filter(h => now - h.timestamp < 120000);
    
    const isDuplicate = history.some(h => h.content === content);
    
    if (isDuplicate && !bypass) {
      await m.delete().catch(() => {});
      return;
    }
    
    history.push({ content, timestamp: now, messageId: m.id });
    messageHistory.set(userKey, history);

    if (m.author.bot && !m.webhookId) return;

    if (!m.webhookId) {
      if (!bypass) {
        if (content.match(/^#{1,6}\s/)) { await m.delete().catch(() => {}); return; }

        if (!userSpamTracker.has(m.author.id)) userSpamTracker.set(m.author.id, []);
        const spamHistory = userSpamTracker.get(m.author.id).filter(t => now - t < 3000);
        spamHistory.push(now);
        userSpamTracker.set(m.author.id, spamHistory);
        if (spamHistory.length >= 5) {
          const h = messageHistory.get(userKey) || [];
          await bulkDelete(m.channel, h.slice(-5).map(x => x.messageId));
          if (m.member?.moderatable) try { await m.member.timeout(TIMEOUTS.spam, 'Message spam'); } catch {}
          userSpamTracker.delete(m.author.id);
          return;
        }

        const mentionCount = (content.match(/<@!?\d+>/g) || []).length + (content.match(/<@&\d+>/g) || []).length;
        if (mentionCount > 5) {
          await m.delete().catch(() => {});
          if (m.member?.moderatable) try { await m.member.timeout(TIMEOUTS.spam, 'Mention spam'); } catch {}
          return;
        }

        const hasLinkRole = m.member?.roles.cache.has(IDS.bypass) || m.member?.roles.cache.has(IDS.linkAllowed2);
        const hasAnti = m.member?.roles.cache.has(IDS.antiBypass);
        const discordInviteRegex = /(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/[a-zA-Z0-9]+/gi;
        if (!(hasLinkRole && !hasAnti) && discordInviteRegex.test(content)) {
          await m.delete().catch(() => {});
          if (m.member?.moderatable) {
            try {
              await m.member.timeout(TIMEOUTS.linkBlock, 'Discord invite link');
              await m.author.send({
                embeds: [new EmbedBuilder().setTitle('⛔ You have been timed out').setDescription('You have been timed out for **5 minutes** because you sent a Discord invite link.').addFields({ name: 'Your message', value: `\`\`\`${content.substring(0, 1000)}\`\`\`` }).setColor('#ff0000').setTimestamp()]
              }).catch(() => {});
            } catch {}
          }
          return;
        }

        const urls = content.match(/https?:\/\/[^\s]+/gi) || [];
        for (const url of urls) {
          if (PHISHING_DOMAINS.some(d => url.toLowerCase().includes(d))) {
            await m.delete().catch(() => {});
            if (m.member?.moderatable) try { await m.member.timeout(TIMEOUTS.linkBlock, 'Phishing link detected'); } catch {}
            await sendLog(new EmbedBuilder().setTitle('🚨 Phishing Link Detected').addFields({ name: 'User', value: `${m.author.tag} (${m.author.id})`, inline: true }, { name: 'Channel', value: `${m.channel}`, inline: true }, { name: 'URL', value: url.substring(0, 1024) }).setColor('#ff0000').setTimestamp());
            return;
          }
        }

        if (m.channel.id !== IDS.tradeExcluded && (contentLower.includes('trade') || contentLower.includes('trading') || contentLower.includes('trades'))) {
          await m.delete().catch(() => {});
          try { await m.author.send('Please use the trading channel for trades, not other channels.'); } catch {}
          return;
        }

        if (checkMsg(m)) {
          await m.delete().catch(() => {});
          if (m.member?.moderatable) try { await m.member.timeout(TIMEOUTS.blacklist, 'Blacklisted word'); } catch {}
          return;
        }
      }
      return;
    }

    const wId = m.webhookId;
    if (webhookCooldown.has(wId) && now < webhookCooldown.get(wId)) return m.delete().catch(() => {});

    if (m.author.username !== 'Zenk') {
      await m.delete().catch(() => {});
      await restoreWebhook(wId, m.channelId);
      await sendLog(new EmbedBuilder().setTitle('⚠️ Webhook Name Violation').addFields({ name: 'Webhook', value: m.author.username, inline: true }, { name: 'ID', value: wId, inline: true }).setColor('#ff0000').setTimestamp());
      return;
    }

    if (checkMsg(m)) {
      await m.delete().catch(() => {});
      await sendLog(new EmbedBuilder().setTitle('🚫 Webhook Blacklist').addFields({ name: 'Webhook', value: m.author.username, inline: true }, { name: 'Content', value: content.substring(0, 1024) || 'No content' }).setColor('#ff0000').setTimestamp());
      return;
    }

    if (!webhookTracker.has(wId)) webhookTracker.set(wId, []);
    const list = webhookTracker.get(wId);
    list.push({ timestamp: now, messageId: m.id });
    const recent = list.filter(x => now - x.timestamp < 8000);
    webhookTracker.set(wId, recent);

    if (recent.length >= 10) {
      await bulkDelete(m.channel, recent.map(x => x.messageId));
      webhookCooldown.set(wId, now + 30000);
      webhookTracker.set(wId, []);
      await sendLog(new EmbedBuilder().setTitle('⚡ Webhook Rate Limit').addFields({ name: 'Webhook', value: m.author.username, inline: true }, { name: 'Messages', value: `${recent.length}`, inline: true }).setColor('#ffa500').setTimestamp());
    }
  } catch {}
});

client.on('webhookUpdate', async (c) => { try { const whs = await c.fetchWebhooks(); whs.forEach(async (wh) => { if (wh.name !== 'Zenk') await wh.edit({ name: 'Zenk' }); }); } catch {} });

client.on('interactionCreate', async (i) => {
  try {
    if (i.isChatInputCommand()) {
      if (i.commandName === 'mute') {
        if (!i.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return i.reply({ content: 'No permissions', ephemeral: true });
        const user = i.options.getUser('user'), duration = i.options.getString('duration'), ms = parseDuration(duration);
        if (!ms || ms > 2419200000) return i.reply({ content: 'Invalid duration (max 28d)', ephemeral: true });
        const member = await i.guild.members.fetch(user.id);
        if (!member.moderatable) return i.reply({ content: 'Cannot timeout this user', ephemeral: true });
        await member.timeout(ms, `Timed out by ${i.user.tag}`);
        await i.reply({ content: `Timed out ${user.tag} for ${duration}`, ephemeral: true });
        await sendLog(new EmbedBuilder().setTitle('⏱️ User Timed Out').addFields({ name: 'User', value: `${user.tag}`, inline: true }, { name: 'Duration', value: duration, inline: true }, { name: 'Mod', value: i.user.tag }).setColor('#ffa500').setTimestamp());
      } else if (i.commandName === 'unmute') {
        if (!i.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return i.reply({ content: 'No permissions', ephemeral: true });
        const user = i.options.getUser('user'), member = await i.guild.members.fetch(user.id);
        if (!member.moderatable) return i.reply({ content: 'Cannot unmute this user', ephemeral: true });
        await member.timeout(null, `Unmuted by ${i.user.tag}`);
        await i.reply({ content: `Unmuted ${user.tag}`, ephemeral: true });
        await sendLog(new EmbedBuilder().setTitle('✅ Timeout Removed').addFields({ name: 'User', value: user.tag, inline: true }, { name: 'Mod', value: i.user.tag, inline: true }).setColor('#00ff00').setTimestamp());
      } else if (i.commandName === 'setup') {
        if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) return i.reply({ content: 'No permissions', ephemeral: true });
        
        await i.deferReply({ ephemeral: true });
        
        const feature = i.options.getString('feature'), channel = i.options.getChannel('channel');
        if (feature === 'tickets') {
          const cat = await ensureTicketInfra(i.guild, channel);
          if (cat) {
            await channel.send({
              embeds: [new EmbedBuilder().setTitle('🎫 Ticket System').setDescription('Select a category to open a support ticket.').setColor('#5865F2').setTimestamp()],
              components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket-select').setPlaceholder('Select ticket type').addOptions(new StringSelectMenuOptionBuilder().setLabel('None').setValue('none').setDescription('Deselect'), new StringSelectMenuOptionBuilder().setLabel('Support').setValue('support').setDescription('Bug reports or questions')))]
            });
          }
        }
        setupConfig[feature] = channel.id;
        writeSetup(setupConfig);
        await i.editReply({ content: `Setup complete: ${feature} → ${channel}` });
      } else if (i.commandName === 'resetup') {
        if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) return i.reply({ content: 'No permissions', ephemeral: true });
        const feature = i.options.getString('feature');
        if (setupConfig[feature]) {
          if (feature === 'tickets') {
            if (setupConfig.ticketCategory) {
              const cat = await i.guild.channels.fetch(setupConfig.ticketCategory).catch(() => null);
              if (cat) { for (const [, ch] of i.guild.channels.cache.filter(c => c.parentId === cat.id)) await ch.delete().catch(() => {}); await cat.delete().catch(() => {}); }
            }
            if (setupConfig.ticketLogs) { const logs = await i.guild.channels.fetch(setupConfig.ticketLogs).catch(() => null); if (logs) await logs.delete().catch(() => {}); }
            activeTickets.clear();
            delete setupConfig.ticketCategory;
            delete setupConfig.ticketLogs;
          }
          delete setupConfig[feature];
          writeSetup(setupConfig);
          await i.reply({ content: `Removed setup: ${feature}`, ephemeral: true });
        } else await i.reply({ content: `No setup found: ${feature}`, ephemeral: true });
      } else if (i.commandName === 'clear') {
        if (!i.member.permissions.has(PermissionFlagsBits.ManageMessages)) return i.reply({ content: 'No permissions', ephemeral: true });
        const amount = i.options.getInteger('amount'), targetUser = i.options.getUser('user');
        const fetched = await i.channel.messages.fetch({ limit: amount });
        let toDelete = fetched;
        if (targetUser) {
          const arr = fetched.filter(m => m.author.id === targetUser.id).first(amount);
          if (arr) toDelete = fetched.filter(m => arr.map(a => a.id).includes(m.id));
        }
        if (!toDelete?.size) return i.reply({ content: 'No messages found', ephemeral: true });
        const deleted = await i.channel.bulkDelete(toDelete, true);
        await i.reply({ content: `Deleted ${deleted.size} message(s)${targetUser ? ` from ${targetUser.tag}` : ''}.`, ephemeral: true });
      } else if (i.commandName === 'autoclear') {
        if (!i.member.permissions.has(PermissionFlagsBits.ManageMessages)) return i.reply({ content: 'No permissions', ephemeral: true });
        await i.reply({ content: startAutoClear(i.channelId) ? 'AutoClear activated! Use `/autoclearoff` to stop.' : 'AutoClear is already active', ephemeral: true });
      } else if (i.commandName === 'autoclearoff') {
        if (!i.member.permissions.has(PermissionFlagsBits.ManageMessages)) return i.reply({ content: 'No permissions', ephemeral: true });
        await i.reply({ content: stopAutoClear(i.channelId) ? 'AutoClear deactivated' : 'AutoClear is not active', ephemeral: true });
      }
    } else if (i.isStringSelectMenu() && i.customId === 'ticket-select') {
      if (i.values[0] === 'none') return i.reply({ content: 'Selection cleared.', ephemeral: true });
      if (activeTickets.has(i.user.id)) return i.reply({ content: `You already have a ticket: <#${activeTickets.get(i.user.id)}>`, ephemeral: true });
      await i.showModal(new ModalBuilder().setCustomId('ticket-create-modal').setTitle('Create Support Ticket').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('executor-input').setLabel('Executor').setStyle(TextInputStyle.Short).setPlaceholder('Bunni, Delta...').setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('problem-input').setLabel('What is your problem?').setStyle(TextInputStyle.Paragraph).setPlaceholder('Describe your issue...').setRequired(true))
      ));
    } else if (i.isButton() && i.customId === 'close-ticket') {
      await i.showModal(new ModalBuilder().setCustomId('close-ticket-modal').setTitle('Close Ticket').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('close-reason').setLabel('Reason for closing').setStyle(TextInputStyle.Paragraph).setRequired(true))
      ));
    } else if (i.isModalSubmit()) {
      if (i.customId === 'ticket-create-modal') {
        const executor = i.fields.getTextInputValue('executor-input'), problem = i.fields.getTextInputValue('problem-input');
        await i.deferReply({ ephemeral: true });

        const cat = await ensureTicketInfra(i.guild, i.channel);
        if (!cat) return i.editReply({ content: '❌ Ticket category could not be created.' });

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
          embeds: [new EmbedBuilder().setTitle('🎫 Support Ticket').addFields(
            { name: 'User', value: `${i.user}`, inline: true },
            { name: 'Executor:', value: executor, inline: true },
            { name: 'Problem:', value: problem }
          ).setColor('#5865F2').setTimestamp()],
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close-ticket').setLabel('Close').setStyle(ButtonStyle.Danger))]
        });

        await msg.pin().catch(() => {});
        await i.editReply({ content: `✅ Ticket created: ${ticketChannel}` });
        await sendLog(new EmbedBuilder().setTitle('🎫 Ticket Created').addFields({ name: 'User', value: i.user.tag }, { name: 'Channel', value: ticketChannel.name }, { name: 'Executor', value: executor }).setColor('#5865F2').setTimestamp());
      } else if (i.customId === 'close-ticket-modal') {
        const reason = i.fields.getTextInputValue('close-reason'), channel = i.channel;
        const ticketUser = Array.from(activeTickets.entries()).find(([, channelId]) => channelId === channel.id);
        if (!ticketUser) return i.reply({ content: 'Ticket user not found', ephemeral: true });
        const [userId] = ticketUser;
        activeTickets.delete(userId);

        await i.reply({ content: '✅ Closing ticket...', ephemeral: true });

        const user = await client.users.fetch(userId).catch(() => null);
        if (user) user.send({ embeds: [new EmbedBuilder().setTitle('🎫 Ticket Closed').setDescription(`Your ticket **${channel.name}** has been closed.`).addFields({ name: 'Reason', value: reason }).setColor('#ff0000').setTimestamp()] }).catch(() => {});

        if (setupConfig.ticketLogs) {
          const logs = await client.channels.fetch(setupConfig.ticketLogs).catch(() => null);
          if (logs) await logs.send({ embeds: [new EmbedBuilder().setTitle(`📋 Ticket: ${channel.name}`).addFields({ name: 'User', value: `<@${userId}>`, inline: true }, { name: 'Closed By', value: `<@${i.user.id}>`, inline: true }, { name: 'Reason', value: reason }).setColor('#ff0000').setTimestamp()] }).catch(() => {});
        }

        await sendLog(new EmbedBuilder().setTitle('🎫 Ticket Closed').addFields({ name: 'Channel', value: channel.name }, { name: 'User', value: user ? user.tag : userId }, { name: 'Closed By', value: i.user.tag }, { name: 'Reason', value: reason }).setColor('#ff0000').setTimestamp());
        setTimeout(async () => { try { await channel.delete(); } catch {} }, 5000);
      }
    }
  } catch {}
});

app.post('/rating', async (req, res) => {
  try {
    if (!client.isReady()) return res.status(503).json({ success: false, error: 'Bot not ready' });
    const { message, stars, timestamp } = req.body;
    if (!message || !stars || !timestamp) return res.status(400).json({ success: false, error: 'Missing fields' });
    const n = Number(stars);
    if (!Number.isFinite(n) || n < 1 || n > 5) return res.status(400).json({ success: false, error: 'Invalid stars' });
    const channel = await client.channels.fetch(IDS.rating).catch(() => null);
    if (!channel) return res.status(404).json({ success: false, error: 'Channel not found' });
    await channel.send(`## New Rating\n${message}\n\n**Rating:** ${'⭐'.repeat(n)}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/track', async (req, res) => {
  try {
    downloadCount++;
    const c = await client.channels.fetch(IDS.download).catch(() => null);
    if (c) await renameChannel(c, `Downloads: ${downloadCount}`);
    res.sendStatus(200);
  } catch { res.sendStatus(500); }
});

app.post('/execution', async (req, res) => {
  try {
    executionCount++;
    writeExecutions(executionCount);
    const now = Date.now();
    if (now - lastUpdate >= 480000) {
      const c = await client.channels.fetch(config.channelId).catch(() => null);
      if (c) { await renameChannel(c, `Executions: ${executionCount}`); lastUpdate = now; }
    }
    res.json({ success: true, count: executionCount });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/export', (req, res) => res.type('text/plain').send(String(executionCount)));
app.post('/import', (req, res) => { const n = Number(req.body?.count); if (!Number.isFinite(n) || n < 0) return res.status(400).json({ success: false }); executionCount = Math.floor(n); writeExecutions(executionCount); res.json({ success: true, count: executionCount }); });
app.get('/', (req, res) => res.json({ status: 'online', executions: executionCount, downloads: downloadCount, members: memberCount, ready: client.isReady() }));

app.listen(config.port || 3000, () => console.log('Server running'));
client.login(config.token);
