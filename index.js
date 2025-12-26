const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const app = express();
app.use(express.json());

const UPDATE_COOLDOWN = 2 * 60 * 1000;

let executionCount = 0;
let lastUpdate = 0;

const executionsFile = path.join(__dirname, 'Executions.txt');

function loadExecutions() {
    try {
        if (!fs.existsSync(executionsFile)) return;
        const raw = fs.readFileSync(executionsFile, 'utf8').trim();
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) executionCount = Math.floor(n);
    } catch {}
}

function saveExecutions() {
    try {
        fs.writeFileSync(executionsFile, String(executionCount));
    } catch {}
}

async function renameChannelSafe() {
    const channel = await client.channels.fetch(config.channelId);
    if (!channel) return;

    if (!channel.isVoiceBased()) return;

    const perms = channel.permissionsFor(client.user);
    if (!perms || !perms.has(PermissionFlagsBits.ManageChannels)) return;

    await channel.setName(`Executions: ${executionCount}`);
    lastUpdate = Date.now();
}

client.once('ready', async () => {
    console.log(`Bot online as ${client.user.tag}`);

    loadExecutions();
    console.log(`Loaded executions: ${executionCount}`);

    try {
        await renameChannelSafe();
    } catch (e) {
        console.log(`Rename on ready failed: ${e.message}`);
    }
});

app.post('/execution', async (req, res) => {
    try {
        executionCount++;
        saveExecutions();

        const now = Date.now();
        if (now - lastUpdate >= UPDATE_COOLDOWN) {
            try {
                await renameChannelSafe();
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

app.post('/import', (req, res) => {
    const n = Number(req.body && req.body.count);
    if (!Number.isFinite(n) || n < 0) {
        res.status(400).json({ success: false });
        return;
    }

    executionCount = Math.floor(n);
    saveExecutions();

    res.json({ success: true, count: executionCount });
});

app.get('/export', (req, res) => {
    res.type('text/plain').send(String(executionCount));
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
