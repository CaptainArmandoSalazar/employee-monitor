#!/bin/bash
# Auto-fix Wayland → X11 for employee-monitor tracking

CONF="/etc/gdm3/custom.conf"

# Check if already on X11
if [ "$XDG_SESSION_TYPE" = "x11" ]; then
  echo "Already on X11, nothing to do."
  exit 0
fi

# Check if Wayland is active
if [ "$XDG_SESSION_TYPE" = "wayland" ]; then
  echo "Wayland detected — switching to X11..."
  
  # Backup config
  sudo cp "$CONF" "$CONF.bak" 2>/dev/null || true
  
  # Disable Wayland
  if grep -q "^#WaylandEnable=false" "$CONF"; then
    sudo sed -i 's/^#WaylandEnable=false/WaylandEnable=false/' "$CONF"
  elif grep -q "^WaylandEnable=true" "$CONF"; then
    sudo sed -i 's/^WaylandEnable=true/WaylandEnable=false/' "$CONF"
  elif ! grep -q "WaylandEnable=false" "$CONF"; then
    # Add it under [daemon] section
    sudo sed -i '/^\[daemon\]/a WaylandEnable=false' "$CONF"
  fi
  
  echo "Done. Please reboot for changes to take effect."
  exit 1  # exit 1 = reboot needed
fi