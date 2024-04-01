import { Events, ThreadAutoArchiveDuration, blockQuote } from "discord.js";
import { dedent } from "ts-dedent";

import { discordClient } from "../../clients/discord.js";
import { KoLMessage, kolClient } from "../../clients/kol.js";
import { config } from "../../config.js";

function isAnnouncement(message: KoLMessage) {
  return !/^(The system will go down for nightly maintenance in \d+ minutes?|Rollover is over).$/.test(
    message.msg,
  );
}

function listenForAnnouncements() {
  kolClient.on("system", async (systemMessage) => {
    if (!isAnnouncement(systemMessage)) return;

    const guild = await discordClient.guilds.fetch(config.GUILD_ID);
    const announcementChannel = guild?.channels.cache.get(
      config.ANNOUNCEMENTS_CHANNEL_ID,
    );

    if (!announcementChannel?.isTextBased()) {
      await discordClient.alert("No valid announcement channel");
      return;
    }

    const message = await announcementChannel.send({
      content: dedent`
        New announcement posted to KoL chat!
        ${blockQuote(systemMessage.msg)}
      `,
    });

    await message.startThread({
      name: `Discussion for announcement`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    });
  });
}

export async function init() {
  discordClient.on(Events.ClientReady, listenForAnnouncements);
}
