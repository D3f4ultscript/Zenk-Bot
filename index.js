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

const BLACKLIST_WEBHOOK = ['bitch', 'asshole', 'bastard', 'cunt', 'cock', 'pussy', 'whore', 'slut', 'fag', 'faggot', 'nigger', 'nigga', 'retard', 'retarded', 'rape', 'nazi', 'hitler', 'kill yourself', 'motherfucker', 'bullshit', 'prick', 'twat', 'wanker', 'bollocks', 'scheiße', 'scheisse', 'scheiß', 'scheiss', 'ficken', 'fick', 'arschloch', 'fotze', 'hure', 'nutte', 'wichser', 'hurensohn', 'schwuchtel', 'schwul', 'drecksau', 'sau', 'schwein', 'drecksschwein', 'miststück', 'kacke', 'möse', 'pimmel', 'schwanz', 'leck mich', 'verpiss dich'];
const BLACKLIST_USERS = BLACKLIST_WEBHOOK.filter(w => w !== 'ass');

const executionsFile = path.join(__dirname, 'Executions.txt');
const setupFile = path.join(__dirname, 'Setup.json');

const webhookTracker = new Map();
const webhookCooldown = new Map();
const activeTickets = new Map();
const messageHistory = new Map();

let setupConfig = {};
let executionCount = 0;
let memberCount = 0;

const STAFF_ROLE_ID = '1454608694850486313';
const LOG_CHANNEL_ID = '1456977089864400970';
const RATING_CHANNEL_ID = '1454624341248708649';
const TRADE_EXCLUDED_CHANNEL = '1455105607332925553';

const readExecutions = () => {
  try {
    if (!fs.existsSync(executionsFile)) return 0;
    const n = Number(fs.readFileSync(executionsFile, 'utf8').trim());
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch { return 0; }
};

const writeExecutions = (n) => {
  try { fs.writeFileSync(executionsFile, String(n)); } catch {}
};

const readSetup = () => {
  try {
    if (!fs.existsSync(setupFile)) return {};
    return JSON.parse(fs.readFileSync(setupFile, 'utf8'));
  } catch { return {}; }
};

const writeSetup = (data) => {
  try { fs.writeFileSync(setupFile, JSON.stringify(data, null, 2)); } catch {}
};

const hasBlacklist = (t, bl) => {
  if (!t) return false;
  const l = t.toLowerCase();
  return bl.some(w => l.includes(w));
};

const checkMsg = (m, bl) => {
  if (hasBlacklist(m.content, bl)) return true;
  if (m.embeds?.length) {
    for (const e of m.embeds) {
      if (hasBlacklist(e.title, bl) || hasBlacklist(e.description, bl) || hasBlacklist(e.footer?.text, bl) || hasBlacklist(e.author?.name, bl)) return true;
      if (e.fields?.length) for (const f of e.fields) if (hasBlacklist(f.name, bl) || hasBlacklist(f.value, bl)) return true;
    }
  }
  return false;
};

const parseDuration = (s) => {
  const m = s.match(/^(\d+)([smhd])$/);
  if (!m) return null;
  const v = parseInt(m[1]), u = m[2];
  const t = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return v * t[u];
};

const renameChannel = async (c, name) => {
  try {
    const p = c.permissionsFor(client.user);
    if (p?.has(PermissionFlagsBits.ManageChannels)) await c.setName(name);
  } catch {}
};

const sendLog = async (embed) => {
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (logChannel) await logChannel.send({ embeds: [embed] });
  } catch {}
};

const updateCountsChannels = async () => {
  try {
    const execChannel = await client.channels.fetch(config.channelId);
    if (execChannel) await renameChannel(execChannel, `Executions: ${executionCount}`);

    const memberChannel = await client.channels.fetch(config.memberChannelId);
    if (memberChannel) {
      await memberChannel.guild.members.fetch();
      memberCount = memberChannel.guild.members.cache.filter(m => !m.user.bot).size;
      await renameChannel(memberChannel, `Member: ${memberCount}`);
    }

    console.log(`Updated counts → Executions: ${executionCount}, Members: ${memberCount}`);
  } catch (e) {
    console.log(`Count update failed: ${e.message}`);
  }
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
    if (v.length === 1) {
      const m = await c.messages.fetch(v[0]).catch(() => null);
      if (m) await m.delete();
    } else await c.bulkDelete(v, true);
  } catch (e) { console.log(`Bulk delete failed: ${e.message}`); }
};

client.once('ready', async () => {
  console.log('Bot is ready');
  setupConfig = readSetup();
  executionCount = readExecutions();

  await updateCountsChannels();
  setInterval(updateCountsChannels, 600000);

  const commands = [
    new SlashCommandBuilder().setName('mute').setDescription('Timeout a user').addUserOption(o => o.setName('user').setDescription('User to timeout').setRequired(true)).addStringOption(o => o.setName('duration').setDescription('Duration (e.g., 10s, 5m, 1h, 2d)').setRequired(true)),
    new SlashCommandBuilder().setName('unmute').setDescription('Remove timeout from a user').addUserOption(o => o.setName('user').setDescription('User to unmute').setRequired(true)),
    new SlashCommandBuilder().setName('setup').setDescription('Setup bot features').addStringOption(o => o.setName('feature').setDescription('Feature to setup').setRequired(true).addChoices({ name: 'Tickets', value: 'tickets' })).addChannelOption(o => o.setName('channel').setDescription('Channel for the feature').setRequired(true).addChannelTypes(ChannelType.GuildText)),
    new SlashCommandBuilder().setName('resetup').setDescription('Remove bot setup').addStringOption(o => o.setName('feature').setDescription('Feature to remove').setRequired(true).addChoices({ name: 'Tickets', value: 'tickets' })),
    new SlashCommandBuilder().setName('clear').setDescription('Clear messages in this channel').addIntegerOption(o => o.setName('amount').setDescription('Number of messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)).addUserOption(o => o.setName('user').setDescription('Only delete messages from this user').setRequired(false))
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Slash commands registered');
  } catch (e) { console.log(`Command registration failed: ${e.message}`); }
});

client.on('messageCreate', async (m) => {
  if (m.author.bot && !m.webhookId) return;

  try {
    const key = `${m.channel.id}-${m.author.id}`;
    const content = m.content || '';
    const embedsJson = JSON.stringify(m.embeds?.map(e => e.toJSON()) || []);
    const now = Date.now();

    if (!messageHistory.has(key)) messageHistory.set(key, []);
    const history = messageHistory.get(key);
    
    const recentHistory = history.filter(h => now - h.timestamp < 120000);
    messageHistory.set(key, recentHistory);

    const isDuplicate = recentHistory.some(h => h.content === content && h.embedsJson === embedsJson);
    
    if (isDuplicate) {
      await m.delete().catch(() => {});
      return;
    }

    recentHistory.push({ content, embedsJson, timestamp: now });
    messageHistory.set(key, recentHistory);

    if (!m.webhookId) {
      const isTradeChan = m.channel.id === TRADE_EXCLUDED_CHANNEL;
      const txt = content.toLowerCase();
      if (!isTradeChan && (txt.includes('trade') || txt.includes('trading'))) {
        await m.reply({ content: 'Please use the trading channel for trades, not this channel.', allowedMentions: { repliedUser: false } });
      }

      if (checkMsg(m, BLACKLIST_USERS)) {
        await m.delete().catch(() => {});
        if (m.member?.moderatable) {
          try { await m.member.timeout(300000, 'Blacklisted word'); } catch {}
        }
      }
      return;
    }

    const wId = m.webhookId;
    if (webhookCooldown.has(wId)) {
      if (now < webhookCooldown.get(wId)) return m.delete().catch(() => {});
      webhookCooldown.delete(wId);
      webhookTracker.delete(wId);
    }

    if (m.author.username !== 'Zenk') {
      await m.delete().catch(() => {});
      await restoreWebhook(wId, m.channelId);
      await sendLog(new EmbedBuilder().setTitle('⚠️ Webhook Name Violation').setDescription('A webhook with an incorrect name attempted to send a message').addFields({ name: 'Webhook Name', value: m.author.username, inline: true }, { name: 'Webhook ID', value: wId, inline: true }, { name: 'Channel', value: `${m.channel} (${m.channel.name})`, inline: false }, { name: 'Action Taken', value: 'Message deleted & webhook name restored to "Zenk"', inline: false }).setColor('#ff0000').setTimestamp());
      return;
    }

    if (checkMsg(m, BLACKLIST_WEBHOOK)) {
      await m.delete().catch(() => {});
      await sendLog(new EmbedBuilder().setTitle('🚫 Webhook Blacklist Detection').setDescription('A webhook message contained blacklisted words').addFields({ name: 'Webhook Name', value: m.author.username, inline: true }, { name: 'Webhook ID', value: wId, inline: true }, { name: 'Channel', value: `${m.channel} (${m.channel.name})`, inline: false }, { name: 'Message Content', value: m.content.length > 0 ? m.content.substring(0, 1024) : 'No content', inline: false }, { name: 'Action Taken', value: 'Message deleted', inline: false }).setColor('#ff0000').setTimestamp());
      return;
    }

    const list = webhookTracker.get(wId) || [];
    list.push({ timestamp: now, messageId: m.id });
    const recent = list.filter(x => now - x.timestamp < 8000);
    webhookTracker.set(wId, recent);

    if (recent.length >= 10) {
      await bulkDelete(m.channel, recent.map(x => x.messageId));
      webhookCooldown.set(wId, now + 30000);
      webhookTracker.set(wId, []);
      await sendLog(new EmbedBuilder().setTitle('⚡ Webhook Rate Limit Triggered').setDescription('A webhook exceeded the rate limit (10 messages in 8 seconds)').addFields({ name: 'Webhook Name', value: m.author.username, inline: true }, { name: 'Webhook ID', value: wId, inline: true }, { name: 'Channel', value: `${m.channel} (${m.channel.name})`, inline: false }, { name: 'Messages Deleted', value: `${recent.length} messages`, inline: true }, { name: 'Cooldown', value: '30 seconds', inline: true }).setColor('#ffa500').setTimestamp());
    }
  } catch (e) {
    console.log(`Message check failed: ${e.message}`);
  }
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
        await sendLog(new EmbedBuilder().setTitle('⏱️ User Timed Out').addFields({ name: 'User', value: `${user.tag} (${user.id})`, inline: true }, { name: 'Duration', value: duration, inline: true }, { name: 'Moderator', value: `${i.user.tag} (${i.user.id})`, inline: false }, { name: 'Channel', value: `${i.channel} (${i.channel.name})`, inline: false }).setColor('#ffa500').setTimestamp());
      } else if (i.commandName === 'unmute') {
        if (!i.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return i.reply({ content: 'No permissions', ephemeral: true });
        const user = i.options.getUser('user');
        const member = await i.guild.members.fetch(user.id);
        if (!member.moderatable) return i.reply({ content: 'Cannot unmute this user', ephemeral: true });
        await member.timeout(null, `Unmuted by ${i.user.tag}`);
        await i.reply({ content: `Unmuted ${user.tag}`, ephemeral: true });
        await sendLog(new EmbedBuilder().setTitle('✅ User Timeout Removed').addFields({ name: 'User', value: `${user.tag} (${user.id})`, inline: true }, { name: 'Moderator', value: `${i.user.tag} (${i.user.id})`, inline: true }, { name: 'Channel', value: `${i.channel} (${i.channel.name})`, inline: false }).setColor('#00ff00').setTimestamp());
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
                { id: i.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels] }
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
                { id: i.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
              ]
            });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('ticket-select')
            .setPlaceholder('Select a ticket type')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
              new StringSelectMenuOptionBuilder().setLabel('None').setValue('none').setDescription('Deselect'),
              new StringSelectMenuOptionBuilder().setLabel('Support').setValue('support').setDescription('For bug reports or help with questions')
            );

          await channel.send({
            embeds: [new EmbedBuilder().setTitle('🎫 Ticket System').setDescription('If you have any problems or questions, you can open a ticket here. Simply select the appropriate category from the dropdown menu below, and a private support channel will be created for you.').setColor('#5865F2').setTimestamp()],
            components: [new ActionRowBuilder().addComponents(selectMenu)]
          });

          setupConfig[feature] = channel.id;
          setupConfig.ticketCategory = ticketCategory.id;
          setupConfig.ticketLogs = ticketLogsChannel.id;
          writeSetup(setupConfig);

          await i.reply({ content: `Setup complete: ${feature} → ${channel}\nCategory and logs channel created!`, ephemeral: true });
          await sendLog(new EmbedBuilder().setTitle('⚙️ Ticket System Setup').addFields({ name: 'Feature', value: feature, inline: true }, { name: 'Channel', value: `${channel} (${channel.name})`, inline: true }, { name: 'Administrator', value: `${i.user.tag} (${i.user.id})`, inline: false }).setColor('#5865F2').setTimestamp());
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
                for (const [id, channel] of channelsInCategory) await channel.delete().catch(e => console.log(`Could not delete channel: ${e.message}`));
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
            await sendLog(new EmbedBuilder().setTitle('🗑️ Ticket System Removed').addFields({ name: 'Feature', value: feature, inline: true }, { name: 'Administrator', value: `${i.user.tag} (${i.user.id})`, inline: true }, { name: 'Action', value: 'All ticket channels, category, and logs deleted', inline: false }).setColor('#ff0000').setTimestamp());
          } catch (e) {
            console.log(`Resetup failed: ${e.message}`);
            await i.reply({ content: 'Failed to remove ticket setup completely.', ephemeral: true });
          }
        } else {
          await i.reply({ content: `No setup found for: ${feature}`, ephemeral: true });
        }
      } else if (i.commandName === 'clear') {
        if (!i.member.permissions.has(PermissionFlagsBits.ManageMessages)) return i.reply({ content: 'You do not have permission to manage messages.', ephemeral: true });

        const amount = i.options.getInteger('amount');
        const targetUser = i.options.getUser('user');

        try {
          const fetched = await i.channel.messages.fetch({ limit: amount > 100 ? 100 : amount });

          let toDelete = fetched;
          if (targetUser) {
            const arr = fetched.filter(m => m.author.id === targetUser.id).first(amount);
            if (arr) {
              const ids = arr.map(m => m.id);
              toDelete = fetched.filter(m => ids.includes(m.id));
            } else {
              toDelete = fetched.clear();
            }
          }

          if (!toDelete || toDelete.size === 0) return i.reply({ content: 'No messages found to delete.', ephemeral: true });

          const deleted = await i.channel.bulkDelete(toDelete, true);

          await i.reply({ content: `Deleted ${deleted.size} message(s)` + (targetUser ? ` from ${targetUser.tag}` : '') + '.', ephemeral: true });
        } catch (e) {
          console.log(`Clear failed: ${e.message}`);
          await i.reply({ content: 'Failed to delete messages. Only messages newer than 14 days can be bulk deleted.', ephemeral: true });
        }
      }
    } else if (i.isStringSelectMenu() && i.customId === 'ticket-select') {
      const selectedValue = i.values[0];
      if (selectedValue === 'none') return i.reply({ content: 'Selection cleared.', ephemeral: true });
      if (activeTickets.has(i.user.id)) {
        const existingTicketId = activeTickets.get(i.user.id);
        return i.reply({ content: `You already have an active ticket: <#${existingTicketId}>`, ephemeral: true });
      }

      const modal = new ModalBuilder().setCustomId('ticket-create-modal').setTitle('Create Support Ticket');
      const executorInput = new TextInputBuilder().setCustomId('executor-input').setLabel('Executor').setStyle(TextInputStyle.Short).setPlaceholder('Bunni, Delta...').setRequired(true);
      const problemInput = new TextInputBuilder().setCustomId('problem-input').setLabel('What is your problem?').setStyle(TextInputStyle.Paragraph).setPlaceholder('Please describe your issue in detail...').setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(executorInput), new ActionRowBuilder().addComponents(problemInput));
      await i.showModal(modal);
    } else if (i.isButton() && i.customId === 'close-ticket') {
      const modal = new ModalBuilder().setCustomId('close-ticket-modal').setTitle('Close Ticket');
      const reasonInput = new TextInputBuilder().setCustomId('close-reason').setLabel('Reason for closing').setStyle(TextInputStyle.Paragraph).setPlaceholder('Please provide a reason...').setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      await i.showModal(modal);
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
              { id: i.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
              { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
              { id: STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
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

          const ticketMessage = await ticketChannel.send({
            content: `${i.user}`,
            embeds: [ticketEmbed],
            components: [new ActionRowBuilder().addComponents(closeButton)]
          });

          await ticketMessage.pin();
          await i.editReply({ content: `✅ Your ticket has been created: ${ticketChannel}`, ephemeral: true });

          await sendLog(new EmbedBuilder().setTitle('🎫 Ticket Created').addFields({ name: 'User', value: `${i.user.tag} (${i.user.id})`, inline: false }, { name: 'Ticket Channel', value: `${ticketChannel} (${ticketChannel.name})`, inline: false }, { name: 'Executor', value: executor, inline: true }, { name: 'Problem', value: problem.substring(0, 1024), inline: false }).setColor('#5865F2').setTimestamp());
        } catch (e) {
          console.log(`Ticket creation failed: ${e.message}`);
          await i.editReply({ content: '❌ Failed to create ticket.', ephemeral: true });
        }
      } else if (i.customId === 'close-ticket-modal') {
        const reason = i.fields.getTextInputValue('close-reason');
        const channel = i.channel;
        const ticketUser = Array.from(activeTickets.entries()).find(([userId, channelId]) => channelId === channel.id);
        if (!ticketUser) return i.reply({ content: 'Ticket user not found.', ephemeral: true });

        const [userId] = ticketUser;
        activeTickets.delete(userId);

        await i.reply({ content: `✅ Ticket is being closed...`, ephemeral: true });

        const user = await client.users.fetch(userId).catch(() => null);
        if (user) {
          try {
            await user.send({ embeds: [new EmbedBuilder().setTitle('🎫 Ticket Closed').setDescription(`Your ticket **${channel.name}** has been closed.`).addFields({ name: 'Reason', value: reason }).setColor('#ff0000').setTimestamp()] });
          } catch {}
        }

        if (setupConfig.ticketLogs) {
          const logsChannel = await client.channels.fetch(setupConfig.ticketLogs).catch(() => null);
          if (logsChannel) {
            await logsChannel.send({
              embeds: [new EmbedBuilder().setTitle(`📋 Ticket Closed: ${channel.name}`).addFields({ name: 'Ticket User', value: `<@${userId}>`, inline: true }, { name: 'Closed By', value: `<@${i.user.id}>`, inline: true }, { name: 'Reason', value: reason }).setColor('#ff0000').setTimestamp()]
            });
          }
        }

        await sendLog(new EmbedBuilder().setTitle('🎫 Ticket Closed').addFields({ name: 'Ticket Channel', value: channel.name, inline: true }, { name: 'User', value: user ? `${user.tag} (${userId})` : userId, inline: true }, { name: 'Closed By', value: `${i.user.tag} (${i.user.id})`, inline: false }, { name: 'Reason', value: reason, inline: false }).setColor('#ff0000').setTimestamp());

        setTimeout(async () => { try { await channel.delete(); } catch (e) { console.log(`Could not delete channel: ${e.message}`); } }, 5000);
      }
    }
  } catch (e) {
    console.log(`Interaction failed: ${e.message}`);
  }
});

app.post('/rating', async (req, res) => {
  console.log('Rating request received:', req.body);
  try {
    if (!client.isReady()) return res.status(503).json({ success: false, error: 'Bot is not ready yet' });
    const { message, stars, timestamp } = req.body;
    if (!message || !stars || !timestamp) return res.status(400).json({ success: false, error: 'Missing required fields: message, stars, timestamp' });
    const starsNum = Number(stars);
    if (isNaN(starsNum) || starsNum < 1 || starsNum > 5) return res.status(400).json({ success: false, error: 'Stars must be a number between 1 and 5' });

    const embed = new EmbedBuilder()
      .setTitle('⭐ New Rating')
      .setDescription(String(message))
      .setColor(3447003)
      .addFields({ name: 'Rating', value: '⭐'.repeat(starsNum), inline: true })
      .setTimestamp(new Date(timestamp));

    const channel = await client.channels.fetch(RATING_CHANNEL_ID).catch(() => null);
    if (!channel) return res.status(404).json({ success: false, error: 'Rating channel not found' });

    await channel.send({ embeds: [embed] });
    console.log('Rating sent successfully');
    res.status(200).json({ success: true, message: 'Rating submitted successfully' });
  } catch (error) {
    console.error('Rating submission error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/execution', async (req, res) => {
  try {
    executionCount++;
    writeExecutions(executionCount);
    res.json({ success: true, count: executionCount });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/export', (req, res) => {
  res.type('text/plain').send(String(executionCount));
});

app.post('/import', (req, res) => {
  const n = Number(req.body?.count);
  if (!Number.isFinite(n) || n < 0) return res.status(400).json({ success: false });
  executionCount = Math.floor(n);
  writeExecutions(executionCount);
  res.json({ success: true, count: executionCount });
});

app.get('/', (req, res) => {
  res.json({ status: 'online', executions: executionCount, members: memberCount, botReady: client.isReady() });
});

const port = config.port || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));

client.login(config.token);
