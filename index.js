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

let executionCount = 0;
let lastUpdate = 0;
const UPDATE_COOLDOWN = 2 * 60 * 1000;
const logFile = path.join(__dirname, 'logs.txt');

function addLog(message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    console.log(logEntry.trim());
    
    try {
        fs.appendFileSync(logFile, logEntry);
    } catch (err) {
        console.error('Failed to write log:', err.message);
    }
}

client.once('ready', async () => {
    addLog(`Bot online as ${client.user.tag}`);
    
    try {
        const channel = await client.channels.fetch(config.channelId);
        
        if (!channel) {
            addLog('ERROR: Channel not found!');
            return;
        }
        
        addLog(`Channel found: ${channel.name}`);
        
        if (!channel.isVoiceBased()) {
            addLog('ERROR: Not a voice channel!');
            return;
        }
        
        const permissions = channel.permissionsFor(client.user);
        addLog(`ManageChannels: ${permissions.has(PermissionFlagsBits.ManageChannels)}`);
        
        const currentName = channel.name;
        const match = currentName.match(/Executions:\s*(\d+)/);
        if (match) {
            executionCount = parseInt(match[1]);
        }
        addLog(`Starting count: ${executionCount}`);
    } catch (error) {
        addLog(`ERROR: ${error.message}`);
    }
});

app.post('/execution', async (req, res) => {
    try {
        executionCount++;
        const now = Date.now();

        addLog(`Execution #${executionCount}`);

        if (now - lastUpdate < UPDATE_COOLDOWN) {
            res.json({ success: true, count: executionCount, updated: false });
            return;
        }

        const channel = await client.channels.fetch(config.channelId);
        if (channel && channel.isVoiceBased()) {
            await channel.setName(`Executions: ${executionCount}`);
            lastUpdate = now;
            addLog(`Channel updated: Executions: ${executionCount}`);
            res.json({ success: true, count: executionCount, updated: true });
            return;
        }

        res.status(404).json({ success: false, error: 'Channel not found' });
    } catch (e) {
        addLog(`ERROR: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/', (req, res) => {
    res.json({ 
        status: 'online', 
        executions: executionCount,
        botReady: client.isReady()
    });
});

app.get('/logs', (req, res) => {
    try {
        if (fs.existsSync(logFile)) {
            const logs = fs.readFileSync(logFile, 'utf8');
            res.type('text/plain').send(logs);
        } else {
            res.send('No logs file found');
        }
    } catch (error) {
        res.status(500).send('Error reading logs');
    }
});

app.listen(config.port, () => {
    addLog(`Server running on port ${config.port}`);
});

client.login(config.token);
