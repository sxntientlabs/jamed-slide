import os
from pathlib import Path


source_root = Path(os.environ.get("HERMES_SOURCE_ROOT", "/opt/hermes-source"))
path = source_root / "tools/bot_desktop/launcher.sh"
source = path.read_text()

old_display_env = "export GDK_BACKEND=x11 QT_QPA_PLATFORM=xcb NO_AT_BRIDGE=1 GTK_A11Y=none"
if old_display_env not in source:
    raise SystemExit("Bot Desktop display environment changed upstream")
source = source.replace(old_display_env, "export GDK_BACKEND=x11 QT_QPA_PLATFORM=xcb NO_AT_BRIDGE=0")

old_autostart = " blueman at-spi-dbus-bus "
if old_autostart not in source:
    raise SystemExit("Bot Desktop AT-SPI autostart block changed upstream")
source = source.replace(old_autostart, " blueman ")

needle = '''  umask 077
  printf "DISPLAY=%s\\nXAUTHORITY=%s\\nDBUS_SESSION_BUS_ADDRESS=%s\\nXDG_CONFIG_HOME=%s\\nXDG_CACHE_HOME=%s\\nXDG_DATA_HOME=%s\\n" \\
    "$DISPLAY" "$XAUTHORITY" "$DBUS_SESSION_BUS_ADDRESS" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" \\
    > "$HERMES_BD_ENV_FILE.tmp" && mv -f "$HERMES_BD_ENV_FILE.tmp" "$HERMES_BD_ENV_FILE"
'''
replacement = '''  umask 077
  AT_SPI_BUS="unix:path=$XDG_CACHE_HOME/at-spi/bus_${HERMES_BD_DISPLAY_NUM}"
  export AT_SPI_BUS
  if [[ -x /usr/libexec/at-spi-bus-launcher ]]; then
    /usr/libexec/at-spi-bus-launcher --launch-immediately >/dev/null 2>&1 &
    for _ in $(seq 1 50); do
      [[ -S "${AT_SPI_BUS#unix:path=}" ]] && break
      sleep 0.1
    done
  fi
  printf "DISPLAY=%s\\nXAUTHORITY=%s\\nDBUS_SESSION_BUS_ADDRESS=%s\\nAT_SPI_BUS=%s\\nXDG_CONFIG_HOME=%s\\nXDG_CACHE_HOME=%s\\nXDG_DATA_HOME=%s\\n" \\
    "$DISPLAY" "$XAUTHORITY" "$DBUS_SESSION_BUS_ADDRESS" "$AT_SPI_BUS" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" \\
    > "$HERMES_BD_ENV_FILE.tmp" && mv -f "$HERMES_BD_ENV_FILE.tmp" "$HERMES_BD_ENV_FILE"
'''
if needle not in source:
    raise SystemExit("Bot Desktop launcher publish block changed upstream")

path.write_text(source.replace(needle, replacement))
