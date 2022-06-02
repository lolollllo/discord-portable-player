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
