declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    BUCKET: R2Bucket;
    SPT_VAULT_KEY: string;
    // Optional native backend connection. Never a cross-owner key fallback.
    ELEVENLABS_API_KEY?: string;
    SPT_ELEVENLABS_OWNER_KEY?: string;
  }
}
