require('dotenv').config();
const Discord = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Basic middleware
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    bot: 'Moderator Activity Tracker',
    uptime: process.uptime()
  });
});

// Start Express server
const server = app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
});

// Initialize Discord client
const client = new Discord.Client();

// Configuration from environment variables
const leaderboardChannelId = process.env.LEADERBOARD_CHANNEL_ID;
const token = process.env.DISCORD_BOT_TOKEN;

if (!token || !leaderboardChannelId) {
  console.error('Missing required environment variables!');
  process.exit(1);
}

// Initialize data
let moderatorPoints = {};
let leaderboardMessageId = null;
let currentCelebration = null;
const dataFilePath = path.join(__dirname, 'moderatorData.json');

// Bot start time for uptime calculation
const startTime = new Date();

// Load data from file
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

// Save data to file
function saveData() {
  try {
    const data = {
      moderatorPoints,
      leaderboardMessageId
    };
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving data:', error);
  }
}

// Initialize or recover leaderboard
async function initializeLeaderboard() {
  const channel = client.channels.cache.get(leaderboardChannelId);
  if (!channel) {
    console.error('Leaderboard channel not found!');
    return;
  }

  try {
    if (leaderboardMessageId) {
      await channel.messages.fetch(leaderboardMessageId);
      await updateLeaderboard();
    } else {
      await createNewLeaderboard();
    }
  } catch (error) {
    console.log('Leaderboard message not found, creating new one...');
    await createNewLeaderboard();
  }
}

// Function to update bot status
function updateBotStatus() {
  try {
    const totalPoints = Object.values(moderatorPoints).reduce((a, b) => a + b, 0);
    const moderatorCount = Object.keys(moderatorPoints).length;
    
    const statusMessages = [
      `Tracking ${moderatorCount} moderators`,
      `${totalPoints} total points`,
      `Leaderboard updates`,
      `musico.xyz`
    ];
    
    const randomStatus = statusMessages[Math.floor(Math.random() * statusMessages.length)];
    
    client.user.setPresence({
      activity: {
        name: randomStatus,
        type: 'WATCHING'
      },
      status: 'online'
    });
    
  } catch (error) {
    console.error('Error updating bot status:', error);
  }
}

// Create the leaderboard embed with optional celebration
function createLeaderboardEmbed(celebration = null) {
  const sortedModerators = Object.entries(moderatorPoints)
    .map(([id, points]) => ({ id, points }))
    .sort((a, b) => b.points - a.points);

  const embed = new Discord.MessageEmbed()
    .setTitle('Moderator Activity Leaderboard')
    .setColor('#0099ff')
    .setDescription('Points are awarded for each message sent in the server')
    .setTimestamp();

  // Add celebration if it exists
  if (celebration) {
    embed.addField('🎉 Milestone Reached! 🎉', celebration, false);
  }

  if (sortedModerators.length > 0) {
    const leaderboardText = sortedModerators.map((mod, index) => {
      return `${index + 1}. <@${mod.id}> - ${mod.points} points`;
    }).join('\n');
    
    embed.addField('Top Moderators', leaderboardText);
  } else {
    embed.addField('No activity yet', 'Moderators will appear here once they start chatting!');
  }

  return embed;
}

// Handle celebrations
async function handleCelebration(message, userId, oldPoints, newPoints) {
  const milestones = [100, 250, 500, 1000, 1500, 2000, 3000, 5000];
  const reachedMilestones = milestones.filter(m => oldPoints < m && newPoints >= m);

  if (reachedMilestones.length > 0) {
    const latestMilestone = Math.max(...reachedMilestones);
    const member = message.member || await message.guild.members.fetch(userId);
    
    // Create celebration message
    let celebrationMessage;
    if (latestMilestone >= 5000) {
      celebrationMessage = `🎊 **LEGENDARY!** ${member} has reached **${latestMilestone} points**! 🏆`;
    } else if (latestMilestone >= 1000) {
      celebrationMessage = `🎉 **EPIC!** ${member} just hit **${latestMilestone} points**! ✨`;
    } else {
      celebrationMessage = `🌟 **Congratulations!** ${member} reached **${latestMilestone} points**!`;
    }

    // Set current celebration
    currentCelebration = celebrationMessage;
    
    // Update leaderboard with celebration
    await updateLeaderboard();
    
    // Set timeout to remove celebration after 1 hour
    setTimeout(() => {
      currentCelebration = null;
      updateLeaderboard().catch(console.error);
    }, 60 * 60 * 1000); // 1 hour

    // Special rewards for big milestones
    if (latestMilestone >= 1000) {
      try {
        const role = message.guild.roles.cache.find(r => r.name === '👑 Mod Of The Month');
        if (role) {
          await member.roles.add(role);
        }
      } catch (error) {
        console.error('Could not add milestone role:', error);
      }
    }
  }
}

// Update existing leaderboard or create new one if needed
async function updateLeaderboard() {
  const channel = client.channels.cache.get(leaderboardChannelId);
  if (!channel) return;

  try {
    if (leaderboardMessageId) {
      const message = await channel.messages.fetch(leaderboardMessageId);
      await message.edit(createLeaderboardEmbed(currentCelebration));
    } else {
      await createNewLeaderboard();
    }
  } catch (error) {
    console.log('Failed to update leaderboard, creating new one...');
    await createNewLeaderboard();
  }
}

// Create a brand new leaderboard message
async function createNewLeaderboard() {
  const channel = client.channels.cache.get(leaderboardChannelId);
  if (!channel) return;

  try {
    if (leaderboardMessageId) {
      try {
        const oldMessage = await channel.messages.fetch(leaderboardMessageId);
        await oldMessage.delete().catch(() => {});
      } catch (error) {}
    }

    const sentMessage = await channel.send(createLeaderboardEmbed(currentCelebration));
    leaderboardMessageId = sentMessage.id;
    saveData();
  } catch (error) {
    console.error('Error creating new leaderboard:', error);
  }
}

// Format uptime to human readable string
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
  
  // Set initial status
  updateBotStatus();
  
  // Update status every 5 minutes
  setInterval(updateBotStatus, 5 * 60 * 1000);
});


client.on('message', async message => {
  // Ignore bot messages and DMs
  if (message.author.bot || !message.guild) return;
  
  // Check for commands
  if (message.content.startsWith('?')) {
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    try {
      // Check basic send permissions first
      if (!message.channel.permissionsFor(message.guild.me).has('SEND_MESSAGES')) {
        console.log(`No permission to send messages in ${message.channel.name}`);
        return;
      }

      switch (command) {
        case 'ping':
          const sent = await message.channel.send('Pinging...');
          const latency = sent.createdTimestamp - message.createdTimestamp;
          await sent.edit(`🏓 Pong! 
          - Bot Latency: ${latency}ms
          - API Latency: ${Math.round(client.ws.ping)}ms`);
          break;

        case 'uptime':
          const uptimeString = formatUptime();
          await message.channel.send(`🕒 Bot Uptime: ${uptimeString}\nStarted at: ${startTime.toUTCString()}`);
          break;

        case 'info':
          // Check embed permissions
          const canEmbed = message.channel.permissionsFor(message.guild.me).has('EMBED_LINKS');
          
          if (canEmbed) {
            const infoEmbed = new Discord.MessageEmbed()
              .setTitle('Moderator Activity Tracker Bot')
              .setColor('#0099ff')
              .setDescription('A bot that tracks moderator activity and displays a leaderboard')
              .addField('Creator', 'Georgio', true)
              .addField('Version', '1.0', true)
              .addField('Commands', '?ping, ?uptime, ?info', false)
              .addField('Total Moderators Tracked', Object.keys(moderatorPoints).length.toString(), true)
              .addField('Total Points Awarded', Object.values(moderatorPoints).reduce((a, b) => a + b, 0).toString(), true)
              .setFooter('musico.xyz')
              .setTimestamp();
            await message.channel.send({ embeds: [infoEmbed] });
          } else {
            // Fallback to simple text message
            const infoText = [
              '**Moderator Activity Tracker Bot**',
              'A bot that tracks moderator activity and displays a leaderboard',
              '',
              '**Creator**: Georgio',
              '**Version**: 1.0',
              '**Commands**: ?ping, ?uptime, ?info',
              `**Total Moderators Tracked**: ${Object.keys(moderatorPoints).length}`,
              `**Total Points Awarded**: ${Object.values(moderatorPoints).reduce((a, b) => a + b, 0)}`,
              '',
              'musico.xyz'
            ].join('\n');
            await message.channel.send(infoText);
          }
          break;

        default:
          // Unknown command
          await message.channel.send(`Unknown command. Try ?ping, ?uptime, or ?info`);
      }
    } catch (error) {
      console.error(`Error processing ${command} command:`, error);
      // Don't try to send error message if we already know we can't send messages
    }
    return;
  }
  
  // Rest of your existing message handling code...
  console.log('Message received from:', message.author.tag);

  try {
    // Get the member (fetch if not in cache)
    const member = message.member || await message.guild.members.fetch(message.author.id);
    
    // Check for moderator role
    const moderatorRole = member.roles.cache.find(role => role.name === 'Moderators');
    console.log('Is moderator:', !!moderatorRole);
    
    if (!moderatorRole) return;

    // Update points
    const userId = message.author.id;
    const oldPoints = moderatorPoints[userId] || 0;
    moderatorPoints[userId] = oldPoints + 1;
    console.log('New points:', moderatorPoints[userId]);
    
    // Save and update
    saveData();
    updateBotStatus();
    
    // Check for milestones
    await handleCelebration(message, userId, oldPoints, moderatorPoints[userId]);
    await updateLeaderboard();
    
  } catch (error) {
    console.error('Error processing message:', error);
  }
});


// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  saveData();
  server.close(() => {
    console.log('Express server closed');
    process.exit(0);
  });
});

client.login(token);