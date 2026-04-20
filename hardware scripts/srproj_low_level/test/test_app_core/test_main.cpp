#include <unity.h>

#include "app_core.h"

using namespace srproj;

void setUp() {}

void tearDown() {}

void test_copy_device_id_truncates_and_null_terminates() {
  // Device IDs are copied into fixed-size packet/config buffers throughout the app.
  char buffer[8] = {};
  coreCopyDeviceId(buffer, sizeof(buffer), "device-id-long");
  TEST_ASSERT_EQUAL_STRING("device-", buffer);
}

void test_copy_device_id_clears_buffer_when_source_is_null() {
  // Null input should produce a clean empty string instead of stale data.
  char buffer[8] = "stale";
  coreCopyDeviceId(buffer, sizeof(buffer), nullptr);
  TEST_ASSERT_EQUAL_STRING("", buffer);
}

void test_copy_device_id_ignores_zero_length_destination() {
  // Zero-length buffers are legal callers and should be ignored safely.
  char sentinel = 'X';
  coreCopyDeviceId(&sentinel, 0, "abc");
  TEST_ASSERT_EQUAL_INT8('X', sentinel);
}

void test_parse_owner_uid_accepts_expected_secret() {
  // Provisioning depends on extracting the owner UID from the middle token.
  std::string ownerUid;
  TEST_ASSERT_TRUE(coreParseOwnerFirebaseUid("esg1.owner123.signature", ownerUid));
  TEST_ASSERT_EQUAL_STRING("owner123", ownerUid.c_str());
}

void test_parse_owner_uid_rejects_invalid_secret() {
  // Invalid secret formats should fail cleanly and not leave stale output behind.
  std::string ownerUid = "stale";
  TEST_ASSERT_FALSE(coreParseOwnerFirebaseUid("bad.owner123.signature", ownerUid));
  TEST_ASSERT_TRUE(ownerUid.empty());
}

void test_parse_owner_uid_rejects_null_secret() {
  // Missing secrets should be treated as invalid.
  std::string ownerUid = "stale";
  TEST_ASSERT_FALSE(coreParseOwnerFirebaseUid(nullptr, ownerUid));
  TEST_ASSERT_TRUE(ownerUid.empty());
}

void test_parse_owner_uid_rejects_missing_second_token() {
  // The owner UID must exist between the first and second dots.
  std::string ownerUid;
  TEST_ASSERT_FALSE(coreParseOwnerFirebaseUid("esg1..signature", ownerUid));
  TEST_ASSERT_TRUE(ownerUid.empty());
}

void test_parse_owner_uid_trims_whitespace_from_owner_token() {
  // Tokens extracted from config should normalize away accidental whitespace.
  std::string ownerUid;
  TEST_ASSERT_TRUE(coreParseOwnerFirebaseUid("esg1.owner \r\n\t.signature", ownerUid));
  TEST_ASSERT_EQUAL_STRING("owner", ownerUid.c_str());
}

void test_parse_mesh_role_handles_case_insensitive_input() {
  // Dashboard/config input may vary in casing, but role mapping should stay stable.
  MeshNodeRole role = MeshNodeRole::Client;
  TEST_ASSERT_TRUE(coreParseMeshRole("GaTeWaY", role));
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(MeshNodeRole::Gateway), static_cast<uint8_t>(role));
}

void test_parse_mesh_role_accepts_client_text() {
  // Both supported roles should parse successfully.
  MeshNodeRole role = MeshNodeRole::Gateway;
  TEST_ASSERT_TRUE(coreParseMeshRole("client", role));
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(MeshNodeRole::Client), static_cast<uint8_t>(role));
}

void test_parse_mesh_role_rejects_unknown_role() {
  // Unsupported role text should fail without changing the caller's assumption.
  MeshNodeRole role = MeshNodeRole::Gateway;
  TEST_ASSERT_FALSE(coreParseMeshRole("router", role));
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(MeshNodeRole::Gateway), static_cast<uint8_t>(role));
}

void test_text_helpers_cover_null_and_empty_inputs() {
  // These helpers sit under a lot of matching logic, so edge behavior matters.
  TEST_ASSERT_TRUE(coreTextHasValue("x"));
  TEST_ASSERT_FALSE(coreTextHasValue(""));
  TEST_ASSERT_FALSE(coreTextHasValue(nullptr));
  TEST_ASSERT_TRUE(coreTextEquals("same", "same"));
  TEST_ASSERT_FALSE(coreTextEquals("same", "different"));
  TEST_ASSERT_FALSE(coreTextEquals(nullptr, "same"));
}

void test_upsert_node_config_reuses_existing_entry_and_tracks_gateway() {
  // Upserts should update an existing node instead of duplicating it in the config table.
  NetworkConfigState cfg = {};
  coreClearNetworkConfig(cfg);

  coreUpsertNodeConfig(cfg, "dev-a", 1, MeshNodeRole::Client, "gw-a", 3, "", 0, true);
  coreUpsertNodeConfig(cfg, "dev-a", 9, MeshNodeRole::Gateway, "", 0, "", 0, true);

  TEST_ASSERT_EQUAL_UINT32(1, static_cast<uint32_t>(cfg.nodeCount));
  TEST_ASSERT_EQUAL_UINT8(9, cfg.nodes[0].nodeId);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(MeshNodeRole::Gateway), static_cast<uint8_t>(cfg.nodes[0].role));
  TEST_ASSERT_EQUAL_UINT32(1, static_cast<uint32_t>(cfg.gatewayCount));
  TEST_ASSERT_EQUAL_STRING("dev-a", cfg.gateways[0]);
}

void test_upsert_node_config_reuses_existing_entry_by_node_id() {
  // Node ID fallback should still update the same row when device ID is missing.
  NetworkConfigState cfg = {};
  coreClearNetworkConfig(cfg);

  coreUpsertNodeConfig(cfg, "", 4, MeshNodeRole::Client, "gw-a", 3, "", 0, true);
  coreUpsertNodeConfig(cfg, "", 4, MeshNodeRole::Gateway, "", 0, "", 0, false);

  TEST_ASSERT_EQUAL_UINT32(1, static_cast<uint32_t>(cfg.nodeCount));
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(MeshNodeRole::Gateway), static_cast<uint8_t>(cfg.nodes[0].role));
  TEST_ASSERT_FALSE(cfg.nodes[0].enabled);
}

void test_upsert_node_config_preserves_new_gateway_device_fields() {
  // Preferred and fallback gateway metadata should land in the stored row.
  NetworkConfigState cfg = {};
  coreClearNetworkConfig(cfg);

  coreUpsertNodeConfig(cfg, "dev-b", 5, MeshNodeRole::Client, "gw-pref", 3, "gw-fallback", 8, true);

  TEST_ASSERT_EQUAL_STRING("gw-pref", cfg.nodes[0].preferredGatewayDeviceId);
  TEST_ASSERT_EQUAL_STRING("gw-fallback", cfg.nodes[0].fallbackGatewayDeviceId);
  TEST_ASSERT_EQUAL_UINT8(3, cfg.nodes[0].preferredGatewayId);
  TEST_ASSERT_EQUAL_UINT8(8, cfg.nodes[0].fallbackGatewayId);
}

void test_upsert_node_config_ignores_insert_when_table_is_full() {
  // Once the config table is at capacity, new rows should be dropped safely.
  NetworkConfigState cfg = {};
  coreClearNetworkConfig(cfg);
  cfg.nodeCount = MAX_NETWORK_NODES;

  coreUpsertNodeConfig(cfg, "dev-overflow", 12, MeshNodeRole::Client, "", 0, "", 0, true);

  TEST_ASSERT_EQUAL_UINT32(MAX_NETWORK_NODES, static_cast<uint32_t>(cfg.nodeCount));
}

void test_ensure_gateway_listed_deduplicates_entries() {
  // Gateway lists feed broadcast/routing decisions, so duplicate IDs should be ignored.
  NetworkConfigState cfg = {};
  coreClearNetworkConfig(cfg);

  coreEnsureGatewayListed(cfg, "gw-a");
  coreEnsureGatewayListed(cfg, "gw-a");

  TEST_ASSERT_EQUAL_UINT32(1, static_cast<uint32_t>(cfg.gatewayCount));
}

void test_ensure_gateway_listed_ignores_empty_values() {
  // Empty gateway IDs should not consume slots.
  NetworkConfigState cfg = {};
  coreClearNetworkConfig(cfg);

  coreEnsureGatewayListed(cfg, "");
  coreEnsureGatewayListed(cfg, nullptr);

  TEST_ASSERT_EQUAL_UINT32(0, static_cast<uint32_t>(cfg.gatewayCount));
}

void test_ensure_gateway_listed_stops_at_capacity() {
  // Capacity limits should prevent buffer overflow when syncing larger configs.
  NetworkConfigState cfg = {};
  coreClearNetworkConfig(cfg);

  for (size_t i = 0; i < MAX_GATEWAYS; ++i) {
    char gatewayId[MAX_DEVICE_ID_LEN] = {};
    snprintf(gatewayId, sizeof(gatewayId), "gw-%u", static_cast<unsigned int>(i));
    coreEnsureGatewayListed(cfg, gatewayId);
  }
  coreEnsureGatewayListed(cfg, "gw-overflow");

  TEST_ASSERT_EQUAL_UINT32(MAX_GATEWAYS, static_cast<uint32_t>(cfg.gatewayCount));
}

void test_find_node_config_index_finds_existing_node() {
  // Direct node lookups drive several routing and sync paths.
  NetworkConfigState cfg = {};
  coreClearNetworkConfig(cfg);
  coreUpsertNodeConfig(cfg, "dev-a", 6, MeshNodeRole::Client, "", 0, "", 0, true);

  TEST_ASSERT_EQUAL_INT(0, coreFindNodeConfigIndex(cfg, 6));
}

void test_find_node_config_index_returns_negative_when_missing() {
  // Missing nodes should be clearly reported to callers.
  NetworkConfigState cfg = {};
  coreClearNetworkConfig(cfg);
  TEST_ASSERT_EQUAL_INT(-1, coreFindNodeConfigIndex(cfg, 42));
}

void test_find_node_config_index_by_device_id_finds_existing_device() {
  // Device ID lookups are preferred because they survive node renumbering.
  NetworkConfigState cfg = {};
  coreClearNetworkConfig(cfg);
  coreUpsertNodeConfig(cfg, "dev-c", 2, MeshNodeRole::Client, "", 0, "", 0, true);

  TEST_ASSERT_EQUAL_INT(0, coreFindNodeConfigIndexByDeviceId(cfg, "dev-c"));
}

void test_find_node_config_index_by_device_id_rejects_empty_input() {
  // Empty and null IDs should not match the table accidentally.
  NetworkConfigState cfg = {};
  coreClearNetworkConfig(cfg);
  coreUpsertNodeConfig(cfg, "dev-c", 2, MeshNodeRole::Client, "", 0, "", 0, true);

  TEST_ASSERT_EQUAL_INT(-1, coreFindNodeConfigIndexByDeviceId(cfg, ""));
  TEST_ASSERT_EQUAL_INT(-1, coreFindNodeConfigIndexByDeviceId(cfg, nullptr));
}

void test_clear_network_config_resets_counts_and_storage() {
  // Config clears should wipe both counters and previously stored values.
  NetworkConfigState cfg = {};
  coreUpsertNodeConfig(cfg, "dev-a", 1, MeshNodeRole::Gateway, "", 0, "", 0, true);
  cfg.version = 7;

  coreClearNetworkConfig(cfg);

  TEST_ASSERT_EQUAL_UINT16(0, cfg.version);
  TEST_ASSERT_EQUAL_UINT32(0, static_cast<uint32_t>(cfg.nodeCount));
  TEST_ASSERT_EQUAL_UINT32(0, static_cast<uint32_t>(cfg.gatewayCount));
  TEST_ASSERT_EQUAL_UINT8(0, cfg.nodes[0].nodeId);
  TEST_ASSERT_EQUAL_INT8('\0', cfg.gateways[0][0]);
}

void test_address_table_round_trip_lookup_works() {
  // Routing helpers rely on nodeId<->address lookups staying consistent both directions.
  NodeAddressEntry table[MAX_NETWORK_NODES] = {};
  size_t count = 0;
  uint16_t address = 0;
  uint8_t nodeId = 0;

  coreUpsertNodeAddress(table, count, 7, 0x1234);

  TEST_ASSERT_TRUE(coreLookupAddressByNodeId(table, count, 7, address));
  TEST_ASSERT_EQUAL_HEX16(0x1234, address);
  TEST_ASSERT_TRUE(coreLookupNodeIdByAddress(table, count, 0x1234, nodeId));
  TEST_ASSERT_EQUAL_UINT8(7, nodeId);
}

void test_upsert_node_address_updates_existing_entry() {
  // Re-seen nodes should update in place instead of creating duplicates.
  NodeAddressEntry table[MAX_NETWORK_NODES] = {};
  size_t count = 0;
  uint16_t address = 0;

  coreUpsertNodeAddress(table, count, 3, 0x1111);
  coreUpsertNodeAddress(table, count, 3, 0x2222);

  TEST_ASSERT_EQUAL_UINT32(1, static_cast<uint32_t>(count));
  TEST_ASSERT_TRUE(coreLookupAddressByNodeId(table, count, 3, address));
  TEST_ASSERT_EQUAL_HEX16(0x2222, address);
}

void test_upsert_node_address_ignores_invalid_values() {
  // Zero node IDs and zero addresses are placeholders and should be skipped.
  NodeAddressEntry table[MAX_NETWORK_NODES] = {};
  size_t count = 0;

  coreUpsertNodeAddress(table, count, 0, 0x1111);
  coreUpsertNodeAddress(table, count, 2, 0);

  TEST_ASSERT_EQUAL_UINT32(0, static_cast<uint32_t>(count));
}

void test_lookup_helpers_return_false_when_not_found() {
  // Failed lookups should stay explicit for fallback routing code.
  NodeAddressEntry table[MAX_NETWORK_NODES] = {};
  size_t count = 0;
  uint16_t address = 0;
  uint8_t nodeId = 0;

  TEST_ASSERT_FALSE(coreLookupAddressByNodeId(table, count, 9, address));
  TEST_ASSERT_FALSE(coreLookupNodeIdByAddress(table, count, 0x9999, nodeId));
}

void test_upsert_node_address_stops_at_capacity() {
  // Capacity enforcement should avoid writing past the fixed-size table.
  NodeAddressEntry table[MAX_NETWORK_NODES] = {};
  size_t count = MAX_NETWORK_NODES;

  coreUpsertNodeAddress(table, count, 12, 0x1212);

  TEST_ASSERT_EQUAL_UINT32(MAX_NETWORK_NODES, static_cast<uint32_t>(count));
}

void test_recent_contact_uses_local_device_override_and_stale_timeout() {
  // The local device should always count as reachable, while remote nodes age out normally.
  NodeConfigEntry entry = {};
  coreCopyDeviceId(entry.deviceId, sizeof(entry.deviceId), "dev-local");
  entry.enabled = true;

  TEST_ASSERT_TRUE(coreHasRecentNodeContact(entry, "dev-local", 1000, 60000));

  entry.lastSeenMs = 500;
  coreCopyDeviceId(entry.deviceId, sizeof(entry.deviceId), "dev-remote");
  TEST_ASSERT_TRUE(coreHasRecentNodeContact(entry, "dev-local", 1000, 60000));
  TEST_ASSERT_FALSE(coreHasRecentNodeContact(entry, "dev-local", 70000, 60000));
}

void test_recent_contact_rejects_disabled_nodes() {
  // Disabled config entries should never be reported as available.
  NodeConfigEntry entry = {};
  coreCopyDeviceId(entry.deviceId, sizeof(entry.deviceId), "dev-local");
  entry.enabled = false;
  entry.lastSeenMs = 100;

  TEST_ASSERT_FALSE(coreHasRecentNodeContact(entry, "dev-local", 1000, 60000));
}

void test_recent_contact_rejects_remote_node_without_last_seen() {
  // Remote nodes need a heartbeat timestamp before they count as reachable.
  NodeConfigEntry entry = {};
  coreCopyDeviceId(entry.deviceId, sizeof(entry.deviceId), "dev-remote");
  entry.enabled = true;

  TEST_ASSERT_FALSE(coreHasRecentNodeContact(entry, "dev-local", 1000, 60000));
}

void test_recent_contact_accepts_boundary_timeout_value() {
  // Exactly-on-the-boundary timestamps should still count as recent.
  NodeConfigEntry entry = {};
  coreCopyDeviceId(entry.deviceId, sizeof(entry.deviceId), "dev-remote");
  entry.enabled = true;
  entry.lastSeenMs = 1000;

  TEST_ASSERT_TRUE(coreHasRecentNodeContact(entry, "dev-local", 61000, 60000));
}

void test_url_encode_escapes_reserved_characters() {
  // Firebase token refresh uses form encoding, so reserved characters must be escaped.
  const std::string encoded = coreUrlEncode("a b+c/=");
  TEST_ASSERT_EQUAL_STRING("a%20b%2Bc%2F%3D", encoded.c_str());
}

void test_url_encode_keeps_safe_characters_unchanged() {
  // Unreserved characters should pass through so keys stay readable.
  const std::string encoded = coreUrlEncode("abcXYZ012-_.~");
  TEST_ASSERT_EQUAL_STRING("abcXYZ012-_.~", encoded.c_str());
}

void test_url_encode_returns_empty_string_for_null_input() {
  // Null input should behave like an empty payload, not crash.
  const std::string encoded = coreUrlEncode(nullptr);
  TEST_ASSERT_TRUE(encoded.empty());
}

int main(int argc, char** argv) {
  UNITY_BEGIN();
  RUN_TEST(test_copy_device_id_truncates_and_null_terminates);
  RUN_TEST(test_copy_device_id_clears_buffer_when_source_is_null);
  RUN_TEST(test_copy_device_id_ignores_zero_length_destination);
  RUN_TEST(test_parse_owner_uid_accepts_expected_secret);
  RUN_TEST(test_parse_owner_uid_rejects_invalid_secret);
  RUN_TEST(test_parse_owner_uid_rejects_null_secret);
  RUN_TEST(test_parse_owner_uid_rejects_missing_second_token);
  RUN_TEST(test_parse_owner_uid_trims_whitespace_from_owner_token);
  RUN_TEST(test_parse_mesh_role_handles_case_insensitive_input);
  RUN_TEST(test_parse_mesh_role_accepts_client_text);
  RUN_TEST(test_parse_mesh_role_rejects_unknown_role);
  RUN_TEST(test_text_helpers_cover_null_and_empty_inputs);
  RUN_TEST(test_upsert_node_config_reuses_existing_entry_and_tracks_gateway);
  RUN_TEST(test_upsert_node_config_reuses_existing_entry_by_node_id);
  RUN_TEST(test_upsert_node_config_preserves_new_gateway_device_fields);
  RUN_TEST(test_upsert_node_config_ignores_insert_when_table_is_full);
  RUN_TEST(test_ensure_gateway_listed_deduplicates_entries);
  RUN_TEST(test_ensure_gateway_listed_ignores_empty_values);
  RUN_TEST(test_ensure_gateway_listed_stops_at_capacity);
  RUN_TEST(test_find_node_config_index_finds_existing_node);
  RUN_TEST(test_find_node_config_index_returns_negative_when_missing);
  RUN_TEST(test_find_node_config_index_by_device_id_finds_existing_device);
  RUN_TEST(test_find_node_config_index_by_device_id_rejects_empty_input);
  RUN_TEST(test_clear_network_config_resets_counts_and_storage);
  RUN_TEST(test_address_table_round_trip_lookup_works);
  RUN_TEST(test_upsert_node_address_updates_existing_entry);
  RUN_TEST(test_upsert_node_address_ignores_invalid_values);
  RUN_TEST(test_lookup_helpers_return_false_when_not_found);
  RUN_TEST(test_upsert_node_address_stops_at_capacity);
  RUN_TEST(test_recent_contact_uses_local_device_override_and_stale_timeout);
  RUN_TEST(test_recent_contact_rejects_disabled_nodes);
  RUN_TEST(test_recent_contact_rejects_remote_node_without_last_seen);
  RUN_TEST(test_recent_contact_accepts_boundary_timeout_value);
  RUN_TEST(test_url_encode_escapes_reserved_characters);
  RUN_TEST(test_url_encode_keeps_safe_characters_unchanged);
  RUN_TEST(test_url_encode_returns_empty_string_for_null_input);
  return UNITY_END();
}
