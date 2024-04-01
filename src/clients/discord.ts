import {
  APIEmbed,
  AutocompleteInteraction,
  Client,
  Collection,
  CommandInteraction,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Guild,
  GuildMember,
  Interaction,
  JSONEncodable,
  MessageCreateOptions,
  ModalSubmitInteraction,
  Partials,
  REST,
  RESTPostAPIApplicationCommandsJSONBody,
  Routes,
  SlashCommandBuilder,
  TextBasedChannel,
  codeBlock,
  userMention,
} from "discord.js";
import { isErrorLike, serializeError } from "serialize-error";

import { config } from "../config.js";
import { resolveKoLImage } from "./kol.js";

export type ModalHandler = {
  customId: string;
  handle: (interaction: ModalSubmitInteraction) => Promise<void>;
};

export type InteractionHandler = {
  init: () => Promise<void>;
};

export type CommandHandler = {
  data: SlashCommandBuilder;
  execute: (interaction: CommandInteraction) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
} & Partial<InteractionHandler>;

export class DiscordClient extends Client {
  private clientId: string;
  private alertsQueue: MessageCreateOptions[] = [];
  private alertsChannel: TextBasedChannel | null = null;
  parka: Date | null = null;

  commands = new Collection<string, CommandHandler>();
  modals = new Collection<string, ModalHandler>();

  get guild(): Guild | null {
    return this.guilds.cache.get(config.GUILD_ID) ?? null;
  }

  get member(): GuildMember | null {
    return this.guild?.members.cache.get(this.user?.id ?? "") ?? null;
  }

  constructor(clientId: string, token: string, alertsChannelId: string) {
    super({
      partials: [Partials.Message, Partials.Reaction, Partials.User],
      intents: [
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.clientId = clientId;
    this.token = token;

    this.on(Events.InteractionCreate, async (interaction) =>
      this.handleInteraction(interaction),
    );

    this.on(Events.ClientReady, async (client) => {
      const channel = await client.channels.fetch(alertsChannelId);
      if (!channel?.isTextBased()) return;
      await this.initAlertsChannel(channel);
    });
  }

  async registerApplicationCommands(
    commands: RESTPostAPIApplicationCommandsJSONBody[],
  ) {
    const rest = new REST({ version: "10" }).setToken(this.token || "");
    await rest.put(Routes.applicationCommands(this.clientId), {
      body: commands,
    });
  }

  async handleInteraction(interaction: Interaction) {
    if ("commandName" in interaction) {
      const command = this.commands.get(interaction.commandName);

      if (!command) {
        await this.alert(
          `No command matching ${interaction.commandName} found`,
          interaction,
        );
        if (interaction.isRepliable()) {
          await interaction.reply(
            `Command not recognised. Something has gone wrong here.`,
          );
        }
        return;
      }

      if (
        interaction.isChatInputCommand() ||
        interaction.isContextMenuCommand()
      ) {
        try {
          await command.execute(interaction);
        } catch (error) {
          await this.alert("Recovered from a crash", interaction, error);
          const message =
            "OAF recovered from a crash trying to process that command. This has been logged, but poke in #mafia-and-scripting if it keeps happening.";
          if (interaction.deferred) {
            await interaction.editReply(message);
          } else if (interaction.replied) {
            await interaction.followUp(message);
          } else {
            await interaction.reply(message);
          }
        }
        return;
      }

      if (interaction.isAutocomplete()) {
        try {
          await command.autocomplete?.(interaction);
        } catch (error) {
          await this.alert(
            "Encountered error during autocomplete",
            interaction,
            error,
          );
        }
        return;
      }

      return;
    }
  }

  async initAlertsChannel(channel: TextBasedChannel) {
    this.alertsChannel = channel;
    while (this.alertsQueue.length > 0) {
      const alert = this.alertsQueue.shift();
      if (!alert) break;
      await this.alertsChannel.send(alert);
    }
  }

  async alert(
    description: string,
    interaction?: Interaction,
    error?: Error | unknown,
  ) {
    if (!interaction) {
      console.warn(description);
    } else if (error) {
      console.error(description, error);
    } else {
      console.error(description);
    }

    if (config.DEBUG) {
      console.warn("(Suppressing alerts due to debug mode)");
      return;
    }

    const embeds: JSONEncodable<APIEmbed>[] = [];

    if (interaction) {
      let commandRun = interaction.toString();
      if (commandRun === "[object Object]")
        commandRun = JSON.stringify(interaction);
      embeds.push(
        new EmbedBuilder().setTitle("Circumstances").addFields([
          { name: "Command run", value: commandRun },
          { name: "User", value: userMention(interaction.user.id) },
        ]),
      );
    }

    if (error && isErrorLike(error)) {
      const fields = Object.entries(serializeError(error)).map(([k, v]) => ({
        name: k,
        value: codeBlock(JSON.stringify(v)),
      }));
      embeds.push(new EmbedBuilder().setTitle("Error").addFields(fields));
    }

    const alert = {
      content: description,
      embeds,
      allowedMentions: { users: [] },
    };

    if (!this.alertsChannel) {
      console.warn("Queuing alert as no channel initialised yet");
      this.alertsQueue.push(alert);
      return;
    }

    return this.alertsChannel.send(alert);
  }

  start(): void {
    this.login();
  }
}

const OAF_ICON = resolveKoLImage("/itemimages/oaf.gif");

export const createEmbed = () =>
  new EmbedBuilder().setFooter({
    text: "Problems? Message DocRostov#7004 on discord.",
    iconURL: OAF_ICON,
  });

export const blankEmbed = (description: string) =>
  createEmbed().setDescription(description);

export const discordClient = new DiscordClient(
  config.CLIENT_ID,
  config.DISCORD_TOKEN,
  config.ALERTS_CHANNEL_ID,
);
