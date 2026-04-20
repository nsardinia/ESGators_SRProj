/**
 * Test harness for fastify application with supabase and firebase stubs.
 * 
 * Last edit: Nicholas Sardinia, 4/20/2026
 */

const Fastify = require("fastify");
const sensible = require("@fastify/sensible");
const registerRoutes = require("../../src/routes");

// Clones row-like fixtures so tests do not mutate their own inputs by accident.
function cloneRows(rows = []) {
  return rows.map((row) => ({ ...row }));
}

// Generates stable timestamps for inserted in-memory records.
function makeTimestamp(counter) {
  const base = Date.parse("2026-04-20T12:00:00.000Z");
  return new Date(base + counter * 1_000).toISOString();
}

// Produces deterministic UUIDs so created users look like real persisted rows.
function makeUuid(counter) {
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

// Replays chained query filters against the in-memory table rows.
function applyFilters(rows, filters) {
  return rows.filter((row) => filters.every((predicate) => predicate(row)));
}

// Mimics the small slice of Supabase ordering behavior the route tests rely on.
function applyOrdering(rows, orderBy) {
  if (!orderBy) {
    return rows;
  }

  const { column, ascending } = orderBy;
  const direction = ascending ? 1 : -1;

  return [...rows].sort((left, right) => {
    if (left[column] === right[column]) {
      return 0;
    }

    return left[column] > right[column] ? direction : -direction;
  });
}

// Supports `.or("email.eq.x,firebase_uid.eq.y")` lookups used by user upserts.
function parseOrFilter(expression) {
  const clauses = String(expression || "")
    .split(",")
    .map((clause) => clause.trim())
    .filter(Boolean)
    .map((clause) => {
      const [column, operator, ...valueParts] = clause.split(".");
      return {
        column,
        operator,
        value: valueParts.join("."),
      };
    });

  return (row) =>
    clauses.some(
      ({ column, operator, value }) =>
        operator === "eq" && String(row?.[column] ?? "") === value
    );
}

// Small fluent Supabase stand-in that supports the route-level query patterns under test.
class QueryBuilder {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.mode = "select";
    this.filters = [];
    this.orderBy = null;
    this.rowLimit = null;
    this.payload = null;
  }

  select() {
    return this;
  }

  order(column, options = {}) {
    this.orderBy = {
      column,
      ascending: options.ascending !== false,
    };
    return this;
  }

  limit(value) {
    this.rowLimit = Number(value);
    return this;
  }

  eq(column, value) {
    this.filters.push((row) => row?.[column] === value);
    return this;
  }

  in(column, values) {
    this.filters.push((row) => values.includes(row?.[column]));
    return this;
  }

  gte(column, value) {
    this.filters.push((row) => String(row?.[column] ?? "") >= String(value));
    return this;
  }

  lte(column, value) {
    this.filters.push((row) => String(row?.[column] ?? "") <= String(value));
    return this;
  }

  or(expression) {
    this.filters.push(parseOrFilter(expression));
    return this;
  }

  insert(payload) {
    this.mode = "insert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    return this;
  }

  update(payload) {
    this.mode = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.mode = "delete";
    return this;
  }

  maybeSingle() {
    return this.execute({ single: true });
  }

  single() {
    return this.execute({ single: true });
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  async execute(options = {}) {
    const rows = this.db[this.table];

    if (!Array.isArray(rows)) {
      return {
        data: null,
        error: { message: `Unknown table ${this.table}` },
      };
    }

    if (this.mode === "insert") {
      const insertedRows = this.payload.map((row) => {
        const nextRow = { ...row };

        if (this.table === "users") {
          this.db._userIdCounter += 1;
          const timestamp = makeTimestamp(this.db._userIdCounter);
          nextRow.id = nextRow.id || makeUuid(this.db._userIdCounter);
          nextRow.created_at = nextRow.created_at || timestamp;
          nextRow.updated_at = nextRow.updated_at || timestamp;
        }

        rows.push(nextRow);
        return { ...nextRow };
      });

      return {
        data: options.single ? insertedRows[0] || null : insertedRows,
        error: null,
      };
    }

    const matchedRows = applyOrdering(
      applyFilters(rows, this.filters),
      this.orderBy
    );
    const limitedRows =
      Number.isFinite(this.rowLimit) && this.rowLimit >= 0
        ? matchedRows.slice(0, this.rowLimit)
        : matchedRows;

    if (this.mode === "select") {
      return {
        data: options.single ? limitedRows[0] || null : cloneRows(limitedRows),
        error: null,
      };
    }

    if (this.mode === "update") {
      const updatedRows = limitedRows.map((row) => Object.assign(row, this.payload));
      return {
        data: options.single ? updatedRows[0] || null : cloneRows(updatedRows),
        error: null,
      };
    }

    if (this.mode === "delete") {
      const toDelete = new Set(limitedRows);
      this.db[this.table] = rows.filter((row) => !toDelete.has(row));
      return {
        data: options.single ? limitedRows[0] || null : cloneRows(limitedRows),
        error: null,
      };
    }

    return { data: null, error: null };
  }
}

// Exposes table-scoped query builders with shared in-memory state.
function createSupabaseStub(db) {
  return {
    from(table) {
      return new QueryBuilder(db, table);
    },
  };
}

// Records Firebase reads and writes without needing a live RTDB instance.
function createFirebaseDbStub(initialSnapshots = {}) {
  const snapshots = new Map(Object.entries(initialSnapshots));
  const writes = new Map();

  return {
    writes,
    service: {
      ref(path) {
        return {
          async get() {
            const value = snapshots.get(path);
            return {
              exists() {
                return value !== undefined;
              },
              val() {
                return value;
              },
            };
          },
          async set(value) {
            snapshots.set(path, value);
            writes.set(path, value);
          },
        };
      },
    },
  };
}

// Supplies the Firebase auth methods exercised by provisioning and lifecycle routes.
function createFirebaseAuthStub() {
  return {
    createCustomToken: jest.fn(async (uid) => `token-for:${uid}`),
    revokeRefreshTokens: jest.fn(async () => {}),
    deleteUser: jest.fn(async () => {}),
  };
}

// Builds a Fastify app wired to the real route registration with fully in-memory dependencies.
async function buildApiApp({
  users = [],
  devices = [],
  deviceHistory = [],
  firebaseSnapshots = {},
} = {}) {
  const db = {
    users: cloneRows(users),
    devices: cloneRows(devices),
    device_history: cloneRows(deviceHistory),
    _userIdCounter: users.length,
  };
  const firebaseDb = createFirebaseDbStub(firebaseSnapshots);
  const firebaseAuth = createFirebaseAuthStub();
  const app = Fastify({ logger: false });

  await app.register(sensible);
  app.decorate("supabase", createSupabaseStub(db));
  app.decorate("firebaseDb", firebaseDb.service);
  app.decorate("firebaseAuth", firebaseAuth);
  await app.register(registerRoutes);

  return {
    app,
    db,
    firebaseAuth,
    firebaseWrites: firebaseDb.writes,
  };
}

module.exports = {
  buildApiApp,
  makeUuid,
};
