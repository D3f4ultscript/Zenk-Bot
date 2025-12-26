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

const executionsFile = path.join(__dirname, 'Executions.txt');
const UPDATE_COOLDOWN = 2 * 60 * 1000;

let executionCount = 0;
let lastUpdate = 0;

function loadExecutions() {
    try {
        if (fs.existsSync(executionsFile)) {
            const raw = fs.readFileSync(executionsFile, 'utf8').trim();
            const n = tonumber(raw);
            if (!isNaN(n) && n >= 0) executionCount = n;
        }
    } catch {}
}

function saveExecutions() {
    try {
        fs.writeFileSync(executionsFile, String(executionCount));
    } catch {}
}

client.once('ready', async () => {
    console.log(`Bot online as ${client.user.tag}`);

    loadExecutions();
    console.log(`Loaded executions: ${executionCount}`);

    try {
        const channel = await client.channels.fetch(config.channelId);
        if (!channel) return;

        const perms = channel.permissionsFor(client.user);
        if (!perms || !perms.has(PermissionFlagsBits.ManageChannels)) {
            console.log('Missing MANAGE_CHANNELS');
            return;
        }

        if (channel.isVoiceBased()) {
            await channel.setName(`Executions: ${executionCount}`);
            lastUpdate = Date.now();
        }
    } catch (e) {
        console.log('Ready error:', e.message);
    }
});

app.post('/execution', async (req, res) => {
    try {
        executionCount++;
        saveExecutions();

        const now = Date.now();
        if (now - lastUpdate < UPDATE_COOLDOWN) {
            res.json({ success: true, count: executionCount, updated: false });
            return;
        }

        const channel = await client.channels.fetch(config.channelId);
        if (channel && channel.isVoiceBased()) {
            await channel.setName(`Executions: ${executionCount}`);
            lastUpdate = now;
            res.json({ success: true, count: executionCount, updated: true });
            return;
        }

        res.status(404).json({ success: false, error: 'Channel not found' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
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
