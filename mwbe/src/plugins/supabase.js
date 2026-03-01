/**
 * Fastify plugin setup for Supabase, where our postgress database is hosted. 
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */
const { createClient } = require("@supabase/supabase-js");

function registerSupabase(app) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    app.log.warn(
      "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set. Users CRUD routes will fail until Supabase is configured."
    );
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  app.decorate("supabase", supabase);
}

module.exports = registerSupabase;
