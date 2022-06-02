# Examples

## Creating your bot!
The **basic** code required to power your bot with commands and a player! You can find the source of the code [here](https://github.com/lolollllo/discord-portable-player/blob/main/example-bot/index.js)!

```js
const { Client, Collection, Intents } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { Player } = require('discord-portable-player');
const { token, guildId, clientId } = require('./config.json');
const fs = require('node:fs');

//creating your client
const client = new Client({ intents: [
     Intents.FLAGS.GUILDS,
     Intents.FLAGS.GUILD_MEMBERS,
     Intents.FLAGS.GUILD_VOICE_STATES
]})

//creating your player
const player = new Player(client, {
  ytdlOptions: {
    quality: "highestaudio",
    highWaterMark: 1 << 25,
  },
});

client.once('ready', () => console.log(`[READY] Logged in as ${client.user.tag} [READY]`))

//https://discordjs.guide/creating-your-bot/command-handling.html#individual-command-files
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
const commands = [];

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);

  client.commands.set(command.data.name, command)
  commands.push(command.data.toJSON());
}

//https://discordjs.guide/interactions/slash-commands.html#registering-slash-commands
const rest = new REST({ version: '9' }).setToken(token);

(async () => {
	try {
		console.log('Started refreshing application (/) commands.');

		await rest.put(
			Routes.applicationGuildCommands(clientId, guildId), //use applicationCommands(clientId) to use global commands
			{ body: commands },
		);

		console.log('Successfully reloaded application (/) commands.');
	} catch (error) {
		console.error(error);
	}
})();

//https://discordjs.guide/interactions/slash-commands.html#replying-to-slash-commands
client.on('interactionCreate', async interaction => {
	if (!interaction.isCommand()) return;
    
	const command = client.commands.get(interaction.commandName);

	if (!command) return;

	try {
    await interaction.deferReply()
		await command.execute(interaction);
	} catch (error) {
		console.error(error);
		await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
	}
});

client.login(token);
```

## Creating a simple Play command!
Alright, it may feel like its gonna be very hard to do achieve this, but if you know a decent amount of javascript and read the guide, it may be easier than you think! You can find the source of the code [here](https://github.com/lolollllo/discord-portable-player/blob/main/example-bot/commands/play.js)!

```js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { QueryType } = require('discord-portable-player');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('play')
		.setDescription('plays a song!')
	  .addStringOption(option =>
		option.setName('query')
			.setDescription('The search query')
			.setRequired(true)),
	async execute(interaction) {
		const query = interaction.options.getString('query');
    
    if (!interaction.member.voice.channel) return interaction.followUp({ content: "Please join a voice channel first!" })
    
    let result = await player.search(query, {
        requestedBy: interaction.user,
        searchEngine: QueryType.AUTO,
      });
    
    let queue = player.createQueue(interaction.guildId, {
        metadata: interaction.channel
        //leaveOnEmpty: false (uncomment this if you want the bot to stay in vc when the channel is empty)
      });
    
    if (!queue.connection) await queue.connect(interaction.member.voice.channel);
    result.playlist ? queue.addTracks(result.tracks): queue.addTrack(result.tracks[0]);
    
    if (!queue.playing) await queue.play();
    
    return interaction.followUp(`Starting to play ${result.tracks[0] || result.tracks}`)
	},
};
```
