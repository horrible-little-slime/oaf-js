import axios from "axios";
import { decode } from "html-entities";
import { cleanString, indent, toWikiLink } from "./utils";
import { Mutex } from "async-mutex";
import { DOMParser } from "xmldom";
import { select } from "xpath";
import { ItemType, ITEM_SPADING_CALLS } from "./constants";

const clanActionMutex = new Mutex();
const loginMutex = new Mutex();

const parser = new DOMParser({
  locator: {},
  errorHandler: {
    warning: function (w) {},
    error: function (e) {},
    fatalError: function (e) {
      console.error(e);
    },
  },
});

type MallPrice = {
  formattedMallPrice: string;
  formattedLimitedMallPrice: string;
  formattedMinPrice: string;
  mallPrice: number;
  limitedMallPrice: number;
  minPrice: number | null;
};

type KOLCredentials = {
  fetched: number;
  sessionCookies?: string;
  pwdhash?: string;
};

type DreadStatus = {
  forest: number;
  village: number;
  castle: number;
  skills: number;
  bosses: string[];
  capacitor: boolean;
};

type DreadForestStatus = {
  attic: boolean;
  watchtower: boolean;
  auditor: boolean;
  musicbox: boolean;
  kiwi: boolean;
  amber: boolean;
};

type DreadVillageStatus = {
  schoolhouse: boolean;
  suite: boolean;
  hanging: boolean;
};

type DreadCastleStatus = {
  lab: boolean;
  roast: boolean;
  banana: boolean;
  agaricus: boolean;
};

type DetailedDreadStatus = {
  overview: DreadStatus;
  forest: DreadForestStatus;
  village: DreadVillageStatus;
  castle: DreadCastleStatus;
};

type LeaderboardInfo = {
  name: string;
  boards: SubboardInfo[];
};

type SubboardInfo = {
  name: string;
  runs: RunInfo[];
};

type RunInfo = {
  player: string;
  days: string;
  turns: string;
};

type PlayerBasicData = {
  id: string;
  level: number;
  class: string;
};

type SpadedItem = {
  id: number;
  exists: boolean;
  tradeable: boolean;
  itemtype: ItemType;
  additionalInfo?: string;
};

function sanitiseBlueText(blueText: string): string {
  return decode(
    blueText
      .replace(/\r/g, "")
      .replace(/\r/g, "")
      .replace(/(<p><\/p>)|(<br>)|(<Br>)|(<br \/>)|(<Br \/>)/g, "\n")
      .replace(/<[^<>]+>/g, "")
      .replace(/(\n+)/g, "\n")
      .replace(/(\n)+$/, "")
  );
}

export class KOLClient {
  private _loginParameters: URLSearchParams;
  private _credentials: KOLCredentials = { fetched: -1 };

  constructor() {
    this._loginParameters = new URLSearchParams();
    this._loginParameters.append("loggingin", "Yup.");
    this._loginParameters.append("loginname", process.env.KOL_USER || "");
    this._loginParameters.append("password", process.env.KOL_PASS || "");
    this._loginParameters.append("secure", "0");
    this._loginParameters.append("submitbutton", "Log In");
  }

  async logIn(): Promise<void> {
    await loginMutex.runExclusive(async () => {
      try {
        if (this._credentials.fetched < new Date().getTime() - 60000) {
          const loginResponse = await axios("https://www.kingdomofloathing.com/login.php", {
            method: "POST",
            data: this._loginParameters,
            maxRedirects: 0,
            validateStatus: (status) => status === 302,
          });
          const sessionCookies = (loginResponse.headers["set-cookie"] || [])
            .map((cookie: string) => cookie.split(";")[0])
            .join("; ");
          const apiResponse = await axios("https://www.kingdomofloathing.com/api.php", {
            withCredentials: true,
            headers: {
              cookie: sessionCookies,
            },
            params: {
              what: "status",
              for: "OAF Discord bot for Kingdom of Loathing",
            },
          });
          this._credentials = {
            fetched: new Date().getTime(),
            sessionCookies: sessionCookies,
            pwdhash: apiResponse.data.pwd,
          };
        } else {
          console.log("Blocked fetching new credentials");
          console.log(
            `${60000 + this._credentials.fetched - new Date().getTime()} milliseconds to new login`
          );
        }
      } catch (error) {
        console.log(error);
      }
    });
  }

  private async makeCredentialedRequest(url: string, parameters: object) {
    try {
      const request = await axios(`https://www.kingdomofloathing.com/${url}`, {
        method: "GET",
        headers: {
          cookie: this._credentials.sessionCookies || "",
        },
        params: {
          pwd: this._credentials.pwdhash,
          ...parameters,
        },
      });
      if (
        !request.data ||
        request.data.match(/<title>The Kingdom of Loathing<\/title>/) ||
        request.data.match(/This script is not available unless you're logged in\./)
      ) {
        return undefined;
      }
      return request.data;
    } catch {
      return undefined;
    }
  }

  private async tryRequestWithLogin(url: string, parameters: object) {
    const result = await this.makeCredentialedRequest(url, parameters);
    if (result) return result;
    await this.logIn();
    return (await this.makeCredentialedRequest(url, parameters)) || "";
  }

  async getMallPrice(itemId: number): Promise<MallPrice> {
    const prices = await this.tryRequestWithLogin("backoffice.php", {
      action: "prices",
      ajax: 1,
      iid: itemId,
    });
    const unlimitedMatch = prices.match(/<td>unlimited:<\/td><td><b>(?<unlimitedPrice>[\d\,]+)/);
    const limitedMatch = prices.match(/<td>limited:<\/td><td><b>(?<limitedPrice>[\d\,]+)/);
    const unlimitedPrice = unlimitedMatch ? parseInt(unlimitedMatch[1].replace(/,/g, "")) : 0;
    const limitedPrice = limitedMatch ? parseInt(limitedMatch[1].replace(/,/g, "")) : 0;
    let minPrice = limitedMatch ? limitedPrice : null;
    minPrice = unlimitedMatch
      ? !minPrice || unlimitedPrice < minPrice
        ? unlimitedPrice
        : minPrice
      : minPrice;
    const formattedMinPrice = minPrice
      ? minPrice === unlimitedPrice
        ? unlimitedMatch[1]
        : limitedMatch[1]
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
    const description = await this.tryRequestWithLogin("desc_item.php", {
      whichitem: descId,
    });
    const blueText = description.match(
      /<[Cc]enter>\s?<b>\s?<font color="?[\w]+"?>(?<description>[\s\S]+)<\/[Cc]enter>/
    );
    const effect = description.match(
      /Effect: \s?<b>\s?<a[^\>]+href="desc_effect\.php\?whicheffect=(?<descid>[^"]+)[^\>]+>(?<effect>[\s\S]+)<\/a>[^\(]+\((?<duration>[\d]+)/
    );
    const melting = description.match(/This item will disappear at the end of the day\./);
    const singleEquip = description.match(/ You may not equip more than one of these at a time\./);

    const meltingString = melting ? "Disappears at rollover\n" : "";
    const singleEquipString = singleEquip ? "Single equip only.\n" : "";
    const blueTextString = blueText ? `${sanitiseBlueText(blueText.groups.description)}\n` : "";
    const effectString = effect
      ? `Gives ${effect.groups.duration} adventures of **[${cleanString(
          effect.groups.effect
        )}](${toWikiLink(cleanString(effect.groups.effect))})**\n${indent(
          await this.getEffectDescription(effect.groups.descid)
        )}\n`
      : "";
    return `${meltingString}${singleEquipString}${blueTextString}${
      blueText && effect ? "\n" : ""
    }${effectString}`;
  }

  async getEffectDescription(descId: string): Promise<string> {
    switch (descId) {
      // Video... Games?
      case "3d5280f646ac2a6b70e64eae72daa263":
        return "+5 to basically everything";
      // Spoon Boon
      case "fa4374dcb3f6a5d3ff129b0be374fa1f":
        return "Muscle +10%\nMysticality +10%\nMoxie +10%\n+5 Prismatic Damage\n+10 Prismatic Spell Damage\nSo-So Resistance to All Elements (+2)";
      default: //fall through
    }
    const description = await this.tryRequestWithLogin("desc_effect.php", {
      whicheffect: descId,
    });
    const blueText = description.match(
      /<center><font color="?[\w]+"?>(?<description>[\s\S]+)<\/div>/
    );
    return blueText ? sanitiseBlueText(blueText.groups.description) : "";
  }

  async getSkillDescription(id: number): Promise<string> {
    const description = await this.tryRequestWithLogin("desc_skill.php", {
      whichskill: String(id),
    });
    const blueText = description.match(
      /<blockquote[\s\S]+<[Cc]enter>(?<description>[\s\S]+)<\/[Cc]enter>/
    );
    return blueText ? sanitiseBlueText(blueText.groups.description) : "";
  }

  private extractDreadOverview(raidLog: string): DreadStatus {
    const forest = raidLog.match(
      /Your clan has defeated <b>(?<forest>[\d,]+)<\/b> monster\(s\) in the Forest/
    );
    const village = raidLog.match(
      /Your clan has defeated <b>(?<village>[\d,]+)<\/b> monster\(s\) in the Village/
    );
    const castle = raidLog.match(
      /Your clan has defeated <b>(?<castle>[\d,]+)<\/b> monster\(s\) in the Castle/
    );

    type MonsterData = {
      kills: number;
      banishes: number;
      regex: RegExp;
    };

    const monsters: Map<string, MonsterData> = new Map([
      ["bugbear", { kills: 0, banishes: 0, regex: /defeated\s+Falls\-From\-Sky/ }],
      ["werewolf", { kills: 0, banishes: 0, regex: /defeated\s+The Great Wolf of the Air/ }],
      ["ghost", { kills: 0, banishes: 0, regex: /defeated\s+Mayor Ghost/ }],
      [
        "zombie",
        { kills: 0, banishes: 0, regex: /defeated\s+the Zombie Homeowners\' Association/ },
      ],
      ["vampire", { kills: 0, banishes: 0, regex: /defeated\s+Count Drunkula/ }],
      ["skeleton", { kills: 0, banishes: 0, regex: /defeated\s+The Unkillable Skeleton/ }],
    ]);

    const pairs = [
      ["bugbear", "werewolf"],
      ["ghost", "zombie"],
      ["vampire", "skeleton"],
    ];

    for (const monster of monsters.keys()) {
      const monsterKillRegex = new RegExp(`defeated (.*?) ${monster} x ([0-9]+)`, "gi");
      const monsterBanishRegex = /drove some (.*?) out of the (.*?) \(1 turn\)/gi;
      let match;
      while ((match = monsterKillRegex.exec(raidLog)) !== null) {
        (monsters.get(monster) as MonsterData).kills += parseInt(match[2]);
      }
      while ((match = monsterBanishRegex.exec(raidLog)) !== null) {
        (monsters.get(monster) as MonsterData).banishes++;
      }
    }
    const bosses: string[] = [];
    for (let [monster1, monster2] of pairs) {
      const monster1data = monsters.get(monster1) as MonsterData;
      const monster2data = monsters.get(monster2) as MonsterData;
      if (monster1data.kills > monster2data.kills + 50) {
        monster2data.banishes++;
      } else if (monster2data.kills > monster1data.kills + 50) {
        monster1data.banishes++;
      }
      //ELSE IF CHAIN BREAKS HERE
      if (monster1data.regex.test(raidLog)) {
        bosses.push(`x${monster1}`);
      } else if (monster2data.regex.test(raidLog)) {
        bosses.push(`x${monster2}`);
      } else if (monster1data.banishes > monster2data.banishes) {
        bosses.push(monster2);
      } else if (monster2data.banishes > monster1data.banishes) {
        bosses.push(monster1);
      } else {
        bosses.push("unknown");
      }
    }
    const capacitor = raidLog.match(/fixed The Machine \(1 turn\)/);
    const skills = raidLog.match(/used The Machine, assisted by/g);
    return {
      forest: 1000 - (forest ? parseInt(forest.groups?.forest.replace(",", "") || "0") : 0),
      village: 1000 - (village ? parseInt(village.groups?.village.replace(",", "") || "0") : 0),
      castle: 1000 - (castle ? parseInt(castle.groups?.castle.replace(",", "") || "0") : 0),
      skills: skills ? 3 - skills.length : 3,
      bosses: bosses,
      capacitor: !!capacitor,
    };
  }

  private extractDreadForest(raidLog: string): DreadForestStatus {
    return {
      attic: !!raidLog.match(/unlocked the attic of the cabin/),
      watchtower: !!raidLog.match(/unlocked the fire watchtower/),
      auditor: !!raidLog.match(/got a Dreadsylvanian auditor's badge/),
      musicbox: !!raidLog.match(/made the forest less spooky/),
      kiwi: !!(raidLog.match(/knocked some fruit loose/) || raidLog.match(/wasted some fruit/)),
      amber: !!raidLog.match(/acquired a chunk of moon-amber/),
    };
  }

  private extractDreadVillage(raidLog: string): DreadVillageStatus {
    return {
      schoolhouse: !!raidLog.match(/unlocked the schoolhouse/),
      suite: !!raidLog.match(/unlocked the master suite/),
      hanging: !!(raidLog.match(/hanged/) || raidLog.match(/hung/)),
    };
  }

  private extractDreadCastle(raidLog: string): DreadCastleStatus {
    return {
      lab: !!raidLog.match(/unlocked the lab/),
      roast: !!raidLog.match(/got some roast beast/),
      banana: !!raidLog.match(/got a wax banana/),
      agaricus: !!raidLog.match(/got some stinking agaric/),
    };
  }

  async getDreadStatusOverview(clanId: number): Promise<DreadStatus> {
    const raidLog = await this.getRaidLog(clanId);
    if (!raidLog) throw "No raidlog";
    return this.extractDreadOverview(raidLog);
  }

  async getDetailedDreadStatus(clanId: number): Promise<DetailedDreadStatus> {
    const raidLog = await this.getRaidLog(clanId);
    if (!raidLog) throw "No raidlog";
    return {
      overview: this.extractDreadOverview(raidLog),
      forest: this.extractDreadForest(raidLog),
      village: this.extractDreadVillage(raidLog),
      castle: this.extractDreadCastle(raidLog),
    };
  }

  async getMissingRaidLogs(clanId: number, parsedRaids: string[]): Promise<string[]> {
    return await clanActionMutex.runExclusive(async () => {
      await this.whitelist(clanId);
      let raidLogs = await this.tryRequestWithLogin("clan_oldraidlogs.php", {});
      let raidIds: string[] = [];
      let row = 0;
      let done = false;
      while (!raidLogs.match(/No previous Clan Dungeon records found/) && !done) {
        for (let id of raidLogs.match(
          /kisses<\/td><td class=tiny>\[<a href="clan_viewraidlog\.php\?viewlog=(?<id>\d+)/g
        )) {
          const cleanId = id.replace(/\D/g, "");
          if (parsedRaids.includes(cleanId)) {
            done = true;
            break;
          } else {
            raidIds.push(cleanId);
          }
        }
        if (!done) {
          row += 10;
          raidLogs = await this.tryRequestWithLogin("clan_oldraidlogs.php", {
            startrow: row,
          });
        }
      }
      return raidIds;
    });
  }

  async getFinishedRaidLog(raidId: string) {
    return await this.tryRequestWithLogin("clan_viewraidlog.php", {
      viewlog: raidId,
      backstart: 0,
    });
  }

  async getRaidLog(clanId: number): Promise<string> {
    return await clanActionMutex.runExclusive(async () => {
      await this.whitelist(clanId);
      return await this.tryRequestWithLogin("clan_raidlogs.php", {});
    });
  }

  private async whitelist(id: number): Promise<void> {
    await this.tryRequestWithLogin("showclan.php", {
      whichclan: id,
      action: "joinclan",
      confirm: "on",
    });
  }

  async addToWhitelist(playerId: string, clanId: number): Promise<void> {
    return await clanActionMutex.runExclusive(async () => {
      await this.whitelist(clanId);
      await this.tryRequestWithLogin("clan_whitelist.php", {
        addwho: playerId,
        level: 2,
        title: "",
        action: "add",
      });
    });
  }

  async getLeaderboard(leaderboardId: number): Promise<LeaderboardInfo | undefined> {
    try {
      const leaderboard = await this.tryRequestWithLogin("museum.php", {
        floor: 1,
        place: "leaderboards",
        whichboard: leaderboardId,
      });

      const document = parser.parseFromString(leaderboard);
      const [board, ...boards] = select("//table", document);

      return {
        name: select(".//text()", (board as Node).firstChild as ChildNode)
          .map((node) => (node as Node).nodeValue)
          .join("")
          .replace(/\s+/g, " ")
          .trim(),
        boards: boards
          .slice(1)
          .filter(
            (board) =>
              (select("./tr//text()", board as Node)[0] as Node)?.nodeValue?.match(
                /^((Fast|Funn|B)est|Most (Goo|Elf))/
              ) && select("./tr", board as Node).length > 1
          )
          .map((subboard) => {
            const rows = select("./tr", subboard as Node);
            return {
              name: ((select(".//text()", rows[0] as Node)[0] as Node)?.nodeValue || "").trim(),
              runs: select("./td//tr", rows[1] as Node)
                .slice(2)
                .map((node) => {
                  const rowText = select(".//text()", node as Node).map((text) =>
                    text.toString().replace(/&amp;nbsp;/g, "")
                  );
                  const hasTwoNumbers = !!parseInt(rowText[rowText.length - 2]);
                  return {
                    player: rowText
                      .slice(0, rowText.length - (hasTwoNumbers ? 2 : 1))
                      .join("")
                      .trim()
                      .toString(),
                    days: hasTwoNumbers ? rowText[rowText.length - 2].toString() || "0" : "",
                    turns: rowText[rowText.length - 1].toString() || "0",
                  };
                }),
            };
          }),
      };
    } catch (error) {
      return undefined;
    }
  }

  async spadeItem(itemId: number): Promise<SpadedItem> {
    let itemtype = ItemType.Unknown;
    let additionalInfo = "";
    const exists = !/Nopers/.test(
      await this.tryRequestWithLogin("inv_equip.php", {
        action: "equip",
        which: 2,
        whichitem: itemId,
      })
    );
    const tradeable = !/That item cannot be sold or transferred/.test(
      await this.tryRequestWithLogin("town_sellflea.php", {
        whichitem: itemId,
        sellprice: "",
        selling: "Yep.",
      })
    );
    if (exists) {
      for (let property of ITEM_SPADING_CALLS) {
        const { url, visitMatch, type } = property;
        const page = (await this.tryRequestWithLogin(
          ...(url(itemId) as [string, object])
        )) as string;

        const match = visitMatch.test(page);
        if (match) {
          itemtype = type;
          break;
        }
      }
    }
    return { id: itemId, exists, tradeable, itemtype, additionalInfo };
  }

  async spadeFamiliar(famId: number): Promise<string> {
    const page = await this.tryRequestWithLogin("desc_familiar.php", { which: famId });

    if (page.includes("No familiar was found.")) return "none";

    const name = /<font face=Arial,Helvetica><center><b>([^<]+)<\/b>/.exec(page)?.[1];
    return name ?? "none";
  }

  async spadeSkill(skillId: number): Promise<boolean> {
    const page = await this.tryRequestWithLogin("runskillz.php", {
      action: "Skillz",
      whichskill: skillId,
      targetplayer: 1,
      quantity: 1,
    });

    // If the skill doesn't exist on the dev server, the response ends with an exclamation mark
    return page.includes("You don't have that skill.");
  }

  async getBasicDetailsForUser(name: string): Promise<PlayerBasicData> {
    try {
      const matcher =
        /href="showplayer.php\?who=(?<user_id>\d+)[^<]+\D+(clan=\d+[^<]+\D+)?\d+\D*(?<level>(\d+)|(inf_large\.gif))\D+valign=top>(?<class>[^<]+)\<\/td\>/i;
      const search = await this.tryRequestWithLogin("searchplayer.php", {
        searchstring: name.replace(/\_/g, "\\_"),
        searching: "Yep.",
        for: "",
        startswith: 1,
        hardcoreonly: 0,
      });
      const match = matcher.exec(search)?.groups;
      return {
        id: match?.user_id || "",
        level: parseInt(match?.level || "0"),
        class: match?.class || "",
      };
    } catch (error) {
      return { id: "", level: 0, class: "Unknown" };
    }
  }

  async ensureFamiliar(familiarId: number): Promise<void> {
    await this.tryRequestWithLogin("familiar.php", {
      action: "newfam",
      newfam: familiarId.toFixed(0),
    });
  }

  async getEquipmentFamiliar(itemId: number): Promise<string | null> {
    const responseText: string = await this.tryRequestWithLogin("inv_equip.php", {
      action: "equip",
      which: 2,
      whichitem: itemId,
    });

    const match = /Only a specific familiar type \((?<addl>^\)*)\) can equip this item/.exec(
      responseText
    );

    return match?.[1] ?? null;
  }
}
