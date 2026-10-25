
require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
  console.error(
    "Missing DISCORD_TOKEN, DISCORD_CLIENT_ID, or DISCORD_GUILD_ID in .env"
  );
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check whether QueueUp is responding."),

  new SlashCommandBuilder()
    .setName("event-create")
    .setDescription("Create an event with player signups.")
    .addStringOption(option =>
      option
        .setName("title")
        .setDescription("Event name")
        .setRequired(true)
        .setMaxLength(100)
    )
    .addIntegerOption(option =>
      option
        .setName("capacity")
        .setDescription("Maximum players (2–200)")
        .setRequired(true)
        .setMinValue(2)
        .setMaxValue(200)
    )
    .addStringOption(option =>
      option
        .setName("mode")
        .setDescription("Choose the type of event")
        .setRequired(false)
        .addChoices(
          { name: "Casual", value: "casual" },
          { name: "Serious", value: "serious" },
          { name: "Esports", value: "esports" },
          { name: "Community", value: "community" }
        )
    )
].map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log("Registering QueueUp commands to the test server...");

    await rest.put(
      Routes.applicationGuildCommands(
        DISCORD_CLIENT_ID,
        DISCORD_GUILD_ID
      ),
      { body: commands }
    );

    console.log("Commands registered.");
  } catch (error) {
    console.error("Could not register commands:", error);
    process.exitCode = 1;
  }
})();
