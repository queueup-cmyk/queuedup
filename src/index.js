
require("dotenv").config();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits
} = require("discord.js");

const db = require("./db");

if (!process.env.DISCORD_TOKEN) {
  console.error("Missing DISCORD_TOKEN. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const MODE_LABELS = {
  casual: "Casual",
  serious: "Serious",
  esports: "Esports",
  community: "Community"
};

const getEvent = id => db.get("SELECT * FROM events WHERE id = ?", [id]);

const getRegistrations = id => db.all(
  "SELECT user_id FROM registrations WHERE event_id = ? ORDER BY joined_at ASC",
  [id]
);

const getWaitlist = id => db.all(
  "SELECT user_id FROM waitlist WHERE event_id = ? ORDER BY joined_at ASC, rowid ASC",
  [id]
);

function makeEventMessage(event, registrations, waitlist = []) {
  const shown = registrations
    .slice(0, 25)
    .map((r, i) => `${i + 1}. <@${r.user_id}>`);

  const waiting = waitlist
    .slice(0, 25)
    .map((r, i) => `${i + 1}. <@${r.user_id}>`);

  const mode = MODE_LABELS[event.mode] || MODE_LABELS.casual;

  const embed = new EmbedBuilder()
    .setColor(0x20c7d9)
    .setTitle(event.title)
    .setDescription(`**Mode:** ${mode}\nRegister below to join this event.`)
    .addFields(
      {
        name: `Players (${Math.min(registrations.length, event.capacity)}/${event.capacity})`,
        value: shown.length
          ? shown.join("\n").slice(0, 1024)
          : "No players registered yet."
      },
      {
        name: `Waitlist (${waitlist.length})`,
        value: waiting.length
          ? waiting.join("\n").slice(0, 1024)
          : "No players on the waitlist."
      },
      {
        name: "Status",
        value: event.status === "open"
          ? "Registration open"
          : "Registration closed",
        inline: true
      }
    )
    .setFooter({ text: `QueueUp event #${event.id}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`queueup:join:${event.id}`)
      .setLabel("Join")
      .setStyle(ButtonStyle.Success)
      .setDisabled(event.status !== "open"),
    new ButtonBuilder()
      .setCustomId(`queueup:leave:${event.id}`)
      .setLabel("Leave")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(event.status !== "open")
  );

  return { embeds: [embed], components: [row] };
}

async function refreshEventMessage(id) {
  const event = getEvent(id);
  if (!event?.message_id) return;

  const channel = await client.channels.fetch(event.channel_id);
  if (!channel?.isTextBased()) return;

  const message = await channel.messages.fetch(event.message_id);
  const registrations = getRegistrations(id);
  const waitlist = getWaitlist(id);

  await message.edit(makeEventMessage(event, registrations, waitlist));
}

client.once(Events.ClientReady, c => {
  console.log(`QueueUp is online as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "ping") {
        await interaction.reply({
          content: "QueueUp is online.",
          ephemeral: true
        });
        return;
      }

      if (interaction.commandName === "event-create") {
        if (!interaction.inGuild()) {
          await interaction.reply({
            content: "Create events inside a server.",
            ephemeral: true
          });
          return;
        }

        const perms = interaction.memberPermissions;

        if (
          !perms?.has(PermissionFlagsBits.ManageEvents) &&
          !perms?.has(PermissionFlagsBits.ManageGuild)
        ) {
          await interaction.reply({
            content: "You need Manage Events or Manage Server permission.",
            ephemeral: true
          });
          return;
        }

        const title = interaction.options.getString("title", true).trim();
        const capacity = interaction.options.getInteger("capacity", true);
        const mode = interaction.options.getString("mode") || "casual";

        const result = db.run(
          `INSERT INTO events
            (guild_id, channel_id, title, capacity, created_by, mode)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            interaction.guildId,
            interaction.channelId,
            title,
            capacity,
            interaction.user.id,
            mode
          ]
        );

        const id = Number(result.lastInsertRowid);
        const event = getEvent(id);
        const message = await interaction.channel.send(
          makeEventMessage(event, [], [])
        );

        db.run(
          "UPDATE events SET message_id = ? WHERE id = ?",
          [message.id, id]
        );

        await interaction.reply({
          content: `Event created: ${message.url}`,
          ephemeral: true
        });
        return;
      }
    }

    if (
      interaction.isButton() &&
      interaction.customId.startsWith("queueup:")
    ) {
      const [, action, rawId] = interaction.customId.split(":");
      const id = Number(rawId);
      const event = getEvent(id);

      if (!event || event.guild_id !== interaction.guildId) {
        await interaction.reply({
          content: "This event could not be found.",
          ephemeral: true
        });
        return;
      }

      if (event.status !== "open") {
        await interaction.reply({
          content: "Registration is closed.",
          ephemeral: true
        });
        return;
      }

      if (action === "join") {
        const registered = db.get(
          "SELECT 1 AS found FROM registrations WHERE event_id = ? AND user_id = ?",
          [id, interaction.user.id]
        );

        const waiting = db.get(
          "SELECT 1 AS found FROM waitlist WHERE event_id = ? AND user_id = ?",
          [id, interaction.user.id]
        );

        if (registered || waiting) {
          await interaction.reply({
            content: registered
              ? "You're already registered."
              : "You're already on the waitlist.",
            ephemeral: true
          });
          return;
        }

        const count = db.get(
          "SELECT COUNT(*) AS count FROM registrations WHERE event_id = ?",
          [id]
        ).count;

        if (count >= event.capacity) {
          db.run(
            "INSERT INTO waitlist (event_id, user_id) VALUES (?, ?)",
            [id, interaction.user.id]
          );

          await interaction.reply({
            content: "The event is full, so you've been added to the waitlist.",
            ephemeral: true
          });
        } else {
          db.run(
            "INSERT INTO registrations (event_id, user_id) VALUES (?, ?)",
            [id, interaction.user.id]
          );

          await interaction.reply({
            content: "You're registered. Good luck!",
            ephemeral: true
          });
        }
      } else if (action === "leave") {
        const result = db.run(
          "DELETE FROM registrations WHERE event_id = ? AND user_id = ?",
          [id, interaction.user.id]
        );

        if (result.changes) {
          const next = db.get(
            `SELECT user_id FROM waitlist
             WHERE event_id = ?
             ORDER BY joined_at ASC, rowid ASC
             LIMIT 1`,
            [id]
          );

          if (next) {
            db.run(
              "DELETE FROM waitlist WHERE event_id = ? AND user_id = ?",
              [id, next.user_id]
            );

            db.run(
              "INSERT INTO registrations (event_id, user_id) VALUES (?, ?)",
              [id, next.user_id]
            );
          }

          await interaction.reply({
            content: next
              ? "You've left the event. The next player on the waitlist has been promoted."
              : "You've left the event.",
            ephemeral: true
          });
        } else {
          const waiting = db.run(
            "DELETE FROM waitlist WHERE event_id = ? AND user_id = ?",
            [id, interaction.user.id]
          );

          await interaction.reply({
            content: waiting.changes
              ? "You've been removed from the waitlist."
              : "You weren't registered or waitlisted.",
            ephemeral: true
          });
        }
      }

      await refreshEventMessage(id);
    }
  } catch (error) {
    console.error("Interaction failed:", error);

    if (
      interaction.isRepliable() &&
      !interaction.replied &&
      !interaction.deferred
    ) {
      await interaction.reply({
        content: "Something went wrong. Please try again.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

db.initDb()
  .then(() => client.login(process.env.DISCORD_TOKEN))
  .catch(error => {
    console.error("Could not initialise database:", error);
    process.exit(1);
  });
