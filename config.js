require('dotenv').config();

module.exports = {
    token: process.env.DISCORD_TOKEN,
    channelId: process.env.CHANNEL_ID,
    port: process.env.PORT || 3000
};
