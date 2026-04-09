#include "node_role.h"

namespace srproj {

static volatile NodeRole g_currentRole = NodeRole::Gateway;
static volatile NodeRole g_pendingRole = NodeRole::Gateway;
static volatile bool g_hasPendingRole = false;

void initNodeRole(NodeRole initialRole) {
  g_currentRole = initialRole;
  g_pendingRole = initialRole;
  g_hasPendingRole = false;
}

NodeRole getNodeRole() {
  return g_currentRole;
}

bool requestNodeRole(NodeRole role, const char* source) {
  if (role != NodeRole::Gateway && role != NodeRole::Client) {
    return false;
  }

  g_pendingRole = role;
  g_hasPendingRole = true;

  Serial.printf(
    "Role change requested -> %s (source=%s)\n",
    nodeRoleName(role),
    source == nullptr ? "unknown" : source
  );

  return true;
}

bool applyPendingNodeRole() {
  if (!g_hasPendingRole) {
    return false;
  }

  const NodeRole nextRole = g_pendingRole;
  g_hasPendingRole = false;

  if (nextRole == g_currentRole) {
    return false;
  }

  g_currentRole = nextRole;
  return true;
}

const char* nodeRoleName(NodeRole role) {
  return role == NodeRole::Gateway ? "gateway" : "client";
}

}  // namespace srproj
