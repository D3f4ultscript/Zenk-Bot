require('dotenv').config();

module.exports = {
  token: process.env.DISCORD_TOKEN,
  channelId: process.env.CHANNEL_ID,
  memberChannelId: '1454427807701663774',
  port: process.env.PORT || 3000
};
