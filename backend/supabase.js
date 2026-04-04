const { createClient } = require("@supabase/supabase-js")

function createSupabaseFromEnv() {
    const supabaseUrl = String(process.env.SUPABASE_URL || "").trim()
    const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()

    if (!supabaseUrl || !serviceRoleKey) {
        return null
    }

    return createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    })
}

module.exports = {
    createSupabaseFromEnv,
}
