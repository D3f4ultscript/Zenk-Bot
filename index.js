const { Client, GatewayIntentBits } = require('discord.js');
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
const UPDATE_COOLDOWN = 5 * 60 * 1000; // 5 Minuten Cooldown
const logFile = path.join(__dirname, 'executionlogs.txt');

function writeLog(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logFile, logMessage);
    console.log(logMessage.trim());
}

client.once('ready', async () => {
    writeLog(`Bot online as ${client.user.tag}`);
    
    try {
        const channel = await client.channels.fetch(config.channelId);
        
        if (!channel) {
            writeLog('ERROR: Channel not found! Check CHANNEL_ID');
            return;
        }
        
        if (!channel.isVoiceBased()) {
            writeLog('ERROR: Channel is not a voice channel!');
            return;
        }
        
        const permissions = channel.permissionsFor(client.user);
        if (!permissions.has('ManageChannels')) {
            writeLog('ERROR: Bot missing MANAGE_CHANNELS permission!');
            return;
        }
        
        const currentName = channel.name;
        const match = currentName.match(/Executions:\s*(\d+)/);
        if (match) {
            executionCount = parseInt(match[1]);
        }
        writeLog(`Current executions: ${executionCount}`);
    } catch (error) {
        writeLog(`ERROR fetching channel: ${error.message}`);
    }
});

app.post('/execution', async (req, res) => {
    try {
        executionCount++;
        const currentTime = Date.now();
        
        writeLog(`Execution #${executionCount} received`);
        
        if (currentTime - lastUpdate < UPDATE_COOLDOWN) {
            const waitTime = Math.ceil((UPDATE_COOLDOWN - (currentTime - lastUpdate)) / 1000);
            writeLog(`Cooldown active. Channel will update in ${waitTime} seconds`);
            res.json({ 
                success: true, 
                count: executionCount,
                message: `Execution logged. Channel updates in ${waitTime}s due to Discord rate limits` 
            });
            return;
        }
        
        const channel = await client.channels.fetch(config.channelId);
        if (channel && channel.isVoiceBased()) {
            await channel.setName(`Executions: ${executionCount}`);
            lastUpdate = currentTime;
            writeLog(`Channel updated to: Executions: ${executionCount}`);
            res.json({ success: true, count: executionCount, updated: true });
        } else {
            writeLog('ERROR: Channel not found or not voice channel');
            res.status(404).json({ success: false, error: 'Channel not found' });
        }
    } catch (error) {
        writeLog(`ERROR: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/', (req, res) => {
    res.json({ 
        status: 'online', 
        executions: executionCount,
        lastUpdate: lastUpdate > 0 ? new Date(lastUpdate).toISOString() : 'never'
    });
});

app.get('/logs', (req, res) => {
    try {
        if (fs.existsSync(logFile)) {
            const logs = fs.readFileSync(logFile, 'utf8');
            res.type('text/plain').send(logs);
        } else {
            res.send('No logs yet');
        }
    } catch (error) {
        res.status(500).send('Error reading logs');
    }
});

setInterval(() => {
    fetch(`http://localhost:${config.port}/`)
        .then(() => console.log('Keep-alive'))
        .catch(() => {});
}, 600000);

app.listen(config.port, () => {
    writeLog(`Server running on port ${config.port}`);
});

client.login(config.token);
