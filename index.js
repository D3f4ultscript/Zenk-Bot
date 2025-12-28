const { Client, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildWebhooks]
});

const app = express();
app.use(express.json());

const BLACKLIST_WEBHOOK = ['fuck', 'shit', 'bitch', 'ass', 'asshole', 'bastard', 'damn', 'cunt', 'dick', 'cock', 'pussy', 'whore', 'slut', 'fag', 'faggot', 'nigger', 'nigga', 'retard', 'retarded', 'rape', 'nazi', 'hitler', 'kys', 'kill yourself', 'motherfucker', 'bullshit', 'piss', 'prick', 'twat', 'wanker', 'bollocks', 'arse', 'tosser', 'bellend', 'scheiße', 'scheisse', 'scheiß', 'scheiss', 'ficken', 'fick', 'arsch', 'arschloch', 'fotze', 'hure', 'nutte', 'wichser', 'hurensohn', 'schwuchtel', 'schwul', 'dumm', 'idiot', 'trottel', 'vollidiot', 'drecksau', 'sau', 'schwein', 'drecksschwein', 'miststück', 'pisser', 'kacke', 'scheisskerl', 'wixer', 'spast', 'mongo', 'behinderter', 'opfer', 'penner', 'dreckskerl', 'arschlecker', 'pissnelke', 'fotznbrädl', 'möse', 'pimmel', 'schwanz', 'leck mich', 'verpiss dich', 'halt die fresse', 'fresse', 'halt maul', 'maul'];
const BLACKLIST_USERS = BLACKLIST_WEBHOOK.filter(w => w !== 'shit' && w !== 'ass');

let executionCount = 0, lastUpdate = 0;
const executionsFile = path.join(__dirname, 'Executions.txt');
const webhookTracker = new Map(), webhookCooldown = new Map();

const parseExecutions = (name) => { const m = String(name || '').match(/Executions:\s*(\d+)/i); return m ? Number(m[1]) : null; };
const readFile = () => { try { if (!fs.existsSync(executionsFile)) return null; const n = Number(fs.readFileSync(executionsFile, 'utf8').trim()); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null; } catch {} return null; };
const writeFile = (n) => { try { fs.writeFileSync(executionsFile, String(n)); return true; } catch { return false; } };
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
  console.log(`Bot online as ${client.user.tag}`);
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
    new SlashCommandBuilder().setName('unmute').setDescription('Remove timeout from a user').addUserOption(o => o.setName('user').setDescription('User to unmute').setRequired(true))
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Slash commands registered');
  } catch (e) { console.log(`Command registration failed: ${e.message}`); }
});

client.on('guildMemberAdd', updateMembers);
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
        if (m.member?.moderatable) {
          try { await m.member.timeout(600000, 'Blacklisted word'); } catch (e) { console.log(`Timeout failed: ${e.message}`); }
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
  if (!i.isChatInputCommand()) return;
  try {
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
    }
  } catch (e) { console.log(`Command failed: ${e.message}`); await i.reply({ content: 'Command failed', ephemeral: true }).catch(() => {}); }
});

app.post('/execution', async (req, res) => {
  try {
    executionCount++; writeFile(executionCount);
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
    writeFile(n); res.type('text/plain').send(String(n));
  } catch { res.status(500).type('text/plain').send(String(executionCount)); }
});

app.post('/import', async (req, res) => {
  const n = Number(req.body?.count);
  if (!Number.isFinite(n) || n < 0) return res.status(400).json({ success: false });
  executionCount = Math.floor(n); writeFile(executionCount);
  try {
    const c = await fetchVC(config.channelId);
    if (c) { await renameChannel(c, `Executions: ${executionCount}`); lastUpdate = Date.now(); }
  } catch {}
  res.json({ success: true, count: executionCount });
});

app.get('/', (req, res) => { res.json({ status: 'online', executions: executionCount, lastUpdate: lastUpdate > 0 ? new Date(lastUpdate).toISOString() : 'never', botReady: client.isReady() }); });
app.listen(config.port, () => console.log(`Server running on port ${config.port}`));
client.login(config.token);
