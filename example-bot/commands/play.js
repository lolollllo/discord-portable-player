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
