# Discord Portable Player
Complete framework to facilitate music commands using [discord.js](https://discord.js.org).

[![downloadsBadge](https://img.shields.io/npm/dt/discord-portable-player?style=for-the-badge)](https://npmjs.com/discord-portable-player)
[![versionBadge](https://img.shields.io/npm/v/discord-portable-player?style=for-the-badge)](https://npmjs.com/discord-portable-player)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

## Installation

### Install [discord-portable-player](https://npmjs.com/package/discord-portable-player)

```sh
$ npm install --save discord-portable-player
```

### Install [@discordjs/opus](https://npmjs.com/package/@discordjs/opus)

```sh
$ npm install --save @discordjs/opus
```

### Install FFmpeg or Avconv
- FFMPEG Website: [https://www.ffmpeg.org/download.html](https://www.ffmpeg.org/download.html)
- FFMPEG: [https://npmjs.com/package/ffmpeg](https://npmjs.com/package/ffmpeg)
- Avconv: [https://libav.org/download](https://libav.org/download)

# Features
A simple & easy to use, beginner friendly package with amazing features such as Audio filters, Custom extractor support & many more!

**[Documentation](https://discord-portable-player.js.org)**

## Getting Started

First of all, you will need to register slash commands:

```js
const { token, clientId } = require('./config.json');
const { Routes, REST, SlashCommandBuilder } = require('discord.js');

const commands = [
    new SlashCommandBuilder().setName('play').setDescription('play a song').addStringOption(option => option.setName('query').setDescription('The query to search for').setRequired(true))
].map(command => command.toJSON());
	
    
const rest = new REST({ version: '10' }).setToken(token);
(async () => {
  try {
    console.log('Started refreshing application [/] commands.');
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands },
    );
    console.log('Successfully reloaded application [/] commands.');
  } catch (error) {
    console.error(error);
  }
})();
```

Now you can implement your bot's logic:

```js
const { Client, GatewayIntentBits } = require("discord.js");
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates]});
const { token } = require('./config.json');
const { Player } = require("discord-portable-player");
// Create a new Player (you don't need any API Key)
const player = new Player(client);
client.once("ready", () => {
    console.log("I'm ready !");
});
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    // /play track: Marshmello - Together
    if (interaction.commandName === "play") {
        if (!interaction.member.voice.channel) return await interaction.reply({ content: "You are not in a voice channel!", ephemeral: true });
        if (interaction.guild.members.me.voice.channel && interaction.member.voice.channel !== interaction.guild.members.me.voice.channel) return await interaction.reply({ content: "You are not in my voice channel!", ephemeral: true });
        const query = interaction.options.getString("query")
        const queue = player.createGuildQueue({
            metadata: interaction.channel,
	    guild: interaction.guild
        });
        
        // Verifies the voice channel
        try {
            if (!queue.connection) await queue.connect(interaction.member.voice.channel);
        } catch {
            queue.destroy();
            return await interaction.reply({ content: "Could not join your voice channel!", ephemeral: true });
        }
        await interaction.deferReply();
        const track = await player.search(query, {
            requestedBy: interaction.user
        }).then(x => x.tracks[0]);
        if (!track) return await interaction.followUp({ content: `**${query}** not found!` });
        queue.play(track);
        return await interaction.followUp({ content: `Loading track **${track.title}**!` });
    }
});
// add the trackStart event so when a song will be played this message will be sent
player.on("trackStart", (queue, track) => queue.metadata.send(`🎶 | Now playing **${track.title}**!`))
client.login(token);
```

## Supported Sources

By default, discord-portable-player supports:
- [YouTube](https://www.youtube.com/)
- [Spotify](http://spotify.com)
- [Apple Music](https://www.apple.com/apple-music/)
- [SoundCloud](https://soundcloud.com/)
