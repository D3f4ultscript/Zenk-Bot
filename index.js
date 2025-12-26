const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const express = require('express');
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
let logs = [];
const UPDATE_COOLDOWN = 5 * 60 * 1000;

function addLog(message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    logs.push(logEntry);
    console.log(logEntry);
    if (logs.length > 100) logs.shift();
}

client.once('ready', async () => {
    addLog(`Bot online as ${client.user.tag}`);
    
    try {
        const channel = await client.channels.fetch(config.channelId);
        
        if (!channel) {
            addLog('ERROR: Channel not found!');
            return;
        }
        
        addLog(`Channel found: ${channel.name} (Type: ${channel.type})`);
        
        if (!channel.isVoiceBased()) {
            addLog('ERROR: Not a voice channel!');
            return;
        }
        
        const permissions = channel.permissionsFor(client.user);
        addLog(`Bot has ManageChannels: ${permissions.has(PermissionFlagsBits.ManageChannels)}`);
        addLog(`Bot has ViewChannel: ${permissions.has(PermissionFlagsBits.ViewChannel)}`);
        
        const currentName = channel.name;
        const match = currentName.match(/Executions:\s*(\d+)/);
        if (match) {
            executionCount = parseInt(match[1]);
        }
        addLog(`Starting execution count: ${executionCount}`);
    } catch (error) {
        addLog(`ERROR: ${error.message}`);
    }
});

app.post('/execution', async (req, res) => {
    addLog('POST /execution received');
    
    try {
        executionCount++;
        const currentTime = Date.now();
        
        addLog(`Execution #${executionCount} logged`);
        
        if (currentTime - lastUpdate < UPDATE_COOLDOWN) {
            const waitTime = Math.ceil((UPDATE_COOLDOWN - (currentTime - lastUpdate)) / 1000);
            addLog(`Cooldown: ${waitTime}s remaining`);
            res.json({ 
                success: true, 
                count: executionCount,
                cooldown: waitTime
            });
            return;
        }
        
        addLog('Attempting to update channel...');
        const channel = await client.channels.fetch(config.channelId);
        
        if (channel && channel.isVoiceBased()) {
            await channel.setName(`Executions: ${executionCount}`);
            lastUpdate = currentTime;
            addLog(`SUCCESS: Channel renamed to "Executions: ${executionCount}"`);
            res.json({ success: true, count: executionCount, updated: true });
        } else {
            addLog('ERROR: Channel not found');
            res.status(404).json({ success: false, error: 'Channel not found' });
        }
    } catch (error) {
        addLog(`ERROR: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
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

app.get('/logs', (req, res) => {
    res.type('text/plain').send(logs.join('\n') || 'No logs yet');
});

setInterval(() => {
    fetch(`http://localhost:${config.port}/`)
        .catch(() => {});
}, 600000);

app.listen(config.port, () => {
    addLog(`Server running on port ${config.port}`);
});

client.login(config.token).catch(err => {
    addLog(`Login error: ${err.message}`);
});
