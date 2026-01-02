const { Client, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder, REST, Routes, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
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
app.use(express.raw({ type: '*/*' }));

const BLACKLIST_WEBHOOK = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'damn', 'cunt', 'cock', 'pussy', 'whore', 'slut', 'fag', 'faggot', 'nigger', 'nigga', 'retard', 'retarded', 'rape', 'nazi', 'hitler', 'kys', 'kill yourself', 'motherfucker', 'bullshit', 'prick', 'twat', 'wanker', 'bollocks', 'scheiße', 'scheisse', 'scheiß', 'scheiss', 'ficken', 'fick', 'arschloch', 'fotze', 'hure', 'nutte', 'wichser', 'hurensohn', 'schwuchtel', 'schwul', 'drecksau', 'sau', 'schwein', 'drecksschwein', 'miststück', 'kacke', 'möse', 'pimmel', 'schwanz', 'leck mich', 'verpiss dich'];
const BLACKLIST_USERS = BLACKLIST_WEBHOOK.filter(w => w !== 'shit' && w !== 'ass');

let executionCount = 0;
let downloadCount = 0;
let lastUpdate = 0;

const executionsFile = path.join(__dirname, 'Executions.txt');
const setupFile = path.join(__dirname, 'Setup.json');

const webhookTracker = new Map();
const webhookCooldown = new Map();
const activeTickets = new Map();
let setupConfig = {};

const DOWNLOAD_CHANNEL_ID = '1455226125700694027';
const STAFF_ROLE_ID = '1454608694850486313';

const parseExecutions = (name) => { const m = String(name || '').match(/Executions:\s*(\d+)/i); return m ? Number(m[1]) : null; };
const readFile = () => { try { if (!fs.existsSync(executionsFile)) return null; const n = Number(fs.readFileSync(executionsFile, 'utf8').trim()); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null; } catch {} return null; };
const writeFile = (n) => { try { fs.writeFileSync(executionsFile, String(n)); return true; } catch { return false; } };
const readSetup = () => { try { if (!fs.existsSync(setupFile)) return {}; return JSON.parse(fs.readFileSync(setupFile, 'utf8')); } catch {} return {}; };
const writeSetup = (data) => { try { fs.writeFileSync(setupFile, JSON.stringify(data, null, 2)); return true; } catch { return false; } };
const fetchVC = async (id) => { const c = await client.channels.fetch(id); return c?.isVoiceBased() ? c : null; };
const renameChannel = async (c, n) => { const p = c.permissionsFor(client.user); if (!p?.has(PermissionFlagsBits.ManageChannels)) return false; await c.setName(n); return true; };
const hasBlacklist = (t, bl) => { if (!t) return false; const l = t.toLowerCase(); return bl.some(w => l.includes(w)); };
const checkMsg = (m, bl) => { if (hasBlacklist(m.content, bl)) return true; if (m.embeds?.length) for (const e of m.embeds) { if (hasBlacklist(e.title, bl) || hasBlacklist(e.description, bl) || hasBlacklist(e.footer?.text, bl) || hasBlacklist(e.author?.name, bl)) return true; if (e.fields?.length) for (const f of e.fields) if (hasBlacklist(f.name, bl) || hasBlacklist(f.value, bl)) return true; } return false; };
const parseDuration = (s) => { const m = s.match(/^(\d+)([smhd])$/); if (!m) return null; const v = parseInt(m[1]), u = m[2]; const t = { s: 1000, m: 60000, h: 3600000, d: 86400000 }; return v * t[u]; };

const updateMembers = async () => {
  try {
    const c = await fetchVC(config.memberChannelId);
    if (!c) return;
    await c.guild.members.fetch();
    const count = c.guild.members.cache.filter(m => !m.user.bot).size;
    await renameChannel(c, `Member: ${count}`);
    console.log(`Updated member count to ${count}`);
  } catch (e) { console.log(`Member update failed: ${e.message}`); }
};

const restoreWebhook = async (wId, cId) => {
  try {
    const c = await client.channels.fetch(cId);
    if (!c) return;
    const whs = await c.fetchWebhooks();
    const wh = whs.get(wId);
    if (wh && wh.name !== 'Zenk') await wh.edit({ name: 'Zenk' });
  } catch (e) { console.log(`Restore webhook failed: ${e.message}`); }
};

const bulkDelete = async (c, ids) => {
  try {
    const v = ids.filter(id => id);
    if (!v.length) return;
    if (v.length === 1) { const m = await c.messages.fetch(v[0]).catch(() => null); if (m) await m.delete(); }
    else await c.bulkDelete(v, true);
  } catch (e) { console.log(`Bulk delete failed: ${e.message}`); }
};

client.once('ready', async () => {
  console.log('Bot is ready');
  setupConfig = readSetup();
  
  try {
    const c = await fetchVC(config.channelId);
    if (!c) return;
    const fromFile = readFile();
    if (fromFile !== null) {
      executionCount = fromFile;
      await renameChannel(c, `Executions: ${executionCount}`);
      lastUpdate = Date.now();
    } else {
      const fromChannel = parseExecutions(c.name);
      executionCount = fromChannel ?? 0;
      writeFile(executionCount);
    }
    await updateMembers();
    setInterval(updateMembers, 600000);
  } catch (e) { console.log(`Ready error: ${e.message}`); }

  const commands = [
    new SlashCommandBuilder().setName('mute').setDescription('Timeout a user').addUserOption(o => o.setName('user').setDescription('User to timeout').setRequired(true)).addStringOption(o => o.setName('duration').setDescription('Duration (e.g., 10s, 5m, 1h, 2d)').setRequired(true)),
    new SlashCommandBuilder().setName('unmute').setDescription('Remove timeout from a user').addUserOption(o => o.setName('user').setDescription('User to unmute').setRequired(true)),
    new SlashCommandBuilder().setName('setup').setDescription('Setup bot features').addStringOption(o => o.setName('feature').setDescription('Feature to setup').setRequired(true).addChoices({ name: 'Welcome', value: 'welcome' }, { name: 'Tickets', value: 'tickets' })).addChannelOption(o => o.setName('channel').setDescription('Channel for the feature').setRequired(true).addChannelTypes(ChannelType.GuildText)),
    new SlashCommandBuilder().setName('resetup').setDescription('Remove bot setup').addStringOption(o => o.setName('feature').setDescription('Feature to remove').setRequired(true).addChoices({ name: 'Welcome', value: 'welcome' }, { name: 'Tickets', value: 'tickets' }))
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Slash commands registered');
  } catch (e) { console.log(`Command registration failed: ${e.message}`); }
});

client.on('guildMemberAdd', async (member) => {
  await updateMembers();
  if (setupConfig.welcome) {
    try {
      const channel = await client.channels.fetch(setupConfig.welcome);
      if (channel) await channel.send(`Welcome to **Zenk Studios**, ${member}`);
    } catch (e) { console.log(`Welcome message failed: ${e.message}`); }
  }
});

client.on('guildMemberRemove', updateMembers);

client.on('messageCreate', async (m) => {
  if (m.author.bot && !m.webhookId) return;
  try {
    if (m.webhookId) {
      const wId = m.webhookId, now = Date.now();
      if (webhookCooldown.has(wId)) {
        if (now < webhookCooldown.get(wId)) { await m.delete(); return; }
        else { webhookCooldown.delete(wId); webhookTracker.delete(wId); }
      }
      if (m.author.username !== 'Zenk') { await m.delete(); await restoreWebhook(wId, m.channelId); return; }
      if (checkMsg(m, BLACKLIST_WEBHOOK)) { await m.delete(); return; }
      if (!webhookTracker.has(wId)) webhookTracker.set(wId, []);
      const msgs = webhookTracker.get(wId);
      msgs.push({ timestamp: now, messageId: m.id });
      const recent = msgs.filter(msg => now - msg.timestamp < 8000);
      webhookTracker.set(wId, recent);
      if (recent.length >= 10) {
        await bulkDelete(m.channel, recent.map(msg => msg.messageId));
        webhookCooldown.set(wId, now + 30000);
        webhookTracker.set(wId, []);
      }
    } else {
      if (checkMsg(m, BLACKLIST_USERS)) {
        await m.delete();
        if (m.member?.moderatable) try { await m.member.timeout(600000, 'Blacklisted word'); } catch (e) { console.log(`Timeout failed: ${e.message}`); }
      }
    }
  } catch (e) { console.log(`Message check failed: ${e.message}`); }
});

client.on('webhookUpdate', async (c) => {
  try {
    const whs = await c.fetchWebhooks();
    whs.forEach(async (wh) => { if (wh.name !== 'Zenk') await wh.edit({ name: 'Zenk' }); });
  } catch (e) { console.log(`Webhook update failed: ${e.message}`); }
});

client.on('interactionCreate', async (i) => {
  try {
    if (i.isChatInputCommand()) {
      if (i.commandName === 'mute') {
        if (!i.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return i.reply({ content: 'No permissions', ephemeral: true });
        const user = i.options.getUser('user');
        const duration = i.options.getString('duration');
        const ms = parseDuration(duration);
        if (!ms || ms > 2419200000) return i.reply({ content: 'Invalid duration (max 28d)', ephemeral: true });
        const member = await i.guild.members.fetch(user.id);
        if (!member.moderatable) return i.reply({ content: 'Cannot timeout this user', ephemeral: true });
        await member.timeout(ms, `Timed out by ${i.user.tag}`);
        await i.reply({ content: `Timed out ${user.tag} for ${duration}`, ephemeral: true });
      } else if (i.commandName === 'unmute') {
        if (!i.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return i.reply({ content: 'No permissions', ephemeral: true });
        const user = i.options.getUser('user');
        const member = await i.guild.members.fetch(user.id);
        if (!member.moderatable) return i.reply({ content: 'Cannot unmute this user', ephemeral: true });
        await member.timeout(null, `Unmuted by ${i.user.tag}`);
        await i.reply({ content: `Unmuted ${user.tag}`, ephemeral: true });
      } else if (i.commandName === 'setup') {
        if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) return i.reply({ content: 'No permissions', ephemeral: true });
        const feature = i.options.getString('feature');
        const channel = i.options.getChannel('channel');
        
        if (feature === 'tickets') {
          let ticketCategory = i.guild.channels.cache.find(c => c.name === '</> Tickets </>' && c.type === ChannelType.GuildCategory);
          
          if (!ticketCategory) {
            ticketCategory = await i.guild.channels.create({
              name: '</> Tickets </>',
              type: ChannelType.GuildCategory,
              permissionOverwrites: [
                {
                  id: i.guild.id,
                  deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                  id: STAFF_ROLE_ID,
                  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels]
                }
              ]
            });
          }

          let ticketLogsChannel = i.guild.channels.cache.find(c => c.name === 'ticket-logs' && c.type === ChannelType.GuildText);
          if (!ticketLogsChannel) {
            ticketLogsChannel = await i.guild.channels.create({
              name: 'ticket-logs',
              type: ChannelType.GuildText,
              permissionOverwrites: [
                {
                  id: i.guild.id,
                  deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                  id: STAFF_ROLE_ID,
                  allow: [PermissionFlagsBits.ViewChannel]
                }
              ]
            });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('ticket-select')
            .setPlaceholder('Wähle eine Ticket-Art aus')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
              new StringSelectMenuOptionBuilder()
                .setLabel('Support')
                .setValue('support')
                .setDescription('Für Bug Reports oder Hilfe bei Fragen')
            );

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await channel.send({
            content: '**🎫 Ticket System**\n\nBei Problemen oder Fragen kannst du hier ein Ticket öffnen. Wähle einfach die passende Kategorie aus dem Dropdown-Menü unten aus, und ein privater Support-Channel wird für dich erstellt.',
            components: [row]
          });

          setupConfig[feature] = channel.id;
          setupConfig.ticketCategory = ticketCategory.id;
          setupConfig.ticketLogs = ticketLogsChannel.id;
          writeSetup(setupConfig);

          await i.reply({ content: `Setup complete: ${feature} → ${channel}\nKategorie und Logs wurden erstellt!`, ephemeral: true });
        } else {
          setupConfig[feature] = channel.id;
          writeSetup(setupConfig);
          await i.reply({ content: `Setup complete: ${feature} → ${channel}`, ephemeral: true });
        }
      } else if (i.commandName === 'resetup') {
        if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) return i.reply({ content: 'No permissions', ephemeral: true });
        const feature = i.options.getString('feature');
        if (setupConfig[feature]) {
          delete setupConfig[feature];
          if (feature === 'tickets') {
            delete setupConfig.ticketCategory;
            delete setupConfig.ticketLogs;
          }
          writeSetup(setupConfig);
          await i.reply({ content: `Removed setup: ${feature}`, ephemeral: true });
        } else {
          await i.reply({ content: `No setup found for: ${feature}`, ephemeral: true });
        }
      }
    } else if (i.isStringSelectMenu()) {
      if (i.customId === 'ticket-select') {
        if (activeTickets.has(i.user.id)) {
          const existingTicketId = activeTickets.get(i.user.id);
          return i.reply({ content: `Du hast bereits ein aktives Ticket: <#${existingTicketId}>`, ephemeral: true });
        }

        await i.reply({ content: '⏳ Dein Ticket wird erstellt...', ephemeral: true });

        const ticketType = i.values[0];
        const ticketNumber = activeTickets.size + 1;
        const ticketName = `ticket-${ticketNumber}`;

        try {
          const ticketChannel = await i.guild.channels.create({
            name: ticketName,
            type: ChannelType.GuildText,
            parent: setupConfig.ticketCategory,
            permissionOverwrites: [
              {
                id: i.guild.id,
                deny: [PermissionFlagsBits.ViewChannel]
              },
              {
                id: i.user.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
              },
              {
                id: STAFF_ROLE_ID,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
              }
            ]
          });

          activeTickets.set(i.user.id, ticketChannel.id);

          const closeButton = new ButtonBuilder()
            .setCustomId('close-ticket')
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger);

          const buttonRow = new ActionRowBuilder().addComponents(closeButton);

          await ticketChannel.send({
            content: `${i.user}, willkommen in deinem Ticket!\n\nBitte beschreibe dein Problem ausführlich, damit wir dir am besten und schnellsten helfen können.`,
            components: [buttonRow]
          });

          await i.editReply({ content: `✅ Dein Ticket wurde erstellt: ${ticketChannel}`, ephemeral: true });
        } catch (e) {
          console.log(`Ticket creation failed: ${e.message}`);
          await i.editReply({ content: '❌ Fehler beim Erstellen des Tickets.', ephemeral: true });
        }
      }
    } else if (i.isButton()) {
      if (i.customId === 'close-ticket') {
        const modal = new ModalBuilder()
          .setCustomId('close-ticket-modal')
          .setTitle('Ticket schließen');

        const reasonInput = new TextInputBuilder()
          .setCustomId('close-reason')
          .setLabel('Grund für das Schließen')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Bitte gib den Grund an...')
          .setRequired(true);

        const actionRow = new ActionRowBuilder().addComponents(reasonInput);
        modal.addComponents(actionRow);

        await i.showModal(modal);
      }
    } else if (i.isModalSubmit()) {
      if (i.customId === 'close-ticket-modal') {
        const reason = i.fields.getTextInputValue('close-reason');
        const channel = i.channel;

        const ticketUser = Array.from(activeTickets.entries()).find(([userId, channelId]) => channelId === channel.id);
        
        if (!ticketUser) {
          return i.reply({ content: 'Ticket-Benutzer nicht gefunden.', ephemeral: true });
        }

        const [userId] = ticketUser;
        activeTickets.delete(userId);

        await i.reply({ content: `✅ Ticket wird geschlossen...`, ephemeral: true });

        const user = await client.users.fetch(userId);
        try {
          await user.send(`Dein Ticket **${channel.name}** wurde geschlossen.\n\n**Grund:** ${reason}`);
        } catch (e) {
          console.log(`Could not DM user: ${e.message}`);
        }

        if (setupConfig.ticketLogs) {
          const logsChannel = await client.channels.fetch(setupConfig.ticketLogs);
          const logEmbed = new EmbedBuilder()
            .setTitle(`📋 Ticket geschlossen: ${channel.name}`)
            .addFields(
              { name: 'Ticket-Nutzer', value: `<@${userId}>`, inline: true },
              { name: 'Geschlossen von', value: `<@${i.user.id}>`, inline: true },
              { name: 'Grund', value: reason }
            )
            .setColor('#ff0000')
            .setTimestamp();

          await logsChannel.send({ embeds: [logEmbed] });
        }

        setTimeout(async () => {
          try {
            await channel.delete();
          } catch (e) {
            console.log(`Could not delete channel: ${e.message}`);
          }
        }, 3000);
      }
    }
  } catch (e) { console.log(`Interaction failed: ${e.message}`); }
});

app.post('/track', async (req, res) => {
  downloadCount++;
  console.log(`Download #${downloadCount} received`);
  try {
    const channel = await client.channels.fetch(DOWNLOAD_CHANNEL_ID);
    await channel.setName(`Downloads: ${downloadCount}`);
    console.log(`Channel renamed to: Downloads: ${downloadCount}`);
    res.sendStatus(200);
  } catch (error) {
    console.error('Channel rename failed:', error);
    res.sendStatus(500);
  }
});

app.post('/execution', async (req, res) => {
  try {
    executionCount++; 
    writeFile(executionCount);
    const now = Date.now();
    if (now - lastUpdate >= 480000) {
      const c = await fetchVC(config.channelId);
      if (c) { await renameChannel(c, `Executions: ${executionCount}`); lastUpdate = now; }
    }
    res.json({ success: true, count: executionCount, lastUpdate: lastUpdate > 0 ? new Date(lastUpdate).toISOString() : 'never' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/export', async (req, res) => {
  try {
    const c = await fetchVC(config.channelId);
    if (!c) return res.status(404).type('text/plain').send('0');
    const n = parseExecutions(c.name);
    if (n === null) return res.type('text/plain').send('0');
    writeFile(n); 
    res.type('text/plain').send(String(n));
  } catch { res.status(500).type('text/plain').send(String(executionCount)); }
});

app.post('/import', async (req, res) => {
  const n = Number(req.body?.count);
  if (!Number.isFinite(n) || n < 0) return res.status(400).json({ success: false });
  executionCount = Math.floor(n); 
  writeFile(executionCount);
  try {
    const c = await fetchVC(config.channelId);
    if (c) { await renameChannel(c, `Executions: ${executionCount}`); lastUpdate = Date.now(); }
  } catch {}
  res.json({ success: true, count: executionCount });
});

app.get('/', (req, res) => {
  res.json({ status: 'online', executions: executionCount, downloads: downloadCount, botReady: client.isReady() });
});

const port = config.port || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

client.login(config.token);
