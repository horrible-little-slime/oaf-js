import { SlashCommandBuilder } from "@discordjs/builders";
import { CommandInteraction } from "discord.js";

import { toWeight } from "../../utils";

export const data = new SlashCommandBuilder()
  .setName("reversefairy")
  .setDescription("Find the weight necessary to supply a given item drop % from a fairy.")
  .addNumberOption((option) =>
    option
      .setName("itemdrop")
      .setDescription("The item drop % you are looking to get from your fairy.")
      .setRequired(true)
  );

export function execute(interaction: CommandInteraction): void {
  const itemDrop = interaction.options.getNumber("itemdrop", true);
  if (itemDrop <= 0) {
    interaction.reply({ content: "Please supply a positive item drop value.", ephemeral: true });
    return;
  }

  interaction.reply(
    `To get ${itemDrop}% item drop from a fairy, ` +
      `it should be weigh at least ${toWeight(itemDrop).toFixed(1)} lbs, ` +
      `or be a Jumpsuited Hounddog that weighs at least ${toWeight(itemDrop, 1.25).toFixed(1)} lbs.`
  );
}
