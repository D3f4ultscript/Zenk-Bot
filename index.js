const { Client, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder, REST, Routes, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildWebhooks] });

const app = express();
app.use(express.json());

const IDS = {
  staff: '1454608694850486313',
  log: '1456977089864400970',
  rating: '1454624341248708649',
  tradeExcluded: '1455105607332925553',
  linkAllowed: '1453892506801541201',
  downloads: '1455226125700694027'
};

const TIMEOUTS = { spam: 300000, link: 1200000, blacklist: 300000 };

const ALLOW_WORDS = new Set(['shit', 'fuck', 'damn', 'kys', 'kill yourself']);
const RAW_BLACKLIST = ['bitch','asshole','bastard','cunt','dick','cock','pussy','whore','slut','fag','faggot','nigger','nigga','retard','retarded','rape','nazi','hitler','motherfucker','bullshit','piss','prick','twat','wanker','bollocks','arse','tosser','bellend','scheiße','scheisse','scheiß','scheiss','ficken','fick','arsch','arschloch','fotze','hure','nutte','wichser','hurensohn','schwuchtel','schwul','dumm','idiot','trottel','vollidiot','drecksau','sau','schwein','drecksschwein','miststück','pisser','kacke','scheisskerl','wixer','spast','mongo','behinderter','opfer','penner','dreckskerl','arschlecker','pissnelke','fotznbrädl','möse','pimmel','schwanz','leck mich','verpiss dich','halt die fresse','fresse','halt maul','maul'];
const BLACKLIST_WEBHOOK = RAW_BLACKLIST.filter(w => !ALLOW_WORDS.has(w));
const BLACKLIST_USERS = BLACKLIST_WEBHOOK.filter(w => w !== 'ass');

const PHISHING_DOMAINS = ['discord-nitro','steamcommunity-trade','free-nitro','steamcommunitty','discordapp-gift','discordgift','grabify.link','iplogger.org','blasze.tk','freegiftcodes'];

const executionsFile = path.join(__dirname, 'Executions.txt');
const setupFile = path.join(__dirname, 'Setup.json');

const webhookTracker = new Map();
const webhookCooldown = new Map();
const autoClearChannels = new Map();
const messageHistory = new Map();
const spamTracker = new Map();
const activeTickets = new Map();
const ratingDedup = new Map();

let setupConfig = {};
let executionCount = 0;
let downloadCount = 0;
let lastUpdate = 0;

const parseExecutions = (name) => { const m = String(name || '').match(/Executions:\s*(\d+)/i); return m ? Number(m[1]) : null; };
const readNum = (file) => { try { if (!fs.existsSync(file)) return null; const n = Number(fs.readFileSync(file, 'utf8').trim()); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null; } catch { return null; } };
const writeNum = (file, n) => { try { fs.writeFileSync(file, String(n)); return true; } catch { return false; } };
const readSetup = () => { try { if (!fs.existsSync(setupFile)) return {}; return JSON.parse(fs.readFileSync(setupFile, 'utf8')); } catch { return {}; } };
const writeSetup = (d) => { try { fs.writeFileSync(setupFile, JSON.stringify(d, null, 2)); return true; } catch { return false; } };
const fetchVC = async (id) => { const c = await client.channels.fetch(id).catch(() => null); return c?.isVoiceBased?.() ? c : null; };
const renameChannel = async (c, n) => { try { return c?.permissionsFor(client.user)?.has(PermissionFlagsBits.ManageChannels) ? !!(await c.setName(n)) : false; } catch { return false; } };
const hasBlacklist = (t, bl) => { if (!t) return false; const l = t.toLowerCase(); return bl.some(w => l.includes(w)); };
const checkMsg = (m, bl) => {
  if (hasBlacklist(m.content, bl)) return true;
  if (m.embeds?.length) for (const e of m.embeds) {
    if (hasBlacklist(e.title, bl) || hasBlacklist(e.description, bl) || hasBlacklist(e.footer?.text, bl) || hasBlacklist(e.author?.name, bl)) return true;
    if (e.fields?.length) for (const f of e.fields) if (hasBlacklist(f.name, bl) || hasBlacklist(f.value, bl)) return true;
  }
  return false;
};
const parseDuration = (s) => { const m = String(s || '').match(/^(\d+)([smhd])$/); if (!m) return null; return parseInt(m[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2]]; };
const sendLog = async (e) => { try { const c = await client.channels.fetch(IDS.log).catch(() => null); if (c) await c.send({ embeds: [e] }); } catch {} };
const restoreWebhook = async (wId, cId) => { try { const c = await client.channels.fetch(cId).catch(() => null); if (!c) return; const whs = await c.fetchWebhooks().catch(() => null); const wh = whs?.get(wId); if (wh && wh.name !== 'Zenk') await wh.edit({ name: 'Zenk' }); } catch {} };
const bulkDelete = async (c, ids) => { try { const v = ids.filter(Boolean); if (!v.length) return; if (v.length === 1) { const m = await c.messages.fetch(v[0]).catch(() => null); if (m) await m.delete().catch(() => {}); } else await c.bulkDelete(v, true).catch(() => {}); } catch {} };

const normEmbeds = (embeds) => embeds?.length ? JSON.stringify(embeds.map(e => ({
  t: e.title || '', d: e.description || '', u: e.url || '',
  a: e.author?.name || '', f: e.footer?.text || '',
  fi: e.fields?.map(x => [x.name || '', x.value || '']) || [],
  i: e.image?.url || '', th: e.thumbnail?.url || '', c: e.color || 0
}))): '';

const msgSig = (m) => `${m.content || ''}|${normEmbeds(m.embeds)}`;

const trackDup = async (m) => {
  const authorKey = m.webhookId ? `w:${m.webhookId}` : `u:${m.author.id}`;
  const key = `${m.channelId}-${authorKey}`;
  const now = Date.now();
  const sig = msgSig(m);
  const hist = (messageHistory.get(key) || []).filter(x => now - x.t < 120000);
  if (hist.some(x => x.s === sig)) return true;
  hist.push({ s: sig, t: now });
  if (hist.length > 25) hist.splice(0, hist.length - 25);
  messageHistory.set(key, hist);
  return false;
};

const updateMembers = async () => {
  try {
    const c = await fetchVC(config.memberChannelId);
    if (!c) return;
    await c.guild.members.fetch().catch(() => {});
    const count = c.guild.members.cache.filter(m => !m.user.bot).size;
    await renameChannel(c, `Member: ${count}`);
  } catch {}
};

const updateExecutions = async (force = false) => {
  try {
    const c = await fetchVC(config.channelId);
    if (!c) return;
    const now = Date.now();
    if (!force && now - lastUpdate < 480000) return;
    if (await renameChannel(c, `Executions: ${executionCount}`)) lastUpdate = now;
  } catch {}
};

const autoClearLoop = async (channelId) => {
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (messages?.size) await channel.bulkDelete(messages, true).catch(() => {});
  } catch {}
};

const startAutoClear = (channelId) => {
  if (autoClearChannels.has(channelId)) return false;
  autoClearChannels.set(channelId, setInterval(() => autoClearLoop(channelId), 5000));
  return true;
};

const stopAutoClear = (channelId) => {
  const i = autoClearChannels.get(channelId);
  if (!i) return false;
  clearInterval(i);
  autoClearChannels.delete(channelId);
  return true;
};

client.once('ready', async () => {
  setupConfig = readSetup();

  const fromFile = readNum(executionsFile);
  if (fromFile !== null) executionCount = fromFile;

  const c = await fetchVC(config.channelId);
  if (c) {
    if (fromFile === null) executionCount = parseExecutions(c.name) ?? 0;
    writeNum(executionsFile, executionCount);
    await renameChannel(c, `Executions: ${executionCount}`);
    lastUpdate = Date.now();
  }

  await updateMembers();
  setInterval(updateMembers, 600000);

  const commands = [
    new SlashCommandBuilder().setName('mute').setDescription('Timeout a user').addUserOption(o => o.setName('user').setDescription('User to timeout').setRequired(true)).addStringOption(o => o.setName('duration').setDescription('Duration (e.g., 10s, 5m, 1h, 2d)').setRequired(true)),
    new SlashCommandBuilder().setName('unmute').setDescription('Remove timeout from a user').addUserOption(o => o.setName('user').setDescription('User to unmute').setRequired(true)),
    new SlashCommandBuilder().setName('setup').setDescription('Setup bot features').addStringOption(o => o.setName('feature').setDescription('Feature to setup').setRequired(true).addChoices({ name: 'Welcome', value: 'welcome' }, { name: 'Tickets', value: 'tickets' })).addChannelOption(o => o.setName('channel').setDescription('Channel for the feature').setRequired(true).addChannelTypes(ChannelType.GuildText)),
    new SlashCommandBuilder().setName('resetup').setDescription('Remove bot setup').addStringOption(o => o.setName('feature').setDescription('Feature to remove').setRequired(true).addChoices({ name: 'Welcome', value: 'welcome' }, { name: 'Tickets', value: 'tickets' })),
    new SlashCommandBuilder().setName('clear').setDescription('Clear messages in this channel').addIntegerOption(o => o.setName('amount').setDescription('Number of messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)).addUserOption(o => o.setName('user').setDescription('Only delete messages from this user').setRequired(false)),
    new SlashCommandBuilder().setName('autoclear').setDescription('Start auto-clearing messages in this channel'),
    new SlashCommandBuilder().setName('autoclearoff').setDescription('Stop auto-clearing messages in this channel')
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(config.token);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands }).catch(() => {});
});

client.on('guildMemberAdd', async (member) => {
  await updateMembers();
  if (setupConfig.welcome) {
    const channel = await client.channels.fetch(setupConfig.welcome).catch(() => null);
    if (channel?.isTextBased?.()) channel.send(`Welcome to **Zenk Studios**, ${member}`).catch(() => {});
  }
});

client.on('guildMemberRemove', updateMembers);

client.on('messageCreate', async (m) => {
  try {
    if (autoClearChannels.has(m.channelId) && !m.author.bot && !m.webhookId) return void m.delete().catch(() => {});
    if (await trackDup(m)) return void m.delete().catch(() => {});

    if (!m.webhookId && !m.author.bot) {
      const now = Date.now();
      const content = m.content || '';
      const contentLower = content.toLowerCase();

      if (/^#{1,6}\s/.test(content)) return void m.delete().catch(() => {});

      const spamKey = `${m.channelId}-${m.author.id}`;
      const s = (spamTracker.get(spamKey) || []).filter(x => now - x.t < 3000);
      s.push({ t: now, id: m.id });
      spamTracker.set(spamKey, s);
      if (s.length >= 5) {
        await bulkDelete(m.channel, s.map(x => x.id));
        if (m.member?.moderatable) await m.member.timeout(TIMEOUTS.spam, 'Message spam').catch(() => {});
        spamTracker.delete(spamKey);
        return;
      }

      const mentionCount = (content.match(/<@!?\d+>/g) || []).length + (content.match(/<@&\d+>/g) || []).length;
      if (mentionCount > 5) {
        await m.delete().catch(() => {});
        if (m.member?.moderatable) await m.member.timeout(TIMEOUTS.spam, 'Mention spam').catch(() => {});
        return;
      }

      const hasLinkRole = m.member?.roles?.cache?.has(IDS.linkAllowed);
      const inviteRe = /(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/[a-zA-Z0-9]+/i;
      if (!hasLinkRole && inviteRe.test(content)) {
        await m.delete().catch(() => {});
        if (m.member?.moderatable) await m.member.timeout(TIMEOUTS.link, 'Discord invite link').catch(() => {});
        await m.author.send({
          embeds: [new EmbedBuilder()
            .setTitle('You have been timed out')
            .setDescription('You have been timed out for **20 minutes** because you sent a Discord invite link.')
            .addFields({ name: 'Your message', value: `\`\`\`\n${content.substring(0, 1500)}\n\`\`\`` })
            .setColor('#ff0000')
            .setTimestamp()
          ]
        }).catch(() => {});
        return;
      }

      const urls = content.match(/https?:\/\/[^\s]+/gi) || [];
      for (const u of urls) {
        const lu = u.toLowerCase();
        if (PHISHING_DOMAINS.some(d => lu.includes(d))) {
          await m.delete().catch(() => {});
          if (m.member?.moderatable) await m.member.timeout(TIMEOUTS.link, 'Phishing link detected').catch(() => {});
          await sendLog(new EmbedBuilder().setTitle('Phishing link detected').addFields({ name: 'User', value: `${m.author.tag} (${m.author.id})`, inline: true }, { name: 'Channel', value: `${m.channel}`, inline: true }, { name: 'URL', value: u.substring(0, 1024) }).setColor('#ff0000').setTimestamp());
          return;
        }
      }

      if (m.channelId !== IDS.tradeExcluded && (contentLower.includes('trade') || contentLower.includes('trading'))) m.reply({ content: 'Please use the trading channel for trades, not this channel.', allowedMentions: { repliedUser: false } }).catch(() => {});

      if (checkMsg(m, BLACKLIST_USERS)) {
        await m.delete().catch(() => {});
        if (m.member?.moderatable) await m.member.timeout(TIMEOUTS.blacklist, 'Blacklisted word').catch(() => {});
        return;
      }
    }

    if (m.webhookId) {
      const wId = m.webhookId, now = Date.now();
      if (webhookCooldown.has(wId)) {
        if (now < webhookCooldown.get(wId)) return void m.delete().catch(() => {});
        webhookCooldown.delete(wId);
        webhookTracker.delete(wId);
      }

      if (m.author.username !== 'Zenk') {
        await m.delete().catch(() => {});
        await restoreWebhook(wId, m.channelId);
        return;
      }

      if (checkMsg(m, BLACKLIST_WEBHOOK)) return void m.delete().catch(() => {});

      const list = webhookTracker.get(wId) || [];
      list.push({ t: now, id: m.id });
      const recent = list.filter(x => now - x.t < 8000);
      webhookTracker.set(wId, recent);
      if (recent.length >= 10) {
        await bulkDelete(m.channel, recent.map(x => x.id));
        webhookCooldown.set(wId, now + 30000);
        webhookTracker.set(wId, []);
      }
    }
  } catch {}
});

client.on('webhookUpdate', async (c) => {
  try {
    const whs = await c.fetchWebhooks().catch(() => null);
    whs?.forEach(async (wh) => { if (wh.name !== 'Zenk') await wh.edit({ name: 'Zenk' }).catch(() => {}); });
  } catch {}
});

client.on('interactionCreate', async (i) => {
  try {
    if (i.isChatInputCommand()) {
      if (i.commandName === 'mute') {
        if (!i.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return void i.reply({ content: 'No permissions', ephemeral: true });
        const user = i.options.getUser('user');
        const ms = parseDuration(i.options.getString('duration'));
        if (!ms || ms > 2419200000) return void i.reply({ content: 'Invalid duration (max 28d)', ephemeral: true });
        const member = await i.guild.members.fetch(user.id);
        if (!member.moderatable) return void i.reply({ content: 'Cannot timeout this user', ephemeral: true });
        await member.timeout(ms, `Timed out by ${i.user.tag}`).catch(() => {});
        return void i.reply({ content: `Timed out ${user.tag} for ${i.options.getString('duration')}`, ephemeral: true });
      }

      if (i.commandName === 'unmute') {
        if (!i.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return void i.reply({ content: 'No permissions', ephemeral: true });
        const user = i.options.getUser('user');
        const member = await i.guild.members.fetch(user.id);
        if (!member.moderatable) return void i.reply({ content: 'Cannot unmute this user', ephemeral: true });
        await member.timeout(null, `Unmuted by ${i.user.tag}`).catch(() => {});
        return void i.reply({ content: `Unmuted ${user.tag}`, ephemeral: true });
      }

      if (i.commandName === 'setup') {
        if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) return void i.reply({ content: 'No permissions', ephemeral: true });
        const feature = i.options.getString('feature');
        const channel = i.options.getChannel('channel');

        if (feature === 'welcome') {
          setupConfig.welcome = channel.id;
          writeSetup(setupConfig);
          return void i.reply({ content: `Setup complete: welcome → ${channel}`, ephemeral: true });
        }

        if (feature === 'tickets') {
          let ticketCategory = i.guild.channels.cache.find(c => c.name === '</> Tickets </>' && c.type === ChannelType.GuildCategory);
          if (!ticketCategory) ticketCategory = await i.guild.channels.create({ name: '</> Tickets </>', type: ChannelType.GuildCategory, permissionOverwrites: [{ id: i.guild.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: IDS.staff, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels] }] });
          let ticketLogs = i.guild.channels.cache.find(c => c.name === 'ticket-logs' && c.type === ChannelType.GuildText);
          if (!ticketLogs) ticketLogs = await i.guild.channels.create({ name: 'ticket-logs', type: ChannelType.GuildText, parent: channel.parent, permissionOverwrites: [{ id: i.guild.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: IDS.staff, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] });

          await channel.send({
            embeds: [new EmbedBuilder().setTitle('Ticket System').setDescription('Select a category to open a support ticket.').setColor('#5865F2').setTimestamp()],
            components: [new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder().setCustomId('ticket-select').setPlaceholder('Select ticket type').addOptions(
                new StringSelectMenuOptionBuilder().setLabel('None').setValue('none').setDescription('Deselect'),
                new StringSelectMenuOptionBuilder().setLabel('Support').setValue('support').setDescription('Bug reports or questions')
              )
            )]
          });

          setupConfig.tickets = channel.id;
          setupConfig.ticketCategory = ticketCategory.id;
          setupConfig.ticketLogs = ticketLogs.id;
          writeSetup(setupConfig);
          return void i.reply({ content: `Setup complete: tickets → ${channel}`, ephemeral: true });
        }

        return void i.reply({ content: 'Unknown feature', ephemeral: true });
      }

      if (i.commandName === 'resetup') {
        if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) return void i.reply({ content: 'No permissions', ephemeral: true });
        const feature = i.options.getString('feature');

        if (feature === 'welcome') {
          if (!setupConfig.welcome) return void i.reply({ content: 'No setup found for: welcome', ephemeral: true });
          delete setupConfig.welcome;
          writeSetup(setupConfig);
          return void i.reply({ content: 'Removed setup: welcome', ephemeral: true });
        }

        if (feature === 'tickets') {
          if (!setupConfig.tickets) return void i.reply({ content: 'No setup found for: tickets', ephemeral: true });

          const cat = setupConfig.ticketCategory ? await i.guild.channels.fetch(setupConfig.ticketCategory).catch(() => null) : null;
          if (cat) {
            for (const [, ch] of i.guild.channels.cache.filter(c => c.parentId === cat.id)) await ch.delete().catch(() => {});
            await cat.delete().catch(() => {});
          }
          const logs = setupConfig.ticketLogs ? await i.guild.channels.fetch(setupConfig.ticketLogs).catch(() => null) : null;
          if (logs) await logs.delete().catch(() => {});

          activeTickets.clear();
          delete setupConfig.tickets;
          delete setupConfig.ticketCategory;
          delete setupConfig.ticketLogs;
          writeSetup(setupConfig);
          return void i.reply({ content: 'Removed setup: tickets', ephemeral: true });
        }

        return void i.reply({ content: 'Unknown feature', ephemeral: true });
      }

      if (i.commandName === 'clear') {
        if (!i.member.permissions.has(PermissionFlagsBits.ManageMessages)) return void i.reply({ content: 'No permissions', ephemeral: true });
        const amount = i.options.getInteger('amount');
        const targetUser = i.options.getUser('user');
        const fetched = await i.channel.messages.fetch({ limit: amount }).catch(() => null);
        if (!fetched?.size) return void i.reply({ content: 'No messages found', ephemeral: true });
        let toDelete = fetched;
        if (targetUser) {
          const arr = fetched.filter(m => m.author.id === targetUser.id).first(amount);
          if (!arr?.length) return void i.reply({ content: 'No messages found', ephemeral: true });
          const ids = new Set(arr.map(x => x.id));
          toDelete = fetched.filter(m => ids.has(m.id));
        }
        const deleted = await i.channel.bulkDelete(toDelete, true).catch(() => null);
        return void i.reply({ content: `Deleted ${deleted?.size || 0} message(s)${targetUser ? ` from ${targetUser.tag}` : ''}.`, ephemeral: true });
      }

      if (i.commandName === 'autoclear') {
        if (!i.member.permissions.has(PermissionFlagsBits.ManageMessages)) return void i.reply({ content: 'No permissions', ephemeral: true });
        return void i.reply({ content: startAutoClear(i.channelId) ? 'AutoClear activated! Use /autoclearoff to stop.' : 'AutoClear is already active in this channel.', ephemeral: true });
      }

      if (i.commandName === 'autoclearoff') {
        if (!i.member.permissions.has(PermissionFlagsBits.ManageMessages)) return void i.reply({ content: 'No permissions', ephemeral: true });
        return void i.reply({ content: stopAutoClear(i.channelId) ? 'AutoClear deactivated.' : 'AutoClear is not active in this channel.', ephemeral: true });
      }
    }

    if (i.isStringSelectMenu() && i.customId === 'ticket-select') {
      if (i.values[0] === 'none') return void i.reply({ content: 'Selection cleared.', ephemeral: true });
      if (activeTickets.has(i.user.id)) return void i.reply({ content: `You already have a ticket: <#${activeTickets.get(i.user.id)}>`, ephemeral: true });

      const modal = new ModalBuilder().setCustomId('ticket-create-modal').setTitle('Create Support Ticket');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('executor-input').setLabel('Executor').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('problem-input').setLabel('What is your problem?').setStyle(TextInputStyle.Paragraph).setRequired(true))
      );
      return void i.showModal(modal);
    }

    if (i.isButton() && i.customId === 'close-ticket') {
      const modal = new ModalBuilder().setCustomId('close-ticket-modal').setTitle('Close Ticket');
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('close-reason').setLabel('Reason for closing').setStyle(TextInputStyle.Paragraph).setRequired(true)));
      return void i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId === 'ticket-create-modal') {
      const executor = i.fields.getTextInputValue('executor-input');
      const problem = i.fields.getTextInputValue('problem-input');
      await i.reply({ content: 'Creating ticket...', ephemeral: true });

      const ticketChannel = await i.guild.channels.create({
        name: `support-${i.user.username.replace(/[^a-zA-Z0-9]/g, '')}`,
        type: ChannelType.GuildText,
        parent: setupConfig.ticketCategory,
        permissionOverwrites: [
          { id: i.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: IDS.staff, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
        ]
      });

      activeTickets.set(i.user.id, ticketChannel.id);

      const msg = await ticketChannel.send({
        content: `${i.user}`,
        embeds: [new EmbedBuilder().setTitle('Support Ticket').addFields({ name: 'User', value: `${i.user}`, inline: true }, { name: 'Executor', value: executor, inline: true }, { name: 'Problem', value: problem }).setColor('#5865F2').setTimestamp()],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close-ticket').setLabel('Close').setStyle(ButtonStyle.Danger))]
      });

      await msg.pin().catch(() => {});
      return void i.editReply({ content: `Ticket created: ${ticketChannel}`, ephemeral: true });
    }

    if (i.isModalSubmit() && i.customId === 'close-ticket-modal') {
      const reason = i.fields.getTextInputValue('close-reason');
      const channel = i.channel;
      const entry = Array.from(activeTickets.entries()).find(([, cid]) => cid === channel.id);
      if (!entry) return void i.reply({ content: 'Ticket user not found', ephemeral: true });

      const [userId] = entry;
      activeTickets.delete(userId);
      await i.reply({ content: 'Closing ticket...', ephemeral: true });

      const user = await client.users.fetch(userId).catch(() => null);
      if (user) user.send({ embeds: [new EmbedBuilder().setTitle('Ticket Closed').setDescription(`Your ticket **${channel.name}** has been closed.`).addFields({ name: 'Reason', value: reason }).setColor('#ff0000').setTimestamp()] }).catch(() => {});

      if (setupConfig.ticketLogs) {
        const logs = await client.channels.fetch(setupConfig.ticketLogs).catch(() => null);
        if (logs?.isTextBased?.()) logs.send({ embeds: [new EmbedBuilder().setTitle(`Ticket Closed: ${channel.name}`).addFields({ name: 'User', value: `<@${userId}>`, inline: true }, { name: 'Closed By', value: `<@${i.user.id}>`, inline: true }, { name: 'Reason', value: reason }).setColor('#ff0000').setTimestamp()] }).catch(() => {});
      }

      setTimeout(() => channel.delete().catch(() => {}), 5000);
    }
  } catch {}
});

app.post('/track', express.raw({ type: '*/*' }), async (req, res) => {
  downloadCount++;
  try {
    const ch = await client.channels.fetch(IDS.downloads).catch(() => null);
    if (ch) await renameChannel(ch, `Downloads: ${downloadCount}`);
    return res.sendStatus(200);
  } catch { return res.sendStatus(500); }
});

app.post('/rating', async (req, res) => {
  try {
    if (!client.isReady()) return res.status(503).json({ success: false, error: 'Bot not ready' });
    const { message, stars, timestamp } = req.body || {};
    if (!message || !stars || !timestamp) return res.status(400).json({ success: false, error: 'Missing fields' });

    const n = Number(stars);
    if (!Number.isFinite(n) || n < 1 || n > 5) return res.status(400).json({ success: false, error: 'Invalid stars' });

    const starEmojis = '⭐'.repeat(n);
    const date = new Date(timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const text = `## New Rating\n${String(message)}\n\n**Rating:** ${starEmojis}\n*${date}*`;

    const sig = `${String(message)}|${n}`;
    const now = Date.now();
    for (const [k, v] of ratingDedup) if (now - v > 120000) ratingDedup.delete(k);
    if (ratingDedup.has(sig)) return res.json({ success: true, deduped: true });
    ratingDedup.set(sig, now);

    const channel = await client.channels.fetch(IDS.rating).catch(() => null);
    if (!channel?.isTextBased?.()) return res.status(404).json({ success: false, error: 'Channel not found' });

    await channel.send(text).catch(() => {});
    return res.json({ success: true });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

app.post('/execution', async (req, res) => {
  try {
    executionCount++;
    writeNum(executionsFile, executionCount);
    await updateExecutions(false);
    res.json({ success: true, count: executionCount, lastUpdate: lastUpdate ? new Date(lastUpdate).toISOString() : 'never' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/export', async (req, res) => {
  try {
    const c = await fetchVC(config.channelId);
    if (!c) return res.status(404).type('text/plain').send('0');
    const n = parseExecutions(c.name);
    if (n === null) return res.type('text/plain').send('0');
    executionCount = n;
    writeNum(executionsFile, executionCount);
    res.type('text/plain').send(String(executionCount));
  } catch { res.status(500).type('text/plain').send(String(executionCount)); }
});

app.post('/import', async (req, res) => {
  const n = Number(req.body?.count);
  if (!Number.isFinite(n) || n < 0) return res.status(400).json({ success: false });
  executionCount = Math.floor(n);
  writeNum(executionsFile, executionCount);
  await updateExecutions(true);
  res.json({ success: true, count: executionCount });
});

app.get('/', (req, res) => res.json({ status: 'online', executions: executionCount, downloads: downloadCount, botReady: client.isReady() }));

app.listen(config.port || 3000, () => {});
client.login(config.token);
