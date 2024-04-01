import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  inlineCode,
} from "discord.js";

const ORB_RESPONSES: string[] = [
  "It is certain.",
  "It is decidedly so.",
  "Without a doubt.",
  "Yes - definitely.",
  "You may rely on it.",
  "As I see it, yes.",
  "Most likely.",
  "Outlook good.",
  "Yes.",
  "Signs point to yes.",
  "Reply hazy, try again.",
  "Ask again later.",
  "Better not tell you now.",
  "Cannot predict now.",
  "Concentrate and ask again.",
  "Don't count on it.",
  "My reply is no.",
  "My sources say no.",
  "Outlook not so good.",
  "Very doubtful.",
  "If CDM has a free moment, sure.",
  "Why not?",
  "How am I meant to know?",
  "I guess???",
  "...you realise that this is just a random choice from a list of strings, right?",
  "I have literally no way to tell.",
  "Ping Bobson, he probably knows",
  "Check the wiki, answer's probably in there somewhere.",
  "The wiki has the answer.",
  "The wiki has the answer, but it's wrong.",
  "I've not finished spading the answer to that question yet.",
  "The devs know, go pester them instead of me.",
  "INSUFFICIENT DATA FOR MEANINGFUL ANSWER",
  "THERE IS AS YET INSUFFICIENT DATA FOR A MEANINGFUL ANSWER",
];

export const data = new SlashCommandBuilder()
  .setName("orb")
  .setDescription("Consult my miniature crystal ball.")
  .addStringOption((option) =>
    option
      .setName("asktheorb")
      .setDescription("THE ORB KNOWS ALL")
      .setRequired(false),
  );

export function execute(interaction: ChatInputCommandInteraction) {
  const question = interaction.options.getString("asktheorb");

  interaction.reply({
    content: `${question ? `"${question}", you ask.\n` : ""}${inlineCode(
      "oaf",
    )} gazes into the mini crystal ball. "${
      ORB_RESPONSES[Math.floor(Math.random() * ORB_RESPONSES.length)]
    }", they report.`,
    allowedMentions: {
      parse: [],
    },
  });
}
