export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Market data API keys
  alpacaApiKey: process.env.ALPACA_API_KEY ?? "",
  alpacaSecretKey: process.env.ALPACA_SECRET_KEY ?? "",
  alpacaEndpoint: process.env.ALPACA_ENDPOINT ?? "https://data.alpaca.markets/v2",
  alphaVantageApiKey: process.env.ALPHAVANTAGE_API_KEY ?? "",
  tiingoApiKey: process.env.TIINGO_API_KEY ?? "",
  finnhubApiKey: process.env.FINNHUB_API_KEY ?? "",
  eodhdApiKey: process.env.EODHD_API_KEY ?? "",
  polygonApiKey: process.env.POLYGON_API_KEY ?? "",
  twelveDataApiKey: process.env.TWELVE_DATA_API_KEY ?? "",
  marketstackApiKey: process.env.MARKETSTACK_API_KEY ?? "",
  // Gemini AI
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiBaseUrl: process.env.GOOGLE_GEMINI_BASE_URL ?? "https://openfly.cc",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
  // OpenAI (fallback AI)
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://openfly.cc/v1",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.1-codex",
};
