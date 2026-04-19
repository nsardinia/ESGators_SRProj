/**
 * Compatibility sensor feed routes for the metrics backend. 
 * Allows grafana to read from user data. 
 *
 * Last Edit: Nicholas Sardinia, 4/19/2026
 */

const latestSensorsQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 500 },
    deviceId: { type: "string", minLength: 1, maxLength: 255 },
  },
};

const sensorItemSchema = {
  type: "object",
  properties: {
    sensor_id: { type: "string" },
    metric_type: { type: "string" },
    value: { type: "number" },
    timestamp: { type: "string", format: "date-time" },
  },
};

const errorSchema = {
  type: "object",
  properties: {
    statusCode: { type: "integer" },
    error: { type: "string" },
    message: { type: "string" },
  },
};

const DEFAULT_LIMIT = 100;
const METRIC_MAPPINGS = [
  { sourceField: "no2", metricType: "no2" },
  { sourceField: "sound_level", metricType: "noise_levels" },
  { sourceField: "temperature", metricType: "temperature" },
  { sourceField: "humidity", metricType: "humidity" },
];

function ensureDb(app) {
  if (!app.hasDecorator("supabase")) {
    throw app.httpErrors.internalServerError(
      "Database is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file."
    );
  }
}

function normalizeLimit(rawLimit) {
  const numericLimit = Number(rawLimit);

  if (!Number.isFinite(numericLimit)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(numericLimit), 1), 500);
}

function createSensorItems(row) {
  const timestamp = row?.source_updated_at || row?.captured_at;

  return METRIC_MAPPINGS.flatMap(({ sourceField, metricType }) => {
    const numericValue = Number(row?.[sourceField]);

    if (!Number.isFinite(numericValue)) {
      return [];
    }

    return [{
      sensor_id: String(row?.device_id || "").trim(),
      metric_type: metricType,
      value: numericValue,
      timestamp,
    }];
  }).filter((item) => item.sensor_id && item.timestamp);
}

async function sensorsRoutes(app) {
  app.get(
    "/latest",
    {
      schema: {
        tags: ["Sensors"],
        summary: "Latest sensor feed for backend MWBE sync compatibility",
        querystring: latestSensorsQuerySchema,
        response: {
          200: {
            type: "object",
            properties: {
              data: {
                type: "object",
                properties: {
                  items: {
                    type: "array",
                    items: sensorItemSchema,
                  },
                },
              },
            },
          },
          500: errorSchema,
        },
      },
    },
    async (request) => {
      ensureDb(app);

      const limit = normalizeLimit(request.query?.limit);
      const deviceId = String(request.query?.deviceId || "").trim();

      let query = app.supabase
        .from("device_history")
        .select(
          "device_id, captured_at, source_updated_at, no2, sound_level, temperature, humidity"
        )
        .order("sample_interval_start", { ascending: false })
        .limit(limit);

      if (deviceId) {
        query = query.eq("device_id", deviceId);
      }

      const { data, error } = await query;

      if (error) {
        throw app.httpErrors.internalServerError(error.message);
      }

      return {
        data: {
          items: (data || []).flatMap(createSensorItems),
        },
      };
    }
  );
}

module.exports = sensorsRoutes;
