# BREAKING CHANGES

## Slash Commands

> Discord announced that they will be making the [`MESSAGE_CONTENT`](https://support-dev.discord.com/hc/en-us/articles/4404772028055) intent a privilleged intent in August 30. Bots are required to move from `TEXT COMMANDS` to `SLASH_COMMANDS`. 

### Examples
```diff
- const queue = player.createQueue(message.guild);
+ const queue = player.createQueue(interaction.guild);

const song = await player.search(query, {
-   requestedBy: message.author
+   requestedBy: interaction.user
});

 try {
-   await queue.connect(message.member.voice.channel);
+   await queue.connect(interaction.member.voice.channel);
 } catch {
-   message.reply("Could not join your voice channel");
+   interaction.reply({ content: "Could not join your voice channel", ephemeral: true })
}
//Make sure you have the GUILD_VOICE_STATES intent!

queue.addTrack(song.tracks[0]);
queue.play();
```
