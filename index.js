require('dotenv').config();
const Discord = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ejs = require('ejs');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

// Create views/public directories if they don't exist
if (!fs.existsSync(path.join(__dirname, 'views'))) {
  fs.mkdirSync(path.join(__dirname, 'views'));
}
if (!fs.existsSync(path.join(__dirname, 'public'))) {
  fs.mkdirSync(path.join(__dirname, 'public'));
}

// Express route for leaderboard
app.get('/leaderboard', async (req, res) => {
  const sortedModerators = Object.entries(moderatorPoints)
    .map(([id, points]) => ({ id, points }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 100);

  const moderatorsWithAvatars = await Promise.all(sortedModerators.map(async mod => {
    try {
      const user = await client.users.fetch(mod.id);
      return {
        ...mod,
        avatar: user.displayAvatarURL({ dynamic: true, size: 64 }),
        username: user.username
      };
    } catch {
      return {
        ...mod,
        avatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
        username: `Unknown (${mod.id})`
      };
    }
  }));

  res.render('leaderboard', {
    moderators: moderatorsWithAvatars,
    lastUpdated: new Date(),
    currentCelebration,
    botName: client.user?.username || 'ModTracker'
  });
});

// Health check
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ONLINE', bot: 'Moderator Activity Tracker', uptime: process.uptime() });
});

const server = app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
});

// Discord Client
const client = new Discord.Client({ 
  intents: [
    Discord.Intents.FLAGS.GUILDS,
    Discord.Intents.FLAGS.GUILD_MESSAGES,
    Discord.Intents.FLAGS.GUILD_MEMBERS,
    Discord.Intents.FLAGS.GUILD_MESSAGE_REACTIONS
  ] 
});

const leaderboardChannelId = process.env.LEADERBOARD_CHANNEL_ID;
const token = process.env.DISCORD_BOT_TOKEN;
if (!token || !leaderboardChannelId) {
  console.error('Missing required environment variables!');
  process.exit(1);
}

let moderatorPoints = {};
let leaderboardMessageId = null;
let currentCelebration = null;
const dataFilePath = path.join(__dirname, 'moderatorData.json');
const startTime = new Date();
const leaderboardURL = 'https://your-render-app.onrender.com/leaderboard'; // 🔁 Change this to your Render domain

function loadData() {
  try {
    if (fs.existsSync(dataFilePath)) {
      const rawData = fs.readFileSync(dataFilePath, 'utf-8');
      const data = JSON.parse(rawData);
      moderatorPoints = data.moderatorPoints || {};
      leaderboardMessageId = data.leaderboardMessageId || null;
    }
  } catch (error) {
    console.error('Error loading data:', error);
  }
}

function saveData() {
  try {
    const data = { moderatorPoints, leaderboardMessageId };
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2));
    console.log('Data saved successfully');
  } catch (error) {
    console.error('Error saving data:', error);
  }
}

// Set up periodic saving every 30 seconds
function setupPeriodicSaving() {
  setInterval(() => {
    saveData();
    console.log(`[${new Date().toLocaleTimeString()}] 🔄 Saved Moderators Data.`);
  }, 30 * 1000); // 30 seconds
}


async function initializeLeaderboard() {
  const channel = client.channels.cache.get(leaderboardChannelId);
  if (!channel) return console.error('Leaderboard channel not found!');

  try {
    if (leaderboardMessageId) {
      await channel.messages.fetch(leaderboardMessageId);
      await updateLeaderboard();
    } else {
      await createNewLeaderboard();
    }
  } catch {
    console.log('Leaderboard message not found, creating new one...');
    await createNewLeaderboard();
  }
}

function updateBotStatus() {
  try {
    const totalPoints = Object.values(moderatorPoints).reduce((a, b) => a + b, 0);
    const moderatorCount = Object.keys(moderatorPoints).length;
    const statusMessages = [
      `Tracking ${moderatorCount} moderators`,
      `${totalPoints} total points`,
      `Leaderboard updates`,
      `musicobot.xyz`
    ];
    const randomStatus = statusMessages[Math.floor(Math.random() * statusMessages.length)];
    client.user.setPresence({
      activity: { name: randomStatus, type: 'WATCHING' },
      status: 'online'
    });
  } catch (error) {
    console.error('Error updating bot status:', error);
  }
}

function createLeaderboardEmbed(celebration = null) {
  const sortedModerators = Object.entries(moderatorPoints)
    .map(([id, points]) => ({ id, points }))
    .sort((a, b) => b.points - a.points);

  const embed = new Discord.MessageEmbed()
    .setTitle('Moderator Activity Leaderboard')
    .setColor('#0099ff')
    .setDescription('Points are awarded for each message sent in the server')
    .setTimestamp();

  if (celebration) embed.addField('🎉 Milestone Reached! 🎉', celebration, false);

  if (sortedModerators.length > 0) {
    const leaderboardText = sortedModerators.map((mod, index) => `${index + 1}. <@${mod.id}> - ${mod.points} points`).join('\n');
    embed.addField('Top Moderators', leaderboardText);
  } else {
    embed.addField('No activity yet', 'Moderators will appear here once they start chatting!');
  }

  return embed;
}

async function handleCelebration(message, userId, oldPoints, newPoints) {
  const milestones = [100, 250, 500, 1000, 1500, 2000, 3000, 5000];
  const reachedMilestones = milestones.filter(m => oldPoints < m && newPoints >= m);

  if (reachedMilestones.length > 0) {
    const latestMilestone = Math.max(...reachedMilestones);
    const member = message.member || await message.guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    let celebrationMessage;
    if (latestMilestone >= 5000) {
      celebrationMessage = `🎊 **LEGENDARY!** ${member} has reached **${latestMilestone} points**! 🏆`;
    } else if (latestMilestone >= 1000) {
      celebrationMessage = `🎉 **EPIC!** ${member} just hit **${latestMilestone} points**! ✨`;
    } else {
      celebrationMessage = `🌟 **Congratulations!** ${member} reached **${latestMilestone} points**!`;
    }

    currentCelebration = celebrationMessage;
    await updateLeaderboard();

    setTimeout(() => {
      currentCelebration = null;
      updateLeaderboard().catch(console.error);
    }, 60 * 60 * 1000);

    if (latestMilestone >= 1000) {
      try {
        const role = message.guild.roles.cache.find(r => r.name === '👑 Mod Of The Month');
        if (role) await member.roles.add(role).catch(console.error);
      } catch (error) {
        console.error('Could not add milestone role:', error);
      }
    }
  }
}

async function updateLeaderboard() {
  try {
    const channel = client.channels.cache.get(leaderboardChannelId);
    if (!channel || !channel.isText()) return;

    if (leaderboardMessageId) {
      const message = await channel.messages.fetch(leaderboardMessageId).catch(() => null);
      if (message) {
        await message.edit(createLeaderboardEmbed(currentCelebration));
        return;
      }
    }
    await createNewLeaderboard();
  } catch (error) {
    console.log('Failed to update leaderboard:', error);
    await createNewLeaderboard();
  }
}

async function createNewLeaderboard() {
  try {
    const channel = client.channels.cache.get(leaderboardChannelId);
    if (!channel || !channel.isText()) return;

    if (leaderboardMessageId) {
      try {
        const oldMessage = await channel.messages.fetch(leaderboardMessageId).catch(() => null);
        if (oldMessage) await oldMessage.delete().catch(() => {});
      } catch (error) {
        console.error('Error deleting old message:', error);
      }
    }

    const sentMessage = await channel.send(createLeaderboardEmbed(currentCelebration));
    leaderboardMessageId = sentMessage.id;
    saveData();
  } catch (error) {
    console.error('Error creating new leaderboard:', error);
  }
}

function formatUptime() {
  const seconds = Math.floor(process.uptime());
  const days = Math.floor(seconds / (3600 * 24));
  const hours = Math.floor((seconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  loadData();
  initializeLeaderboard().catch(console.error);
  updateBotStatus();
  setInterval(updateBotStatus, 5 * 60 * 1000);
  setupPeriodicSaving(); // Start the periodic saving
});

client.on('message', async message => {
  if (message.author.bot || !message.guild) return;

  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return;

  const moderatorRole = member.roles.cache.find(role => role.name === 'Moderators');

  // ? Commands
  if (message.content.startsWith('?')) {
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    switch (command) {
      case 'ping':
        const sent = await message.channel.send('Pinging...');
        const latency = sent.createdTimestamp - message.createdTimestamp;
        await sent.edit(`🏓 Pong! Bot Latency: ${latency}ms | API Latency: ${Math.round(client.ws.ping)}ms`);
        break;

      case 'uptime':
        await message.channel.send(`🕒 Bot Uptime: ${formatUptime()}\nStarted at: ${startTime.toUTCString()}`);
        break;

      case 'info':
        const canEmbed = message.channel.permissionsFor(message.guild.me).has('EMBED_LINKS');
        if (canEmbed) {
          const infoEmbed = new Discord.MessageEmbed()
            .setTitle('Moderator Activity Tracker Bot')
            .setColor('#0099ff')
            .setDescription('Tracks moderator activity and shows a leaderboard')
            .addField('Creator', 'Georgio', true)
            .addField('Version', '1.0', true)
            .addField('Commands', '?ping, ?uptime, ?info, ?web', false)
            .addField('Total Moderators Tracked', Object.keys(moderatorPoints).length.toString(), true)
            .addField('Total Points Awarded', Object.values(moderatorPoints).reduce((a, b) => a + b, 0).toString(), true)
            .setFooter('musico.xyz')
            .setTimestamp();
          await message.channel.send({ embeds: [infoEmbed] });
        } else {
          await message.channel.send([
            '**Moderator Activity Tracker Bot**',
            'Tracks moderator activity and shows a leaderboard',
            '',
            '**Creator**: Georgio',
            '**Version**: 1.0',
            '**Commands**: ?ping, ?uptime, ?info, ?web',
            `**Total Moderators Tracked**: ${Object.keys(moderatorPoints).length}`,
            `**Total Points Awarded**: ${Object.values(moderatorPoints).reduce((a, b) => a + b, 0)}`,
            '',
            'musico.xyz'
          ].join('\n'));
        }
        break;

      case 'web':
        if (!moderatorRole) {
          return message.reply('❌ You must be a moderator to use this command!');
        }

        try {
          await message.author.send(`📊 Here is the Moderator Leaderboard:\nhttps://activity-bot-musico.onrender.com/leaderboard`);
          
          // React only if the DM was successfully sent
          if (message.channel.type !== 'DM') {
            await message.react('📬');
          }
        } catch (err) {
          // Only shows this message if the DM truly fails
          await message.reply("❌ I couldn't DM you! Please enable DMs from server members.");
        }
        break;
      default:
        await message.channel.send('❓ Unknown command. Try ?ping, ?uptime, ?info, or ?web');
    }
    return;
  }

  if (!moderatorRole) return;

  const userId = message.author.id;
  const oldPoints = moderatorPoints[userId] || 0;
  moderatorPoints[userId] = oldPoints + 1;
  saveData();
  updateBotStatus();
  await handleCelebration(message, userId, oldPoints, moderatorPoints[userId]);
  await updateLeaderboard();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  saveData();
  server.close(() => {
    console.log('Express server closed');
    process.exit(0);
  });
});

client.login(token);