/**
 * Handles node role change logic in radio mode
 * 
 * Last edit: Nicholas Sardinia, 4/20/2026
*/
#include "node_role.h"

namespace srproj {

//Define role variables
static volatile NodeRole g_currentRole = NodeRole::Gateway;
static volatile NodeRole g_pendingRole = NodeRole::Gateway;
static volatile bool g_hasPendingRole = false;

//Initialize device role
void initNodeRole(NodeRole initialRole) {
  g_currentRole = initialRole;
  g_pendingRole = initialRole;
  g_hasPendingRole = false;
}

// getter for roles
NodeRole getNodeRole() {
  return g_currentRole;
}

// request role changes (gateway and client)
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

// Apply change to node role (after role configuration is complete)
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

// get the current role name
const char* nodeRoleName(NodeRole role) {
  return role == NodeRole::Gateway ? "gateway" : "client";
}

}  // namespace srproj
