import { EnvType, load } from "ts-dotenv";

const SNOWFLAKE_PATTERN = /[0-9]{17,64}/;

export const schema = {
  // Generic
  DEBUG: {
    type: Boolean,
    default: false,
  },
  PORT: {
    type: Number,
    default: 8080,
  },

  // Credentials
  DATABASE_URL: String,
  DISCORD_TOKEN: String,
  CLIENT_ID: String,
  GOOGLE_API_KEY: {
    type: String,
    optional: true,
  },
  CUSTOM_SEARCH: {
    type: String,
    optional: true,
  },
  MAFIA_CUSTOM_SEARCH: {
    type: String,
    optional: true,
  },
  KOL_USER: String,
  KOL_PASS: String,

  // General guild info
  GUILD_ID: SNOWFLAKE_PATTERN,
  ALERTS_CHANNEL_ID: SNOWFLAKE_PATTERN,
  ANNOUNCEMENTS_CHANNEL_ID: SNOWFLAKE_PATTERN,

  // Subsrolling webhook
  IOTM_CHANNEL_ID: SNOWFLAKE_PATTERN,
  SUBS_ROLLING_TOKEN: String,

  // Crimbo
  CRIMBO_CHANNEL_ID: SNOWFLAKE_PATTERN,

  // /claim
  VERIFIED_ROLE_ID: SNOWFLAKE_PATTERN,
  SALT: String,

  // /role
  LISTENER_ROLE_ID: SNOWFLAKE_PATTERN,
  NO_ALERTS_ROLE_ID: SNOWFLAKE_PATTERN,
  SUBSCRIBER_ROLE_ID: SNOWFLAKE_PATTERN,

  // /tag
  EXTENDED_TEAM_ROLE_ID: SNOWFLAKE_PATTERN,
  WHITELIST_ROLE_IDS: new RegExp(
    `${SNOWFLAKE_PATTERN.source}(,${SNOWFLAKE_PATTERN.source})*`,
  ),
};

export type Env = EnvType<typeof schema>;

// Do not attempt to load if in testing environment
export const config = process.env.VITEST_WORKER_ID
  ? ({} as { PORT: number } & { [key: string]: string })
  : load(schema);
