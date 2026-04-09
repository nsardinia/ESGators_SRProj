#pragma once

#include <Arduino.h>

namespace srproj {

enum class NodeRole : uint8_t {
  Gateway = 0,
  Client = 1,
};

void initNodeRole(NodeRole initialRole);
NodeRole getNodeRole();
bool requestNodeRole(NodeRole role, const char* source);
bool applyPendingNodeRole();
const char* nodeRoleName(NodeRole role);

}  // namespace srproj
