import { SlashCommandBuilder } from "@discordjs/builders";
import { CommandInteraction } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("volleyball")
  .setDescription("Find the +stat gain supplied by a volleyball of a given weight.")
  .addIntegerOption((option) =>
    option.setName("weight").setDescription("The weight of the volleyball.").setRequired(true)
  );

export function execute(interaction: CommandInteraction) {
  const weight = interaction.options.getInteger("weight", true);

  if (weight <= 0) {
    interaction.reply({ content: `Please supply a positive volleyball weight.`, ephemeral: true });
    return;
  }

  interaction.reply(`A ${weight}lb volleyball provides +${2 + 0.2 * weight} substats per combat.`);
}
