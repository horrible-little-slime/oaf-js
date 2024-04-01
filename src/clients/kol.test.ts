import axios from "axios";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import { respondWith, respondWithFixture } from "../testUtils.js";
import { kolClient, resolveKoLImage } from "./kol.js";

vi.mock("axios");

beforeAll(() => {
  kolClient.mockLoggedIn = true;
});

afterAll(() => {
  kolClient.mockLoggedIn = false;
});

afterEach(() => {
  vi.mocked(axios).mockReset();
});

function expectNotNull<T>(value: T | null): asserts value is T {
  expect(value).not.toBeNull();
}

test("Can search for a player by name", async () => {
  vi.mocked(axios).mockResolvedValueOnce(
    await respondWithFixture(__dirname, "searchplayer_mad_carew.html"),
  );

  const player = await kolClient.getPartialPlayerFromName("mad carew");

  expectNotNull(player);

  expect(player.id).toBe(263717);
  expect(player.level).toBe(16);
  expect(player.class).toBe("Sauceror");
  // Learns correct capitalisation
  expect(player.name).toBe("Mad Carew");
});

describe("Profile parsing", () => {
  test("Can parse a profile picture", async () => {
    vi.mocked(axios).mockResolvedValueOnce(
      await respondWithFixture(__dirname, "showplayer_regular.html"),
    );

    const player = await kolClient.getPlayerInformation({
      id: 2264486,
      name: "SSBBHax",
      level: 1,
      class: "Sauceror",
    });

    expectNotNull(player);
    expect(player.avatar).toContain("<svg");
  });

  test("Can parse a profile picture on dependence day", async () => {
    vi.mocked(axios).mockResolvedValueOnce(
      await respondWithFixture(__dirname, "showplayer_dependence_day.html"),
    );

    const player = await kolClient.getPlayerInformation({
      id: 3019702,
      name: "Name Guy Man",
      level: 1,
      class: "Sauceror",
    });

    expectNotNull(player);
    expect(player.avatar).toContain("<svg");
  });

  test("Can parse an avatar when the player has been painted gold", async () => {
    vi.mocked(axios).mockResolvedValueOnce(
      await respondWithFixture(__dirname, "showplayer_golden_gun.html"),
    );

    const player = await kolClient.getPlayerInformation({
      id: 1197090,
      name: "gAUSIE",
      level: 15,
      class: "Sauceror",
    });

    expectNotNull(player);
    expect(player.avatar).toContain("<svg");
  });

  test("Can resolve KoL images", () => {
    expect(resolveKoLImage("/iii/otherimages/classav31_f.gif")).toBe(
      "https://s3.amazonaws.com/images.kingdomofloathing.com/otherimages/classav31_f.gif",
    );
    expect(resolveKoLImage("/itemimages/oaf.gif")).toBe(
      "https://s3.amazonaws.com/images.kingdomofloathing.com/itemimages/oaf.gif",
    );
    expect(
      resolveKoLImage(
        "https://s3.amazonaws.com/images.kingdomofloathing.com/itemimages/oaf.gif",
      ),
    ).toBe(
      "https://s3.amazonaws.com/images.kingdomofloathing.com/itemimages/oaf.gif",
    );
  });
});

describe("LoathingChat", () => {
  test("Can parse a regular message", async () => {
    vi.mocked(axios).mockResolvedValueOnce(
      await respondWith({
        msgs: [
          {
            msg: "testing",
            type: "public",
            mid: "1538072797",
            who: { name: "gAUSIE", id: "1197090", color: "black" },
            format: "0",
            channel: "talkie",
            channelcolor: "green",
            time: "1698787642",
          },
        ],
      }),
    );

    const messageSpy = vi.fn();

    kolClient.on("public", messageSpy);

    await kolClient.checkMessages();

    expect(messageSpy).toHaveBeenCalledOnce();
    expect(messageSpy).toHaveBeenCalledWith({
      type: "public",
      who: { id: 1197090, name: "gAUSIE" },
      msg: "testing",
      time: new Date(1698787642000),
    });
  });

  test("Can parse a system message for rollover in 5 minutes", async () => {
    vi.mocked(axios).mockResolvedValueOnce(
      await respondWith({
        msgs: [
          {
            msg: "The system will go down for nightly maintenance in 5 minutes.",
            type: "system",
            mid: "1538084998",
            who: { name: "System Message", id: "-1", color: "" },
            format: "2",
            channelcolor: "green",
            time: "1698809101",
          },
        ],
      }),
    );

    const messageSpy = vi.fn();

    kolClient.on("system", messageSpy);

    await kolClient.checkMessages();

    expect(messageSpy).toHaveBeenCalledOnce();
    expect(messageSpy).toHaveBeenCalledWith({
      type: "system",
      who: { id: -1, name: "System Message" },
      msg: "The system will go down for nightly maintenance in 5 minutes.",
      time: new Date(1698809101000),
    });
  });

  test("Can parse a system message for rollover in one minute", async () => {
    vi.mocked(axios).mockResolvedValueOnce(
      await respondWith({
        msgs: [
          {
            msg: "The system will go down for nightly maintenance in 1 minute.",
            type: "system",
            mid: "1538084998",
            who: { name: "System Message", id: "-1", color: "" },
            format: "2",
            channelcolor: "green",
            time: "1698809101",
          },
        ],
      }),
    );

    const messageSpy = vi.fn();

    kolClient.on("system", messageSpy);

    await kolClient.checkMessages();

    expect(messageSpy).toHaveBeenCalledOnce();
    expect(messageSpy).toHaveBeenCalledWith({
      type: "system",
      who: { id: -1, name: "System Message" },
      msg: "The system will go down for nightly maintenance in 1 minute.",
      time: new Date(1698809101000),
    });
  });

  test("Can parse a system message for rollover complete", async () => {
    vi.mocked(axios).mockResolvedValueOnce(
      await respondWith({
        msgs: [
          {
            msg: "Rollover is over.",
            type: "system",
            mid: "1538085619",
            who: { name: "System Message", id: "-1", color: "" },
            format: "2",
            channelcolor: "green",
            time: "1698809633",
          },
        ],
      }),
    );

    const messageSpy = vi.fn();

    kolClient.on("system", messageSpy);

    await kolClient.checkMessages();

    expect(messageSpy).toHaveBeenCalledOnce();
    expect(messageSpy).toHaveBeenCalledWith({
      type: "system",
      who: { id: -1, name: "System Message" },
      msg: "Rollover is over.",
      time: new Date(1698809633000),
    });
  });
});
