# Migrating to Discord Portable Player v2

v2 requires Node 16.9 or higher to use as it uses **discord.js v14**, so make sure you're up to date. To check your Node version, use `node -v` in your terminal or command prompt, and if it's not high enough, update it! There are many [resources](https://phoenixnap.com/kb/update-node-js-version) online to help you with this step based on your host system.

Please note that, Discord Portable Player v2 brings breaking changes, so your old code might not work with version 2.

### Install discord-portable-player (VERSION 2!) 🎊

#### NPM (Node Package Manager)

```console
npm rm discord-portable-player
npm install discord-portable-player@latest
```

#### Yarn

```console
yarn remove discord-portable-player
yarn add discord-portable-player
```

## Breaking Changes

### Common Breakages

#### Queue
- Methods to creating queues, getting queues & deleting queues have been renamed! These changes were brought to make it less confusing by adding the word `guild` to the methods!

```diff
//creating queues
- <player>.createQueue(interaction.guildId)
+ <player>.createGuildQueue(interaction.guildId)

//finding queues
- <player>.getQueue(interaction.guildId)
+ <player>.getGuildQueue(interaction.guildId)

//deleting queues
- <player>.deleteQueue(interaction.guildId)
+ <player>.deleteGuildQueue(interaction.guildId)
```

#### Query Types
- Previously the QueryTypes were in SCREAMING_SNAKE_CASE this was kind of useless and they have been changed to CamelCase.

```diff
//YouTube Video
- QueryType.YOUTUBE_VIDEO
+ QueryType.YouTubeVideo
```

#### Repeat Mode
- `setRepeatMode()` was renamed to `setLoop()`

```diff
- <Queue>.setRepeatMode()
+ <Queue>.setLoop()
