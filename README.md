# Discord Portable Player
Complete framework to facilitate music commands using **[discord.js](https://discord.js.org)**.

[![downloadsBadge](https://img.shields.io/npm/dt/discord-portable-player?style=for-the-badge)](https://npmjs.com/discord-portable-player)
[![versionBadge](https://img.shields.io/npm/v/discord-portable-player?style=for-the-badge)](https://npmjs.com/discord-portable-player)
[![CodeFactor](https://www.codefactor.io/repository/github/lolollllo/discord-portable-player/badge/)](https://www.codefactor.io/repository/github/lolollllo/discord-portable-player/overview/)

## Installation

### Install **[discord-portable-player](https://npmjs.com/package/discord-portable-player)**

```sh
$ npm install --save discord-portable-player
```

### Install **[@discordjs/opus](https://npmjs.com/package/@discordjs/opus)**

```sh
$ npm install --save @discordjs/opus
```

### Install FFmpeg or Avconv
- Official FFMPEG Website: **[https://www.ffmpeg.org/download.html](https://www.ffmpeg.org/download.html)**

- Node Module (FFMPEG): **[https://npmjs.com/package/ffmpeg-static](https://npmjs.com/package/ffmpeg-static)**

- Avconv: **[https://libav.org/download](https://libav.org/download)**

# Features
- Simple & easy to use 
- Beginner friendly
- Audio filters 
- Lightweight 
- Custom extractors support 
- Multiple sources support 
- Play in multiple servers at the same time 
- Does not inject anything to discord.js or your discord.js client 
- Allows you to have full control over what is going to be streamed 

**[Documentation](https://discord-portable-player.js.org)**

## Getting Started

First of all, you will need to register slash commands:

```js
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v9");

const commands = [{
    name: "play",
    description: "Plays a song!",
    options: [
        {
            name: "query",
            type: "STRING",
            description: "The song you want to play",
            required: true
        }
    ]
}]; 

const rest = new REST({ version: "9" }).setToken(process.env.token);

(async () => {
  try {
    console.log("Started refreshing application [/] commands.");

    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands },
    );

    console.log("Successfully reloaded application [/] commands.");
  } catch (error) {
    console.error(error);
  }
})();
```

Now you can implement your bot's logic:

```js
const { Client, Intents } = require("discord.js");
const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_VOICE_STATES]});
const { Player } = require("discord-portable-player");

// Create a new Player (you don't need any API Key)
const player = new Player(client);

client.once("ready", () => {
    console.log("I'm ready !");
});

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isCommand()) return;

    // /play track:Despacito
    // will play "Despacito" in the voice channel
    if (interaction.commandName === "play") {
        if (!interaction.member.voice.channelId) return await interaction.reply({ content: "You are not in a voice channel!", ephemeral: true });
        if (interaction.guild.me.voice.channelId && interaction.member.voice.channelId !== interaction.guild.me.voice.channelId) return await interaction.reply({ content: "You are not in my voice channel!", ephemeral: true });
        const query = interaction.options.get("query").value;
        const queue = player.createQueue(interaction.guild, {
            metadata: {
                channel: interaction.channel
            }
        });
        
        // verify vc connection
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
        if (!track) return await interaction.followUp({ content: `❌ | Track **${query}** not found!` });

        queue.play(track);

        return await interaction.followUp({ content: `⏱️ | Loading track **${track.title}**!` });
    }
});

// add the trackStart event so when a song will be played this message will be sent
player.on("trackStart", (queue, track) => queue.metadata.send(`🎶 | Now playing **${track.title}**!`))

client.login(process.env.token);
```

## Supported websites

By default, discord-portable-player supports **YouTube**, **Spotify** and **SoundCloud** streams only.

### Optional dependencies

Discord Portable Player will be providing additional packages soon!

## Advanced

### Use cookies

```js
const { Player } = require("discord-portable-player");

const player = new Player(client, {
    ytdlOptions: {
        requestOptions: {
            headers: {
                cookie: "YOUR_YOUTUBE_COOKIE"
            }
        }
    }
});
```

### Use custom proxies

```js
const HttpsProxyAgent = require("https-proxy-agent");
const { Player } = require("discord-portable-player");

// Remove "user:pass@" if you don't need to authenticate to your proxy.
const proxy = "http://user:pass@111.111.111.111:8080";
const agent = HttpsProxyAgent(proxy);

const player = new Player(client, {
    ytdlOptions: {
        requestOptions: { agent }
    }
});
```

> You may also create a simple proxy server and forward requests through it.
> See **[https://github.com/http-party/node-http-proxy](https://github.com/http-party/node-http-proxy)** for more info.

### Custom stream Engine

Discord Portable Player by default uses **[node-ytdl-core](https://github.com/fent/node-ytdl-core)** for youtube and some other extractors for other sources.
If you need to modify this behavior without touching extractors, you need to use `createStream` functionality of discord player.
Here's an example on how you can use **[play-dl](https://npmjs.com/package/play-dl)** to download youtube streams instead of using ytdl-core.

```js
const playdl = require("play-dl");

// other code
const queue = player.createQueue(..., {
    ...,
    async onBeforeCreateStream(track, source, _queue) {
        // only trap youtube source
        if (source === "youtube") {
            // track here would be youtube track
            return (await playdl.stream(track.url, { discordPlayerCompatibility : true })).stream;
            // we must return readable stream or void (returning void means telling discord-player to look for default extractor)
        }
    }
});
```

`<Queue>.onBeforeCreateStream` is called before actually downloading the stream. It is a different concept from extractors, where you are **just** downloading
streams. `source` here will be a video source. Streams from `onBeforeCreateStream` are then piped to `FFmpeg` and finally sent to Discord voice servers.
