import axios from "axios";
import { dedent } from "ts-dedent";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";

import { kolClient } from "../clients/kol.js";
import { respondWithFixture } from "../testUtils.js";
import { Familiar } from "./Familiar.js";
import { Item } from "./Item.js";

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

test("Can describe a Familiar", async () => {
  vi.mocked(axios)
    .mockResolvedValueOnce(
      await respondWithFixture(__dirname, "desc_item_mosquito_larva.html"),
    )
    .mockResolvedValueOnce(
      await respondWithFixture(__dirname, "desc_item_hypodermic_needle.html"),
    );

  const familiar = Familiar.from(
    "1	Mosquito	familiar1.gif	combat0,hp0	mosquito larva	hypodermic needle	2	1	3	0	animal,bug,eyes,wings,quick,biting,flying",
  );
  familiar.hatchling = Item.from(
    "275	mosquito larva	187601582	larva.gif	grow	q	0	mosquito larvae",
  );
  familiar.equipment = Item.from(
    "848	hypodermic needle	10000001	syringe.gif	familiar	t,d	75",
  );

  const description = await familiar.getDescription();

  expect(description).toBe(
    dedent`
      **Familiar**
      Deals physical damage to heal you in combat.

      Attributes: animal, bug, eyes, wings, quick, biting, flying

      Hatchling: [mosquito larva](https://kol.coldfront.net/thekolwiki/index.php/mosquito_larva)
      Quest Item
      Cannot be traded or discarded.

      Equipment: [hypodermic needle](https://kol.coldfront.net/thekolwiki/index.php/hypodermic_needle)
      \u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0+5 to Familiar Weight
    `,
  );
});
