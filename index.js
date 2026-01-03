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
const LOG_CHANNEL_ID = '1456977089864400970';

const sendLog = async (embed) => {
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (logChannel) await logChannel.send({ embeds: [embed] });
  } catch (e) { console.log(`Log send failed: ${e.message}`); }
};

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
      if (m.author.username !== 'Zenk') {
        await m.delete();
        await restoreWebhook(wId, m.channelId);
        
        const logEmbed = new EmbedBuilder()
          .setTitle('⚠️ Webhook Name Violation')
          .setDescription('A webhook with an incorrect name attempted to send a message')
          .addFields(
            { name: 'Webhook Name', value: m.author.username, inline: true },
            { name: 'Webhook ID', value: wId, inline: true },
            { name: 'Channel', value: `${m.channel} (${m.channel.name})`, inline: false },
            { name: 'Action Taken', value: 'Message deleted & webhook name restored to "Zenk"', inline: false }
          )
          .setColor('#ff0000')
          .setTimestamp();
        
        await sendLog(logEmbed);
        return;
      }
      if (checkMsg(m, BLACKLIST_WEBHOOK)) {
        await m.delete();
        
        const logEmbed = new EmbedBuilder()
          .setTitle('🚫 Webhook Blacklist Detection')
          .setDescription('A webhook message contained blacklisted words')
          .addFields(
            { name: 'Webhook Name', value: m.author.username, inline: true },
            { name: 'Webhook ID', value: wId, inline: true },
            { name: 'Channel', value: `${m.channel} (${m.channel.name})`, inline: false },
            { name: 'Message Content', value: m.content.length > 0 ? m.content.substring(0, 1024) : 'No content', inline: false },
            { name: 'Action Taken', value: 'Message deleted', inline: false }
          )
          .setColor('#ff0000')
          .setTimestamp();
        
        await sendLog(logEmbed);
        return;
      }
      if (!webhookTracker.has(wId)) webhookTracker.set(wId, []);
      const msgs = webhookTracker.get(wId);
      msgs.push({ timestamp: now, messageId: m.id });
      const recent = msgs.filter(msg => now - msg.timestamp < 8000);
      webhookTracker.set(wId, recent);
      if (recent.length >= 10) {
        await bulkDelete(m.channel, recent.map(msg => msg.messageId));
        webhookCooldown.set(wId, now + 30000);
        webhookTracker.set(wId, []);
        
        const logEmbed = new EmbedBuilder()
          .setTitle('⚡ Webhook Rate Limit Triggered')
          .setDescription('A webhook exceeded the rate limit (10 messages in 8 seconds)')
          .addFields(
            { name: 'Webhook Name', value: m.author.username, inline: true },
            { name: 'Webhook ID', value: wId, inline: true },
            { name: 'Channel', value: `${m.channel} (${m.channel.name})`, inline: false },
            { name: 'Messages Deleted', value: `${recent.length} messages`, inline: true },
            { name: 'Cooldown', value: '30 seconds', inline: true }
          )
          .setColor('#ffa500')
          .setTimestamp();
        
        await sendLog(logEmbed);
      }
    } else {
      if (checkMsg(m, BLACKLIST_USERS)) {
        await m.delete();
        if (m.member?.moderatable) {
          try {
            await m.member.timeout(600000, 'Blacklisted word');
            
            const logEmbed = new EmbedBuilder()
              .setTitle('🚫 User Blacklist Detection')
              .setDescription('A user message contained blacklisted words')
              .addFields(
                { name: 'User', value: `${m.author.tag} (${m.author.id})`, inline: false },
                { name: 'Channel', value: `${m.channel} (${m.channel.name})`, inline: false },
                { name: 'Message Content', value: m.content.length > 0 ? m.content.substring(0, 1024) : 'No content', inline: false },
                { name: 'Action Taken', value: 'Message deleted & user timed out for 10 minutes', inline: false }
              )
              .setColor('#ff0000')
              .setTimestamp();
            
            await sendLog(logEmbed);
          } catch (e) {
            console.log(`Timeout failed: ${e.message}`);
          }
        }
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
        
        const logEmbed = new EmbedBuilder()
          .setTitle('⏱️ User Timed Out')
          .addFields(
            { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
            { name: 'Duration', value: duration, inline: true },
            { name: 'Moderator', value: `${i.user.tag} (${i.user.id})`, inline: false },
            { name: 'Channel', value: `${i.channel} (${i.channel.name})`, inline: false }
          )
          .setColor('#ffa500')
          .setTimestamp();
        
        await sendLog(logEmbed);
      } else if (i.commandName === 'unmute') {
        if (!i.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return i.reply({ content: 'No permissions', ephemeral: true });
        const user = i.options.getUser('user');
        const member = await i.guild.members.fetch(user.id);
        if (!member.moderatable) return i.reply({ content: 'Cannot unmute this user', ephemeral: true });
        await member.timeout(null, `Unmuted by ${i.user.tag}`);
        await i.reply({ content: `Unmuted ${user.tag}`, ephemeral: true });
        
        const logEmbed = new EmbedBuilder()
          .setTitle('✅ User Timeout Removed')
          .addFields(
            { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
            { name: 'Moderator', value: `${i.user.tag} (${i.user.id})`, inline: true },
            { name: 'Channel', value: `${i.channel} (${i.channel.name})`, inline: false }
          )
          .setColor('#00ff00')
          .setTimestamp();
        
        await sendLog(logEmbed);
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
              parent: channel.parent,
              permissionOverwrites: [
                {
                  id: i.guild.id,
                  deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                  id: STAFF_ROLE_ID,
                  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                }
              ]
            });
          }

          const ticketEmbed = new EmbedBuilder()
            .setTitle('🎫 Ticket System')
            .setDescription('If you have any problems or questions, you can open a ticket here. Simply select the appropriate category from the dropdown menu below, and a private support channel will be created for you.')
            .setColor('#5865F2')
            .setTimestamp();

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('ticket-select')
            .setPlaceholder('Select a ticket type')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
              new StringSelectMenuOptionBuilder()
                .setLabel('None')
                .setValue('none')
                .setDescription('Deselect'),
              new StringSelectMenuOptionBuilder()
                .setLabel('Support')
                .setValue('support')
                .setDescription('For bug reports or help with questions')
            );

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await channel.send({
            embeds: [ticketEmbed],
            components: [row]
          });

          setupConfig[feature] = channel.id;
          setupConfig.ticketCategory = ticketCategory.id;
          setupConfig.ticketLogs = ticketLogsChannel.id;
          writeSetup(setupConfig);

          await i.reply({ content: `Setup complete: ${feature} → ${channel}\nCategory and logs channel created!`, ephemeral: true });
          
          const logEmbed = new EmbedBuilder()
            .setTitle('⚙️ Ticket System Setup')
            .addFields(
              { name: 'Feature', value: feature, inline: true },
              { name: 'Channel', value: `${channel} (${channel.name})`, inline: true },
              { name: 'Administrator', value: `${i.user.tag} (${i.user.id})`, inline: false }
            )
            .setColor('#5865F2')
            .setTimestamp();
          
          await sendLog(logEmbed);
        } else {
          setupConfig[feature] = channel.id;
          writeSetup(setupConfig);
          await i.reply({ content: `Setup complete: ${feature} → ${channel}`, ephemeral: true });
          
          const logEmbed = new EmbedBuilder()
            .setTitle('⚙️ Feature Setup')
            .addFields(
              { name: 'Feature', value: feature, inline: true },
              { name: 'Channel', value: `${channel} (${channel.name})`, inline: true },
              { name: 'Administrator', value: `${i.user.tag} (${i.user.id})`, inline: false }
            )
            .setColor('#5865F2')
            .setTimestamp();
          
          await sendLog(logEmbed);
        }
      } else if (i.commandName === 'resetup') {
        if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) return i.reply({ content: 'No permissions', ephemeral: true });
        const feature = i.options.getString('feature');
        
        if (feature === 'tickets' && setupConfig[feature]) {
          try {
            if (setupConfig.ticketCategory) {
              const category = await i.guild.channels.fetch(setupConfig.ticketCategory).catch(() => null);
              if (category) {
                const channelsInCategory = i.guild.channels.cache.filter(c => c.parentId === category.id);
                for (const [id, channel] of channelsInCategory) {
                  await channel.delete().catch(e => console.log(`Could not delete channel: ${e.message}`));
                }
                await category.delete().catch(e => console.log(`Could not delete category: ${e.message}`));
              }
            }

            if (setupConfig.ticketLogs) {
              const logsChannel = await i.guild.channels.fetch(setupConfig.ticketLogs).catch(() => null);
              if (logsChannel) await logsChannel.delete().catch(e => console.log(`Could not delete logs channel: ${e.message}`));
            }

            activeTickets.clear();

            delete setupConfig[feature];
            delete setupConfig.ticketCategory;
            delete setupConfig.ticketLogs;
            writeSetup(setupConfig);

            await i.reply({ content: `Removed setup: ${feature}\nAll ticket channels, category, and logs have been deleted.`, ephemeral: true });
            
            const logEmbed = new EmbedBuilder()
              .setTitle('🗑️ Ticket System Removed')
              .addFields(
                { name: 'Feature', value: feature, inline: true },
                { name: 'Administrator', value: `${i.user.tag} (${i.user.id})`, inline: true },
                { name: 'Action', value: 'All ticket channels, category, and logs deleted', inline: false }
              )
              .setColor('#ff0000')
              .setTimestamp();
            
            await sendLog(logEmbed);
          } catch (e) {
            console.log(`Resetup failed: ${e.message}`);
            await i.reply({ content: 'Failed to remove ticket setup completely.', ephemeral: true });
          }
        } else if (setupConfig[feature]) {
          delete setupConfig[feature];
          writeSetup(setupConfig);
          await i.reply({ content: `Removed setup: ${feature}`, ephemeral: true });
          
          const logEmbed = new EmbedBuilder()
            .setTitle('🗑️ Feature Setup Removed')
            .addFields(
              { name: 'Feature', value: feature, inline: true },
              { name: 'Administrator', value: `${i.user.tag} (${i.user.id})`, inline: true }
            )
            .setColor('#ff0000')
            .setTimestamp();
          
          await sendLog(logEmbed);
        } else {
          await i.reply({ content: `No setup found for: ${feature}`, ephemeral: true });
        }
      }
    } else if (i.isStringSelectMenu()) {
      if (i.customId === 'ticket-select') {
        const selectedValue = i.values[0];

        if (selectedValue === 'none') {
          return i.reply({ content: 'Selection cleared.', ephemeral: true });
        }

        if (activeTickets.has(i.user.id)) {
          const existingTicketId = activeTickets.get(i.user.id);
          return i.reply({ content: `You already have an active ticket: <#${existingTicketId}>`, ephemeral: true });
        }

        const modal = new ModalBuilder()
          .setCustomId('ticket-create-modal')
          .setTitle('Create Support Ticket');

        const executorInput = new TextInputBuilder()
          .setCustomId('executor-input')
          .setLabel('Executor')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Bunni, Delta...')
          .setRequired(true);

        const problemInput = new TextInputBuilder()
          .setCustomId('problem-input')
          .setLabel('What is your problem?')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Please describe your issue in detail...')
          .setRequired(true);

        const row1 = new ActionRowBuilder().addComponents(executorInput);
        const row2 = new ActionRowBuilder().addComponents(problemInput);

        modal.addComponents(row1, row2);

        await i.showModal(modal);
      }
    } else if (i.isButton()) {
      if (i.customId === 'close-ticket') {
        const modal = new ModalBuilder()
          .setCustomId('close-ticket-modal')
          .setTitle('Close Ticket');

        const reasonInput = new TextInputBuilder()
          .setCustomId('close-reason')
          .setLabel('Reason for closing')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Please provide a reason...')
          .setRequired(true);

        const actionRow = new ActionRowBuilder().addComponents(reasonInput);
        modal.addComponents(actionRow);

        await i.showModal(modal);
      }
    } else if (i.isModalSubmit()) {
      if (i.customId === 'ticket-create-modal') {
        const executor = i.fields.getTextInputValue('executor-input');
        const problem = i.fields.getTextInputValue('problem-input');

        await i.reply({ content: '⏳ Your ticket is being created...', ephemeral: true });

        const username = i.user.username.replace(/[^a-zA-Z0-9]/g, '');
        const ticketName = `support-${username}`;

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

          const ticketEmbed = new EmbedBuilder()
            .setTitle('🎫 Support Ticket')
            .addFields(
              { name: 'User', value: `${i.user}`, inline: true },
              { name: 'Executor', value: executor, inline: true },
              { name: 'Problem', value: problem }
            )
            .setColor('#5865F2')
            .setTimestamp();

          const closeButton = new ButtonBuilder()
            .setCustomId('close-ticket')
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger);

          const buttonRow = new ActionRowBuilder().addComponents(closeButton);

          const ticketMessage = await ticketChannel.send({
            content: `${i.user}`,
            embeds: [ticketEmbed],
            components: [buttonRow]
          });

          await ticketMessage.pin();

          await i.editReply({ content: `✅ Your ticket has been created: ${ticketChannel}`, ephemeral: true });
          
          const logEmbed = new EmbedBuilder()
            .setTitle('🎫 Ticket Created')
            .addFields(
              { name: 'User', value: `${i.user.tag} (${i.user.id})`, inline: false },
              { name: 'Ticket Channel', value: `${ticketChannel} (${ticketChannel.name})`, inline: false },
              { name: 'Executor', value: executor, inline: true },
              { name: 'Problem', value: problem.substring(0, 1024), inline: false }
            )
            .setColor('#5865F2')
            .setTimestamp();
          
          await sendLog(logEmbed);
        } catch (e) {
          console.log(`Ticket creation failed: ${e.message}`);
          await i.editReply({ content: '❌ Failed to create ticket.', ephemeral: true });
        }
      } else if (i.customId === 'close-ticket-modal') {
        const reason = i.fields.getTextInputValue('close-reason');
        const channel = i.channel;

        const ticketUser = Array.from(activeTickets.entries()).find(([userId, channelId]) => channelId === channel.id);
        
        if (!ticketUser) {
          return i.reply({ content: 'Ticket user not found.', ephemeral: true });
        }

        const [userId] = ticketUser;
        activeTickets.delete(userId);

        await i.reply({ content: `✅ Ticket is being closed...`, ephemeral: true });

        const user = await client.users.fetch(userId);
        try {
          const closeDMEmbed = new EmbedBuilder()
            .setTitle('🎫 Ticket Closed')
            .setDescription(`Your ticket **${channel.name}** has been closed.`)
            .addFields({ name: 'Reason', value: reason })
            .setColor('#ff0000')
            .setTimestamp();

          await user.send({ embeds: [closeDMEmbed] });
        } catch (e) {
          console.log(`Could not DM user: ${e.message}`);
        }

        if (setupConfig.ticketLogs) {
          const logsChannel = await client.channels.fetch(setupConfig.ticketLogs);
          const logEmbed = new EmbedBuilder()
            .setTitle(`📋 Ticket Closed: ${channel.name}`)
            .addFields(
              { name: 'Ticket User', value: `<@${userId}>`, inline: true },
              { name: 'Closed By', value: `<@${i.user.id}>`, inline: true },
              { name: 'Reason', value: reason }
            )
            .setColor('#ff0000')
            .setTimestamp();

          await logsChannel.send({ embeds: [logEmbed] });
        }

        const mainLogEmbed = new EmbedBuilder()
          .setTitle('🎫 Ticket Closed')
          .addFields(
            { name: 'Ticket Channel', value: channel.name, inline: true },
            { name: 'User', value: `${user.tag} (${userId})`, inline: true },
            { name: 'Closed By', value: `${i.user.tag} (${i.user.id})`, inline: false },
            { name: 'Reason', value: reason, inline: false }
          )
          .setColor('#ff0000')
          .setTimestamp();
        
        await sendLog(mainLogEmbed);

        setTimeout(async () => {
          try {
            await channel.delete();
          } catch (e) {
            console.log(`Could not delete channel: ${e.message}`);
          }
        }, 5000);
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
