const { Client, GatewayIntentBits } = require('discord.js');
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

client.once('ready', async () => {
    console.log(`Bot online as ${client.user.tag}`);
    
    try {
        const channel = await client.channels.fetch(config.channelId);
        
        if (!channel) {
            console.error('Channel not found! Check CHANNEL_ID');
            return;
        }
        
        if (!channel.isVoiceBased()) {
            console.error('Channel is not a voice channel!');
            return;
        }
        
        const currentName = channel.name;
        const match = currentName.match(/Executions:\s*(\d+)/);
        if (match) {
            executionCount = parseInt(match[1]);
        }
        console.log(`Current executions: ${executionCount}`);
    } catch (error) {
        console.error('Error fetching channel:', error.message);
        console.error('Make sure bot has VIEW_CHANNELS and MANAGE_CHANNELS permissions!');
    }
});

app.post('/execution', async (req, res) => {
    try {
        executionCount++;
        
        const channel = await client.channels.fetch(config.channelId);
        if (channel && channel.isVoiceBased()) {
            await channel.setName(`Executions: ${executionCount}`);
            console.log(`Updated executions to: ${executionCount}`);
            res.json({ success: true, count: executionCount });
        } else {
            res.status(404).json({ success: false, error: 'Channel not found' });
        }
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/', (req, res) => {
    res.json({ status: 'online', executions: executionCount });
});

app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
});

client.login(config.token);
