#!/bin/sh
# Expose only the CLI owned by this HermesOffice installation.
set -e
launcher="/opt/HermesOffice/resources/cli/hermesoffice"
link="/usr/bin/hermesoffice"
if [ -x "$launcher" ]; then
  if [ ! -e "$link" ] && [ ! -L "$link" ]; then
    ln -s "$launcher" "$link"
  elif [ -L "$link" ] && [ "$(readlink "$link")" = "$launcher" ]; then
    ln -sf "$launcher" "$link"
  else
    echo "HermesOffice CLI link is owned by another installation; leaving it unchanged" >&2
  fi
fi
exit 0
