import { DOMParser } from "@xmldom/xmldom";
import { Mutex } from "async-mutex";
import axios, { HttpStatusCode } from "axios";
import { parse as parseDate } from "date-fns";
import { bold, hyperlink } from "discord.js";
import { decode } from "html-entities";
import { imageSize } from "image-size";
import { parse as parseHtml } from "node-html-parser";
import { EventEmitter } from "node:events";
import { stringify } from "querystring";
import { dedent } from "ts-dedent";
import TypedEventEmitter, { EventMap } from "typed-emitter";
import xpath, { select } from "xpath";

import { config } from "../config.js";
import { cleanString, indent, toWikiLink } from "../utils.js";

const selectMulti = (expression: string, node: Node) => {
  const selection = select(expression, node);
  if (Array.isArray(selection)) return selection;
  return selection instanceof Node ? [selection] : [];
};

type TypedEmitter<T extends EventMap> = TypedEventEmitter.default<T>;

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

const parser = new DOMParser({
  locator: {},
  errorHandler: {
    warning: noop,
    error: noop,
    fatalError: console.error,
  },
});

function parsePlayerDate(input?: string) {
  if (!input) return undefined;
  return parseDate(input, "MMMM dd, yyyy", new Date());
}

type MallPrice = {
  formattedMallPrice: string;
  formattedLimitedMallPrice: string;
  formattedMinPrice: string;
  mallPrice: number;
  limitedMallPrice: number;
  minPrice: number | null;
};

type KoLCredentials = {
  sessionCookies?: string;
  pwdhash?: string;
};

type KoLUser = {
  name: string;
  id: number;
};

type KoLChatMessage = {
  who?: KoLUser;
  type?: string;
  msg?: string;
  link?: string;
  channel?: string;
  time: string;
};

type KoLMessageType = "private" | "system" | "public" | "kmail";

const isValidMessage = (
  msg: KoLChatMessage,
): msg is KoLChatMessage & {
  type: KoLMessageType;
  who: KoLUser;
  msg: string;
} => msg.who !== undefined && msg.msg !== undefined;

type KoLKmail = {
  id: string;
  type: string;
  fromid: string;
  fromname: string;
  azunixtime: string;
  message: string;
  localtime: string;
};

export type LeaderboardInfo = {
  name: string;
  boards: SubboardInfo[];
};

export type SubboardInfo = {
  name: string;
  runs: RunInfo[];
  updated: Date | null;
};

type RunInfo = {
  player: string;
  days: string;
  turns: string;
};

type PartialPlayer = {
  id: number;
  name: string;
  level: number;
  class: string;
};

interface FullPlayer extends PartialPlayer {
  avatar: string;
  ascensions: number;
  trophies: number;
  tattoos: number;
  favoriteFood?: string;
  favoriteBooze?: string;
  createdDate?: Date;
  lastLogin?: Date;
  hasDisplayCase: boolean;
}

function sanitiseBlueText(blueText: string | undefined): string {
  if (!blueText) return "";
  return decode(
    blueText
      .replace(/\r/g, "")
      .replace(/\r/g, "")
      .replace(/(<p><\/p>)|(<br>)|(<Br>)|(<br \/>)|(<Br \/>)/g, "\n")
      .replace(/<[^<>]+>/g, "")
      .replace(/(\n+)/g, "\n")
      .replace(/(\n)+$/, ""),
  ).trim();
}

export function resolveKoLImage(path: string) {
  if (!/^https?:\/\//i.test(path))
    return (
      "https://s3.amazonaws.com/images.kingdomofloathing.com" +
      path.replace(/^\/(iii|images)/, "")
    );
  return path;
}

export type KoLMessage = {
  type: KoLMessageType;
  who: KoLUser;
  msg: string;
  time: Date;
  channel?: string;
};

type Events = {
  kmail: (message: KoLMessage) => void;
  whisper: (message: KoLMessage) => void;
  system: (message: KoLMessage) => void;
  public: (message: KoLMessage) => void;
  rollover: () => void;
};

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class KoLClient extends (EventEmitter as new () => TypedEmitter<Events>) {
  actionMutex = new Mutex();
  static loginMutex = new Mutex();
  mockLoggedIn = false;

  private isRollover = false;
  private loginParameters: URLSearchParams;
  private credentials: KoLCredentials = {};
  private postRolloverLatch = false;

  constructor(username: string, password: string) {
    super();
    this.loginParameters = new URLSearchParams();
    this.loginParameters.append("loggingin", "Yup.");
    this.loginParameters.append("loginname", username);
    this.loginParameters.append("password", password);
    this.loginParameters.append("secure", "0");
    this.loginParameters.append("submitbutton", "Log In");

    this.on("whisper", (whisper) => {
      console.log(
        whisper.time.toLocaleTimeString(),
        whisper.who.name,
        "said",
        `"${whisper.msg}"`,
        "in KoL chat",
      );
    });

    this.on("kmail", (kmail) => {
      console.log(
        kmail.time.toLocaleTimeString(),
        kmail.who.name,
        "said",
        `"${kmail.msg}"`,
        "in a kmail",
      );
    });
  }

  async loggedIn(): Promise<boolean> {
    if (this.mockLoggedIn) return true;
    if (!this.credentials) return false;
    try {
      const apiResponse = await axios(
        "https://www.kingdomofloathing.com/api.php",
        {
          maxRedirects: 0,
          withCredentials: true,
          headers: {
            cookie: this.credentials?.sessionCookies || "",
          },
          params: {
            what: "status",
            for: `${this.loginParameters.get("loginname")} Chatbot`,
          },
          validateStatus: (status) =>
            status === HttpStatusCode.Found || status === HttpStatusCode.Ok,
        },
      );
      return apiResponse.status === HttpStatusCode.Ok;
    } catch {
      console.warn("Login check failed, returning false to be safe.");
      return false;
    }
  }

  async logIn(): Promise<boolean> {
    return KoLClient.loginMutex.runExclusive(async () => {
      if (await this.loggedIn()) return true;
      if (this.isRollover) return false;
      console.log(
        `Not logged in. Logging in as ${this.loginParameters.get("loginname")}`,
      );
      try {
        const loginResponse = await axios(
          "https://www.kingdomofloathing.com/login.php",
          {
            method: "POST",
            data: this.loginParameters,
            maxRedirects: 0,
            validateStatus: (status) => status === HttpStatusCode.Found,
          },
        );
        const sessionCookies = (loginResponse.headers["set-cookie"] || [])
          .map((cookie: string) => cookie.split(";")[0])
          .join("; ");
        const apiResponse = await axios(
          "https://www.kingdomofloathing.com/api.php",
          {
            withCredentials: true,
            headers: {
              cookie: sessionCookies,
            },
            params: {
              what: "status",
              for: `${this.loginParameters.get("loginname")} Chatbot`,
            },
          },
        );
        this.credentials = {
          sessionCookies: sessionCookies,
          pwdhash: apiResponse.data.pwd,
        };
        if (this.postRolloverLatch) {
          this.postRolloverLatch = false;
          this.emit("rollover");
        }
        return true;
      } catch {
        console.log("Login failed. Checking if it's because of rollover.");
        await this.rolloverCheck();
        return false;
      }
    });
  }

  private chatBotStarted = false;

  async startChatBot() {
    if (this.chatBotStarted) return;
    await this.useChatMacro("/join talkie");
    this.loopChatBot();
    this.chatBotStarted = true;
  }

  private async loopChatBot() {
    await Promise.all([this.checkMessages(), this.checkKmails()]);
    await wait(3000);
    await this.loopChatBot();
  }

  private lastFetchedMessages = "0";

  async checkMessages() {
    const newChatMessagesResponse = await this.visitApi<{
      last: string;
      msgs: KoLChatMessage[];
    }>("newchatmessages.php", {
      j: 1,
      lasttime: this.lastFetchedMessages,
    });

    if (!newChatMessagesResponse || typeof newChatMessagesResponse !== "object")
      return;

    this.lastFetchedMessages = newChatMessagesResponse["last"];

    newChatMessagesResponse["msgs"]
      .filter(isValidMessage)
      .map((msg) => ({
        type: msg.type,
        who: {
          id: Number(msg.who.id),
          name: msg.who.name,
        },
        msg: msg.msg,
        time: new Date(Number(msg.time) * 1000),
      }))
      .forEach((message) => {
        switch (message.type) {
          case "public":
            return void this.emit("public", message);
          case "private":
            return void this.emit("whisper", message);
          case "system":
            return void this.emit("system", message);
        }
      });
  }

  async checkKmails() {
    const newKmailsResponse = await this.visitApi<KoLKmail[]>("api.php", {
      what: "kmail",
      for: `${this.loginParameters.get("loginname")} Chatbot`,
    });

    if (!Array.isArray(newKmailsResponse) || newKmailsResponse.length === 0)
      return;

    const newKmails = newKmailsResponse.map((msg: KoLKmail) => ({
      type: "kmail" as const,
      who: {
        id: Number(msg.fromid),
        name: msg.fromname,
      },
      msg: msg.message,
      time: new Date(Number(msg.azunixtime) * 1000),
    }));

    const data = {
      the_action: "delete",
      pwd: this.credentials?.pwdhash,
      box: "Inbox",
      ...Object.fromEntries(
        newKmailsResponse.map(({ id }) => [`sel${id}`, "on"]),
      ),
    };

    await this.visitUrl("messages.php", {}, data);

    newKmails.forEach((m) => this.emit("kmail", m));
  }

  async sendChat(message: string) {
    return await this.visitApi<{ output: string; msgs: string[] }>(
      "submitnewchat.php",
      {
        graf: message,
        j: 1,
      },
    );
  }

  async useChatMacro(macro: string) {
    return await this.sendChat(`/clan ${macro}`);
  }

  async isOnline(playerIdentifier: string | number) {
    const response = await this.useChatMacro(`/whois ${playerIdentifier}`);
    return response?.output.includes("This player is currently online");
  }

  async whisper(recipientId: number, message: string) {
    await this.useChatMacro(`/w ${recipientId} ${message}`);
  }

  async kmail(recipientId: number, message: string) {
    await this.visitUrl("sendmessage.php", {
      action: "send",
      j: 1,
      towho: recipientId,
      contact: 0,
      message: message,
      howmany1: 1,
      whichitem1: 0,
      sendmeat: 0,
    });
  }

  async rolloverCheck() {
    try {
      const isRollover =
        /The system is currently down for nightly maintenance/.test(
          (await axios("https://www.kingdomofloathing.com/")).data,
        );
      if (this.isRollover && !isRollover) {
        this.postRolloverLatch = true;
      }
      this.isRollover = isRollover;
      if (this.isRollover) {
        console.log(
          "Rollover appears to be in progress. Checking again in one minute.",
        );
        setTimeout(() => this.rolloverCheck(), 60000);
      }
    } catch (error) {
      if (error) console.log(error.toString(), " error during rollover check");
    }
  }

  async visitApi<T = object>(
    url: string,
    parameters: Record<string, string | number | undefined> = {},
    data: Record<string, string | number | undefined> | undefined = undefined,
    pwd = true,
  ): Promise<T | null> {
    return (await this.visitUrl(
      url,
      parameters,
      data,
      pwd,
      null as unknown as string,
    )) as unknown as T;
  }

  async visitUrl(
    url: string,
    parameters: Record<string, string | number | undefined> = {},
    data: Record<string, string | number | undefined> | undefined = undefined,
    pwd = true,
    fallback = "",
  ): Promise<string> {
    if (this.isRollover || !(await this.logIn())) return fallback;
    try {
      const page = await axios(`https://www.kingdomofloathing.com/${url}`, {
        method: "POST",
        withCredentials: true,
        headers: {
          cookie: this.credentials?.sessionCookies || "",
        },
        params: {
          ...parameters,
          ...(pwd ? { pwd: this.credentials?.pwdhash } : {}),
        },
        ...(data
          ? {
              data: stringify(data),
            }
          : {}),
      });
      if (
        config.DEBUG &&
        ["api.php", "newchatmessages.php"].every((s) => !url.startsWith(s))
      ) {
        console.log(url, parameters);
        console.log(page.data);
      }
      return page.data;
    } catch {
      return fallback;
    }
  }

  async getMallPrice(itemId: number): Promise<MallPrice> {
    const prices = await this.visitUrl("backoffice.php", {
      action: "prices",
      ajax: 1,
      iid: itemId,
    });
    const unlimitedMatch = prices.match(
      /<td>unlimited:<\/td><td><b>(?<unlimitedPrice>[\d,]+)/,
    );
    const limitedMatch = prices.match(
      /<td>limited:<\/td><td><b>(?<limitedPrice>[\d,]+)/,
    );
    const unlimitedPrice = unlimitedMatch
      ? parseInt(unlimitedMatch[1].replace(/,/g, ""))
      : 0;
    const limitedPrice = limitedMatch
      ? parseInt(limitedMatch[1].replace(/,/g, ""))
      : 0;
    let minPrice = limitedMatch ? limitedPrice : null;
    minPrice = unlimitedMatch
      ? !minPrice || unlimitedPrice < minPrice
        ? unlimitedPrice
        : minPrice
      : minPrice;
    const formattedMinPrice = minPrice
      ? (minPrice === unlimitedPrice
          ? unlimitedMatch?.[1]
          : limitedMatch?.[1]) ?? ""
      : "";
    return {
      mallPrice: unlimitedPrice,
      limitedMallPrice: limitedPrice,
      formattedMinPrice: formattedMinPrice,
      minPrice: minPrice,
      formattedMallPrice: unlimitedMatch ? unlimitedMatch[1] : "",
      formattedLimitedMallPrice: limitedMatch ? limitedMatch[1] : "",
    };
  }

  async getItemDescription(descId: number): Promise<string> {
    switch (descId) {
      // Complicated Device
      case 539406330:
        return "+1, 11, and 111 to a wide array of stats\n";
      default: //fall through
    }
    const description = await this.visitUrl("desc_item.php", {
      whichitem: descId,
    });
    const blueText = description.match(
      /<center>\s*<b>\s*<font color="?[\w]+"?>(?<description>[\s\S]+)<\/center>/i,
    );
    const effect = description.match(
      /Effect: \s?<b>\s?<a[^>]+href="desc_effect\.php\?whicheffect=(?<descid>[^"]+)[^>]+>(?<effect>[\s\S]+)<\/a>[^(]+\((?<duration>[\d]+)/,
    );
    const melting = description.match(
      /This item will disappear at the end of the day\./,
    );
    const singleEquip = description.match(
      / You may not equip more than one of these at a time\./,
    );

    const output: string[] = [];

    if (melting) output.push("Disappears at rollover");
    if (singleEquip) output.push("Single equip only.");
    if (blueText) output.push(sanitiseBlueText(blueText.groups?.description));
    if (effect)
      output.push(
        `Gives ${effect.groups?.duration} adventures of ${bold(
          hyperlink(
            cleanString(effect.groups?.effect),
            toWikiLink(cleanString(effect.groups?.effect)),
          ),
        )}`,
        indent(await this.getEffectDescription(effect.groups?.descid)),
      );

    return output.join("\n");
  }

  async getEffectDescription(descId: string | undefined): Promise<string> {
    if (!descId) return "";

    switch (descId) {
      // Video... Games?
      case "3d5280f646ac2a6b70e64eae72daa263":
        return "+5 to basically everything";
      // Spoon Boon
      case "fa4374dcb3f6a5d3ff129b0be374fa1f":
        return "Muscle +10%\nMysticality +10%\nMoxie +10%\n+5 Prismatic Damage\n+10 Prismatic Spell Damage\nSo-So Resistance to All Elements (+2)";
    }

    const description = await this.visitUrl("desc_effect.php", {
      whicheffect: descId,
    });

    const blueText = description.match(
      /<center><font color="?[\w]+"?>(?<description>[\s\S]+)<\/div>/m,
    );

    return sanitiseBlueText(blueText?.groups?.description);
  }

  async getSkillDescription(id: number) {
    const description = await this.visitUrl("desc_skill.php", {
      whichskill: String(id),
    });
    const blueText = description.match(
      /<blockquote[\s\S]+<[Cc]enter>(?<description>[\s\S]+)<\/[Cc]enter>/,
    );
    return blueText ? sanitiseBlueText(blueText.groups?.description) : null;
  }

  async joinClan(id: number): Promise<boolean> {
    const result = await this.visitUrl("showclan.php", {
      whichclan: id,
      action: "joinclan",
      confirm: "on",
    });
    return (
      result.includes("clanhalltop.gif") ||
      result.includes("a clan you're already in")
    );
  }

  async addToWhitelist(playerId: number, clanId: number): Promise<boolean> {
    return await this.actionMutex.runExclusive(async () => {
      if (!(await this.joinClan(clanId))) return false;
      await this.visitUrl("clan_whitelist.php", {
        addwho: playerId,
        level: 2,
        title: "",
        action: "add",
      });
      return true;
    });
  }

  async getLeaderboard(
    leaderboardId: number,
  ): Promise<LeaderboardInfo | undefined> {
    try {
      const leaderboard = await this.visitUrl("museum.php", {
        floor: 1,
        place: "leaderboards",
        whichboard: leaderboardId,
      });

      const document = parser.parseFromString(leaderboard);
      const [board, ...boards] = selectMulti("//table", document);

      return {
        name: selectMulti(".//text()", board.firstChild!)
          .map((node) => node.nodeValue)
          .join("")
          .replace(/\s+/g, " ")
          .trim(),
        boards: boards
          .slice(1)
          .filter(
            (board) =>
              selectMulti("./tr//text()", board)[0]?.nodeValue?.match(
                /^((Fast|Funn|B)est|Most (Goo|Elf))/,
              ) && selectMulti("./tr", board).length > 1,
          )
          .map((subboard) => {
            const rows = selectMulti("./tr", subboard);

            return {
              name: (
                selectMulti(".//text()", rows[0])[0]?.nodeValue || ""
              ).trim(),
              runs: selectMulti("./td//tr", rows[1])
                .slice(2)
                .map((node) => {
                  const rowText = selectMulti(".//text()", node).map((text) =>
                    text.toString().replace(/&amp;nbsp;/g, ""),
                  );
                  const hasTwoNumbers = !!parseInt(rowText[rowText.length - 2]);
                  return {
                    player: rowText
                      .slice(0, rowText.length - (hasTwoNumbers ? 2 : 1))
                      .join("")
                      .trim()
                      .toString(),
                    days: hasTwoNumbers
                      ? rowText[rowText.length - 2].toString() || "0"
                      : "",
                    turns: rowText[rowText.length - 1].toString() || "0",
                  };
                }),
              updated: xpath.isComment(subboard.nextSibling)
                ? new Date(subboard.nextSibling.data.slice(9, -1))
                : null,
            };
          }),
      };
    } catch (error) {
      console.log(error);
      return undefined;
    }
  }

  async getPartialPlayer(nameOrId: string | number) {
    const id = Number(nameOrId);

    if (!Number.isNaN(id) || typeof nameOrId === "number") {
      return await this.getPartialPlayerFromId(id);
    }

    return await this.getPartialPlayerFromName(nameOrId);
  }

  async getPlayerNameFromId(id: number): Promise<string | null> {
    try {
      const profile = await this.visitUrl("showplayer.php", { who: id });
      const name = profile.match(/<b>([^>]*?)<\/b> \(#(\d+)\)<br>/)?.[1];
      return name || null;
    } catch {
      return null;
    }
  }

  async getPartialPlayerFromId(id: number): Promise<PartialPlayer | null> {
    const name = await this.getPlayerNameFromId(id);
    if (!name) return null;
    return await this.getPartialPlayerFromName(name);
  }

  async getPartialPlayerFromName(name: string): Promise<PartialPlayer | null> {
    try {
      const matcher =
        /href="showplayer.php\?who=(?<playerId>\d+)">(?<playerName>.*?)<\/a>\D+(clan=\d+[^<]+\D+)?\d+\D*(?<level>(\d+)|(inf_large\.gif))\D+valign=top>(?<class>[^<]*)<\/td>/i;
      const search = await this.visitUrl("searchplayer.php", {
        searchstring: name.replace(/_/g, "\\_"),
        searching: "Yep.",
        for: "",
        startswith: 1,
        hardcoreonly: 0,
      });
      const match = matcher.exec(search)?.groups;

      if (!match) {
        return null;
      }

      return {
        id: Number(match.playerId),
        name: match.playerName,
        level: parseInt(match.level),
        class: match.class,
      };
    } catch (error) {
      return null;
    }
  }

  async ensureFamiliar(familiarId: number): Promise<void> {
    await this.visitUrl("familiar.php", {
      action: "newfam",
      newfam: familiarId.toFixed(0),
    });
  }

  async getEquipmentFamiliar(itemId: number): Promise<string | null> {
    const responseText = await this.visitUrl("inv_equip.php", {
      action: "equip",
      which: 2,
      whichitem: itemId,
    });

    const match =
      /Only a specific familiar type \(([^)]*)\) can equip this item/.exec(
        responseText,
      );

    return match?.[1] ?? null;
  }

  async getAvatarAsSvg(profile: string) {
    const header = profile.match(
      /<center><table><tr><td><center>.*?(<div.*?>.*?<\/div>).*?<b>([^>]*?)<\/b> \(#(\d+)\)<br>/,
    );
    const blockHtml = header?.[1];

    if (!blockHtml) return null;

    const block = parseHtml(blockHtml).querySelector("div");

    if (!block) return null;

    const ocrsColour =
      ["gold", "red"].find((k) => block.classList.contains(k)) ?? "black";

    const images = [];

    for (const imgElement of block.querySelectorAll("img")) {
      const src = imgElement.getAttribute("src");
      if (!src) continue;

      const result = await fetch(resolveKoLImage(src));
      const buffer = Buffer.from(await result.arrayBuffer());

      const { width = 0, height = 0 } = imageSize(buffer);

      const href = `data:image/png;base64,${buffer.toString("base64")}`;

      const style = imgElement.getAttribute("style");

      const top = Number(style?.match(/top: ?(-?\d+)px/i)?.[1] || "0");
      const left = Number(style?.match(/left: ?(-?\d+)px/i)?.[1] || "0");
      const rotate = Number(style?.match(/rotate\((-?\d+)deg\)/)?.[1] || "0");

      images.push({
        href,
        top,
        left,
        rotate,
        width,
        height,
      });
    }

    const width = Math.max(...images.map((i) => i.left + i.width));

    return dedent`
      <svg width="${width}" height="100" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="colorMask">
            <feComponentTransfer in="SourceGraphic" out="f1">
              <feFuncR type="discrete" tableValues="1 0"/>
              <feFuncG type="discrete" tableValues="1 0"/>
              <feFuncB type="discrete" tableValues="1 0"/>
            </feComponentTransfer>
            <feColorMatrix type="matrix" values="1 0 0 0 0
                                                0 1 0 0 0
                                                0 0 1 0 0
                                                1 1 1 1 -3" result="selectedColor"/>
            <feFlood flood-color="${ocrsColour}"/>
            <feComposite operator="in" in2="selectedColor"/>
            <feComposite operator="over" in2="SourceGraphic"/>
          </filter>
        </defs>
        ${images
          .map(
            (i) =>
              dedent`
                <image
                  filter="url(#colorMask)"
                  href="${i.href}"
                  width="${i.width}"
                  height="${i.height}"
                  x="${i.left}"
                  y="${i.top}"
                  transform="rotate(${i.rotate},${i.width / 2 + i.left},${
                    i.height / 2 + i.top
                  })"
                />
              `,
          )
          .join("\n")}
      </svg>
    `;
  }

  async getPlayerInformation(
    playerToLookup: PartialPlayer,
  ): Promise<FullPlayer | null> {
    try {
      const profile = await this.visitUrl("showplayer.php", {
        who: playerToLookup.id,
      });
      const header = profile.match(
        /<center><table><tr><td><center>.*?<img.*?src="(.*?)".*?<b>([^>]*?)<\/b> \(#(\d+)\)<br>/,
      );
      if (!header) return null;

      const avatar = (await this.getAvatarAsSvg(profile)) || header[1];

      let ascensionsString = profile.match(
        />Ascensions<\/a>:<\/b><\/td><td>(.*?)<\/td>/,
      )?.[1];
      if (ascensionsString) {
        ascensionsString = ascensionsString.replace(/,/g, "");
      }
      const ascensions = Number(ascensionsString) || 0;

      const trophies = Number(
        profile.match(/>Trophies Collected:<\/b><\/td><td>(.*?)<\/td>/)?.[1] ??
          0,
      );
      const tattoos = Number(
        profile.match(/>Tattoos Collected:<\/b><\/td><td>(.*?)<\/td>/)?.[1] ??
          0,
      );
      const favoriteFood = profile.match(
        />Favorite Food:<\/b><\/td><td>(.*?)<\/td>/,
      )?.[1];
      const favoriteBooze = profile.match(
        />Favorite Booze:<\/b><\/td><td>(.*?)<\/td>/,
      )?.[1];
      const createdDate = profile.match(
        />Account Created:<\/b><\/td><td>(.*?)<\/td>/,
      )?.[1];
      const lastLogin = profile.match(
        />Last Login:<\/b><\/td><td>(.*?)<\/td>/,
      )?.[1];
      const hasDisplayCase =
        profile.match(/Display Case<\/b><\/a> in the Museum<\/td>/) !== null;

      return {
        ...playerToLookup,
        avatar,
        ascensions,
        trophies,
        tattoos,
        favoriteFood,
        favoriteBooze,
        createdDate: parsePlayerDate(createdDate),
        lastLogin: parsePlayerDate(lastLogin),
        hasDisplayCase,
      };
    } catch (error) {
      console.error(error);
      return null;
    }
  }
}

export const kolClient = new KoLClient(config.KOL_USER, config.KOL_PASS);
